import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDiagnostic, formatDiagnosticText, createJsonEnvelope } from '../diagnostics.mjs';

const TRACE_USAGE = `Usage:
  android-ux trace [options] <trace.perfetto-trace...>
  android-ux trace [options] --compare <before.perfetto-trace...> -- <after.perfetto-trace...>

Summarize UI-thread (Choreographer#doFrame + Compose recompose/measure/draw), RenderThread
(DrawFrame, saveLayer, shader cache misses, dequeueBuffer), and SurfaceFlinger FrameTimeline
jank from Perfetto traces using Perfetto's trace_processor_shell.

Options:
  --process <substr>           Process name substring filter (e.g. com.example.app)
  --window <NAME:START:END>    Explicit window in seconds relative to trace start (repeatable)
  --burst-gap-ms <ms>          Idle gap in ms used to split auto-detected bursts (default: 800)
  --budget-ms <ms>             Frame budget in ms (default: 8.33 for 120 Hz)
  --top <N>                    Max over-budget UI frames to expand per window (default: 3)
  --trace-processor <path>     Explicit path to trace_processor_shell / trace_processor
  --timeout-ms <ms>            Per-query timeout in milliseconds (default: 60000)
  --compare <before> -- <after> Compare before vs after traces across matched windows/bursts
  --json                       Emit a single JSON document on stdout
  --help, -h                   Show this help message
`;

/**
 * RFC-4180 compliant CSV parser returning an array of row objects keyed by header column names.
 */
export function parseRfc4180Csv(csvText) {
  if (!csvText || !String(csvText).trim()) return [];
  const text = String(csvText);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r') {
      if (text[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }

  if (inQuotes || field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim());
  const out = [];
  for (let r = 1; r < rows.length; r += 1) {
    const vals = rows[r];
    if (vals.length === 1 && vals[0] === '') continue;
    const obj = {};
    for (let c = 0; c < headers.length; c += 1) {
      obj[headers[c]] = vals[c] ?? '';
    }
    out.push(obj);
  }
  return out;
}

export function parseWindowSpec(spec) {
  const parts = String(spec || '').split(':');
  if (parts.length !== 3 || !parts[0] || !parts[1].trim() || !parts[2].trim()) {
    throw new Error(`Invalid --window '${spec}'; expected NAME:START_SEC:END_SEC`);
  }
  const startSec = Number(parts[1]);
  const endSec = Number(parts[2]);
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) {
    throw new Error(`Invalid numeric window bounds in '${spec}'`);
  }
  if (endSec <= startSec) {
    throw new Error(`Window end must exceed start in '${spec}'`);
  }
  return { name: parts[0], startSec, endSec };
}

const _dv = new DataView(new ArrayBuffer(8));

/**
 * IEEE-754 double round-half-to-even formatter matching Python `f"{value:.{digits}f}"`.
 */
export function roundHalfEvenFixed(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return String(num);
  _dv.setFloat64(0, num, false);
  const bits = _dv.getBigUint64(0, false);
  const sign = (bits >> 63n) === 1n;
  const rawExp = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);

  let q = 0n;
  if (rawExp !== 0 || frac !== 0n) {
    const sig = rawExp === 0 ? frac : ((1n << 52n) | frac);
    const exp2 = (rawExp === 0 ? -1022 : (rawExp - 1023)) - 52;
    const numPow5 = sig * (5n ** BigInt(digits));
    const shift = exp2 + digits;
    if (shift >= 0) {
      q = numPow5 << BigInt(shift);
    } else {
      const k = BigInt(-shift);
      q = numPow5 >> k;
      const half = 1n << (k - 1n);
      const rem = numPow5 & ((1n << k) - 1n);
      if (rem > half || (rem === half && (q & 1n) === 1n)) {
        q += 1n;
      }
    }
  }

  const rawDigits = q.toString();
  let formatted;
  if (digits === 0) {
    formatted = rawDigits;
  } else {
    const padded = rawDigits.padStart(digits + 1, '0');
    const splitAt = padded.length - digits;
    formatted = `${padded.slice(0, splitAt)}.${padded.slice(splitAt)}`;
  }
  return sign ? `-${formatted}` : formatted;
}

/**
 * Detect Perfetto's `get.perfetto.dev/trace_processor` Python launcher script by shebang
 * (`#!...python`) without executing it, preventing offline/sandbox network attempts.
 */
export function isPythonPerfettoWrapper(binPath) {
  if (!binPath) return false;
  let fd = null;
  try {
    fd = fs.openSync(binPath, 'r');
    const buf = Buffer.alloc(128);
    const bytesRead = fs.readSync(fd, buf, 0, 128, 0);
    const head = buf.subarray(0, bytesRead).toString('utf8');
    const firstLine = head.split(/\r?\n/)[0] || '';
    return firstLine.startsWith('#!') && /python/i.test(firstLine);
  } catch {
    return false;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // Ignore close error.
      }
    }
  }
}

export function resolveTraceProcessor({ explicitPath = null, env = process.env, platform = process.platform } = {}) {
  let wrapperPath = null;
  const checkCandidate = (candidatePath) => {
    try {
      if (!fs.existsSync(candidatePath) || !fs.statSync(candidatePath).isFile()) return null;
      if (isPythonPerfettoWrapper(candidatePath)) {
        if (!wrapperPath) wrapperPath = candidatePath;
        return null;
      }
      return candidatePath;
    } catch {
      return null;
    }
  };

  if (explicitPath) {
    const resolved = path.resolve(explicitPath);
    const nativeBin = checkCandidate(resolved);
    return { binaryPath: nativeBin, wrapperPath };
  }
  if (env.ANDROID_UX_TRACE_PROCESSOR) {
    const envPath = path.resolve(env.ANDROID_UX_TRACE_PROCESSOR);
    const nativeBin = checkCandidate(envPath);
    if (nativeBin || wrapperPath) {
      return { binaryPath: nativeBin, wrapperPath };
    }
  }

  const home = platform === 'win32'
    ? (env.USERPROFILE || env.HOME || os.homedir())
    : (env.HOME || env.USERPROFILE || os.homedir());

  if (home) {
    const prebuiltsDir = path.join(home, '.local', 'share', 'perfetto', 'prebuilts');
    try {
      if (fs.existsSync(prebuiltsDir) && fs.statSync(prebuiltsDir).isDirectory()) {
        const candidates = fs.readdirSync(prebuiltsDir)
          .filter((name) => name.startsWith('trace_processor_shell') && !name.endsWith('.sha256'))
          .map((name) => {
            const full = path.join(prebuiltsDir, name);
            try {
              const st = fs.statSync(full);
              return st.isFile() ? { full, mtimeMs: st.mtimeMs } : null;
            } catch {
              return null;
            }
          })
          .filter(Boolean)
          .sort((a, b) => b.mtimeMs - a.mtimeMs);
        for (const c of candidates) {
          const nativeBin = checkCandidate(c.full);
          if (nativeBin) return { binaryPath: nativeBin, wrapperPath: null };
        }
      }
    } catch {
      // Ignore unreadable prebuilts dir.
    }
  }

  const pathSep = platform === 'win32' ? ';' : ':';
  const pathDirs = String(env.PATH || '').split(pathSep).filter(Boolean);
  const binNames = platform === 'win32'
    ? ['trace_processor_shell.exe', 'trace_processor.exe', 'trace_processor_shell', 'trace_processor']
    : ['trace_processor_shell', 'trace_processor'];
  const joiner = platform === 'win32' ? path.win32.join : path.posix.join;

  for (const dir of pathDirs) {
    for (const bin of binNames) {
      const full = joiner(dir, bin);
      const nativeBin = checkCandidate(full);
      if (nativeBin) return { binaryPath: nativeBin, wrapperPath };
    }
  }
  return { binaryPath: null, wrapperPath };
}

export function findTraceProcessorBinary(opts = {}) {
  return resolveTraceProcessor(opts).binaryPath;
}

let _sqlSeq = 0;

export function createShellSqlRunner(binaryPath, tracePath, { timeoutMs = 60000 } = {}) {
  let queryCount = 0;
  return {
    get queryCount() {
      return queryCount;
    },
    query(sql) {
      queryCount += 1;
      const sqlStmt = sql.trim().endsWith(';') ? sql : `${sql.trim()};\n`;
      let tmpSqlPath = null;
      let args;
      try {
        _sqlSeq += 1;
        tmpSqlPath = path.join(os.tmpdir(), `android-ux-tp-${process.pid}-${Date.now()}-${_sqlSeq}.sql`);
        fs.writeFileSync(tmpSqlPath, sqlStmt, 'utf8');
        args = ['-q', tmpSqlPath, String(tracePath)];
      } catch {
        tmpSqlPath = null;
        args = ['-Q', sqlStmt, String(tracePath)];
      }

      try {
        const proc = spawnSync(binaryPath, args, {
          encoding: 'utf8',
          timeout: timeoutMs,
          maxBuffer: 64 * 1024 * 1024,
        });
        if (proc.error) {
          throw new Error(`trace_processor_shell execution failed: ${proc.error.message}`);
        }
        if (proc.status !== 0) {
          const detail = (proc.stderr || proc.stdout || '').trim() || `exit code ${proc.status}`;
          throw new Error(`trace_processor_shell query failed: ${detail}`);
        }
        return parseRfc4180Csv(proc.stdout);
      } finally {
        if (tmpSqlPath) {
          try {
            fs.unlinkSync(tmpSqlPath);
          } catch {
            // Ignore temp cleanup race.
          }
        }
      }
    },
  };
}

function sqlEscapeLikeLiteral(substr) {
  return String(substr || '')
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
    .replace(/'/g, "''");
}

/**
 * Pure burst detector matching `analyze_motion_trace.py` (`minFrames = 5`, strict `>` gap,
 * `20ms` pre-roll clamped to `0.0`, `50ms` post-roll, `full_trace` `0..9999` fallback).
 */
export function detectBurstsFromFrameTimes(timesSec, gapSec, minFrames = 5) {
  const bursts = [];
  for (const t of timesSec) {
    if (bursts.length === 0 || (t - bursts[bursts.length - 1][bursts[bursts.length - 1].length - 1]) > gapSec) {
      bursts.push([t]);
    } else {
      bursts[bursts.length - 1].push(t);
    }
  }

  const windows = [];
  let idx = 1;
  for (const b of bursts) {
    if (b.length < minFrames) continue;
    windows.push({
      name: `burst_${idx}`,
      startSec: Math.max(0.0, b[0] - 0.02),
      endSec: b[b.length - 1] + 0.05,
    });
    idx += 1;
  }

  return windows.length > 0 ? windows : [{ name: 'full_trace', startSec: 0.0, endSec: 9999.0 }];
}

/**
 * Analyze a single trace using at most 2 `-Q` SQL passes.
 */
export function analyzeTraceWithRunner(runner, traceName, {
  processSubstr = '',
  explicitWindows = [],
  burstGapMs = 800.0,
  budgetMs = 8.33,
  topN = 3,
} = {}) {
  const procFilter = processSubstr
    ? `AND p.name LIKE '%${sqlEscapeLikeLiteral(processSubstr)}%' ESCAPE '\\'`
    : '';

  // Pass 1: Bounds + unfiltered & process-filtered table availability + main-thread top-level Choreographer#doFrame slices
  const pass1Sql = `
WITH bounds AS (SELECT start_ts, end_ts FROM trace_bounds)
SELECT
  'bounds' AS kind,
  CAST(start_ts AS TEXT) AS c1,
  CAST(end_ts AS TEXT) AS c2,
  '' AS c3,
  '' AS c4,
  '' AS c5,
  '' AS c6
FROM bounds
UNION ALL
SELECT
  'avail' AS kind,
  CAST((SELECT COUNT(*) FROM actual_frame_timeline_slice) AS TEXT) AS c1,
  CAST((SELECT COUNT(*) FROM slice WHERE name IN ('Recomposer:recompose', 'AndroidOwner:measureAndLayout', 'AndroidOwner:draw')) AS TEXT) AS c2,
  CAST((SELECT COUNT(*) FROM actual_frame_timeline_slice a JOIN process p USING (upid) WHERE 1 = 1 ${procFilter}) AS TEXT) AS c3,
  '' AS c4,
  '' AS c5,
  '' AS c6
UNION ALL
SELECT
  'doframe' AS kind,
  CAST(s.id AS TEXT) AS c1,
  CAST(s.ts AS TEXT) AS c2,
  CAST(s.dur AS TEXT) AS c3,
  CAST(s.track_id AS TEXT) AS c4,
  CAST((s.ts - (SELECT start_ts FROM bounds)) / 1e9 AS TEXT) AS c5,
  CAST(s.dur / 1e6 AS TEXT) AS c6
FROM slice s
JOIN thread_track tt ON s.track_id = tt.id
JOIN thread t USING (utid)
JOIN process p USING (upid)
WHERE t.is_main_thread = 1
  ${procFilter}
  AND s.name LIKE 'Choreographer#doFrame%'
  AND NOT EXISTS (
    SELECT 1 FROM slice parent_s
    WHERE parent_s.id = s.parent_id AND parent_s.name LIKE 'Choreographer#doFrame%'
  )
`;

  const pass1Rows = runner.query(pass1Sql);
  let startTsNs = 0n;
  let endTsNs = 0n;
  let frameTimelineTotalRows = 0;
  let frameTimelineProcessRows = 0;
  let composeSlicesTotalRows = 0;
  const doFrames = [];

  for (const r of pass1Rows) {
    if (r.kind === 'bounds') {
      startTsNs = safeBigInt(r.c1);
      endTsNs = safeBigInt(r.c2);
    } else if (r.kind === 'avail') {
      frameTimelineTotalRows = Number(r.c1 || 0);
      composeSlicesTotalRows = Number(r.c2 || 0);
      frameTimelineProcessRows = r.c3 !== undefined && r.c3 !== ''
        ? Number(r.c3 || 0)
        : frameTimelineTotalRows;
    } else if (r.kind === 'doframe') {
      const tsNs = safeBigInt(r.c2);
      const durNs = safeBigInt(r.c3);
      const sqlTSec = r.c5 !== undefined && r.c5 !== '' ? Number(r.c5) : null;
      const sqlDurMs = r.c6 !== undefined && r.c6 !== '' ? Number(r.c6) : null;
      doFrames.push({
        id: r.c1,
        tsNs,
        durNs,
        trackId: r.c4,
        sqlTSec: Number.isFinite(sqlTSec) ? sqlTSec : null,
        sqlDurMs: Number.isFinite(sqlDurMs) ? sqlDurMs : null,
      });
    }
  }

  // Sort chronologically by `tsNs` for burst detection
  doFrames.sort((a, b) => (a.tsNs < b.tsNs ? -1 : a.tsNs > b.tsNs ? 1 : 0));

  const decoratedFrames = doFrames.map((f) => ({
    ...f,
    tSec: f.sqlTSec !== null ? f.sqlTSec : Number(f.tsNs - startTsNs) / 1e9,
    durMs: f.sqlDurMs !== null ? f.sqlDurMs : Number(f.durNs) / 1e6,
  }));

  const windows = explicitWindows.length > 0
    ? explicitWindows
    : detectBurstsFromFrameTimes(
        decoratedFrames.map((f) => f.tSec),
        burstGapMs / 1000.0
      );

  // Partition UI frames per window (inclusive endpoints matching SQL `BETWEEN start AND end`)
  const windowPlans = windows.map((w, wIdx) => {
    const inWin = decoratedFrames
      .filter((f) => f.tSec >= w.startSec && f.tSec <= w.endSec)
      .sort((a, b) => (b.durNs > a.durNs ? 1 : b.durNs < a.durNs ? -1 : 0));
    const overBudgetFrames = inWin.filter((f) => f.durMs > budgetMs);
    const over16Frames = inWin.filter((f) => f.durMs > 16.67);
    const maxUiMs = inWin.length > 0 ? inWin[0].durMs : 0.0;
    const topSlow = overBudgetFrames.slice(0, Math.max(0, topN));
    return {
      wIdx,
      window: w,
      frameCount: inWin.length,
      overBudget: overBudgetFrames.length,
      over16: over16Frames.length,
      maxUiMs,
      topSlow,
    };
  });

  // Pass 2: Single tagged UNION ALL query across all windows (RT + SF) and all top-N slow frames (child slices)
  const unionParts = [];
  for (const wp of windowPlans) {
    const { wIdx, window: w } = wp;
    unionParts.push(`
SELECT
  'rt' AS kind,
  '${wIdx}' AS tag,
  CAST(COUNT(CASE WHEN s.name LIKE 'DrawFrame%' THEN 1 END) AS TEXT) AS v1,
  CAST(COUNT(CASE WHEN s.name LIKE 'DrawFrame%' AND s.dur / 1e6 > ${budgetMs} THEN 1 END) AS TEXT) AS v2,
  CAST(COALESCE(MAX(CASE WHEN s.name LIKE 'DrawFrame%' THEN s.dur / 1e6 END), 0) AS TEXT) AS v3,
  CAST(COUNT(CASE WHEN s.name LIKE '%alpha caused saveLayer%' THEN 1 END) AS TEXT) AS v4,
  CAST(COUNT(CASE WHEN s.name LIKE 'CreateGraphicsPipeline-CompileAfterCacheMiss%' THEN 1 END) AS TEXT) AS v5,
  CAST(COALESCE(SUM(CASE WHEN s.name LIKE 'CreateGraphicsPipeline-CompileAfterCacheMiss%' THEN s.dur / 1e6 END), 0) AS TEXT) AS v6,
  CAST(COALESCE(MAX(CASE WHEN s.name LIKE 'dequeueBuffer%' THEN s.dur / 1e6 END), 0) AS TEXT) AS v7
FROM slice s
JOIN thread_track tt ON s.track_id = tt.id
JOIN thread t USING (utid)
JOIN process p USING (upid)
WHERE t.name = 'RenderThread'
  ${procFilter}
  AND (s.ts - (SELECT start_ts FROM bounds)) / 1e9 BETWEEN ${w.startSec} AND ${w.endSec}
`);

    if (frameTimelineProcessRows > 0) {
      unionParts.push(`
SELECT
  'sf' AS kind,
  '${wIdx}' AS tag,
  CAST(COUNT(*) AS TEXT) AS v1,
  CAST(COALESCE(SUM(CASE WHEN a.jank_type GLOB '*App Deadline Missed*' THEN 1 ELSE 0 END), 0) AS TEXT) AS v2,
  CAST(COALESCE(SUM(CASE WHEN a.jank_type != 'None' AND a.jank_type != 'Buffer Stuffing' THEN 1 ELSE 0 END), 0) AS TEXT) AS v3,
  CAST(COALESCE(SUM(CASE WHEN a.on_time_finish = 0 THEN 1 ELSE 0 END), 0) AS TEXT) AS v4,
  '' AS v5,
  '' AS v6,
  '' AS v7
FROM actual_frame_timeline_slice a
JOIN process p USING (upid)
WHERE 1 = 1
  ${procFilter}
  AND (a.ts - (SELECT start_ts FROM bounds)) / 1e9 BETWEEN ${w.startSec} AND ${w.endSec}
`);
    }

    wp.topSlow.forEach((sf, rank) => {
      const endNs = sf.tsNs + sf.durNs;
      unionParts.push(`
SELECT
  'sub' AS kind,
  '${wIdx}:${rank}' AS tag,
  name AS v1,
  CAST(SUM(dur) / 1e6 AS TEXT) AS v2,
  '' AS v3,
  '' AS v4,
  '' AS v5,
  '' AS v6,
  '' AS v7
FROM slice
WHERE track_id = ${sf.trackId}
  AND ts >= ${sf.tsNs.toString()}
  AND ts + dur <= ${endNs.toString()}
  AND name IN (
    'Recomposer:recompose',
    'AndroidOwner:measureAndLayout',
    'AndroidOwner:draw',
    'relayoutWindow#first=true'
  )
GROUP BY name
`);
    });
  }

  const rtByWin = new Map();
  const sfByWin = new Map();
  const subByKey = new Map();

  if (unionParts.length > 0) {
    const pass2Sql = `WITH bounds AS (SELECT start_ts FROM trace_bounds)\n${unionParts.join('\nUNION ALL\n')}`;
    const pass2Rows = runner.query(pass2Sql);
    for (const r of pass2Rows) {
      if (r.kind === 'rt') {
        rtByWin.set(Number(r.tag), {
          drawCount: Number(r.v1 || 0),
          overBudget: Number(r.v2 || 0),
          maxMs: Number(r.v3 || 0),
          saveLayers: Number(r.v4 || 0),
          shaderMisses: Number(r.v5 || 0),
          shaderMs: Number(r.v6 || 0),
          maxDequeueMs: Number(r.v7 || 0),
        });
      } else if (r.kind === 'sf') {
        sfByWin.set(Number(r.tag), {
          available: true,
          frames: Number(r.v1 || 0),
          appJank: Number(r.v2 || 0),
          anyJank: Number(r.v3 || 0),
          late: Number(r.v4 || 0),
        });
      } else if (r.kind === 'sub') {
        if (!subByKey.has(r.tag)) subByKey.set(r.tag, {});
        subByKey.get(r.tag)[r.v1] = Number(r.v2 || 0);
      }
    }
  }

  const sfUnavailableStatus = frameTimelineTotalRows > 0 ? 'no-frames-for-process' : 'unavailable';

  const windowResults = windowPlans.map((wp) => {
    const rt = rtByWin.get(wp.wIdx) || {
      drawCount: 0,
      overBudget: 0,
      maxMs: 0,
      saveLayers: 0,
      shaderMisses: 0,
      shaderMs: 0,
      maxDequeueMs: 0,
    };
    const sf = frameTimelineProcessRows > 0
      ? (sfByWin.get(wp.wIdx) || { available: true, frames: 0, appJank: 0, anyJank: 0, late: 0 })
      : { available: false, status: sfUnavailableStatus };

    const slowFrames = wp.topSlow.map((f, rank) => {
      const subs = subByKey.get(`${wp.wIdx}:${rank}`) || {};
      return {
        tSec: f.tSec,
        doFrameMs: f.durMs,
        recomposeMs: subs['Recomposer:recompose'] ?? 0.0,
        measureMs: subs['AndroidOwner:measureAndLayout'] ?? 0.0,
        drawMs: subs['AndroidOwner:draw'] ?? 0.0,
        relayoutWindowFirstMs: subs['relayoutWindow#first=true'] ?? 0.0,
      };
    });

    return {
      name: wp.window.name,
      startSec: wp.window.startSec,
      endSec: wp.window.endSec,
      ui: {
        frames: wp.frameCount,
        overBudget: wp.overBudget,
        over16Ms: wp.over16,
        maxMs: wp.maxUiMs,
      },
      renderThread: rt,
      frameTimeline: sf,
      slowFrames,
    };
  });

  return {
    trace: traceName,
    boundsNs: {
      start: startTsNs.toString(),
      end: endTsNs.toString(),
    },
    tracks: {
      frameTimeline: frameTimelineProcessRows > 0 ? 'available' : sfUnavailableStatus,
      composeSlicesPresent: composeSlicesTotalRows > 0,
    },
    budgetMs,
    queryPasses: runner.queryCount,
    windows: windowResults,
  };
}

function safeBigInt(val) {
  const s = String(val ?? '').trim();
  if (!s) return 0n;
  try {
    return BigInt(s.split('.')[0]);
  } catch {
    return 0n;
  }
}

export function formatTraceSummaryText(summary) {
  const lines = [`=== ${summary.trace} ===`];
  const budgetLabel = roundHalfEvenFixed(summary.budgetMs, 1);

  for (const w of summary.windows) {
    const sfText = w.frameTimeline.available
      ? `SF: frames=${w.frameTimeline.frames}, appJank=${w.frameTimeline.appJank}, anyJank=${w.frameTimeline.anyJank}, late=${w.frameTimeline.late}`
      : w.frameTimeline.status === 'no-frames-for-process'
        ? 'SF: unavailable (0 actual_frame_timeline_slice rows matched target --process)'
        : 'SF: unavailable (actual_frame_timeline_slice not recorded in trace)';

    lines.push(
      `  [${w.name} ${roundHalfEvenFixed(w.startSec, 2)}..${roundHalfEvenFixed(w.endSec, 2)}s] ` +
      `UI: ${w.ui.frames} frames, >${budgetLabel}ms=${w.ui.overBudget}, >16.7ms=${w.ui.over16Ms}, max=${roundHalfEvenFixed(w.ui.maxMs, 2)}ms | ` +
      `RT: max=${roundHalfEvenFixed(w.renderThread.maxMs, 2)}ms, >${budgetLabel}ms=${w.renderThread.overBudget}, ` +
      `saveLayers=${w.renderThread.saveLayers}, shaderMisses=${w.renderThread.shaderMisses} (${roundHalfEvenFixed(w.renderThread.shaderMs, 2)}ms), ` +
      `maxDequeue=${roundHalfEvenFixed(w.renderThread.maxDequeueMs, 2)}ms | ` +
      sfText
    );

    for (const sf of w.slowFrames) {
      lines.push(
        `    t=${roundHalfEvenFixed(sf.tSec, 3)}s doFrame=${roundHalfEvenFixed(sf.doFrameMs, 2)}ms ` +
        `(recompose=${roundHalfEvenFixed(sf.recomposeMs, 2)}ms, measure=${roundHalfEvenFixed(sf.measureMs, 2)}ms, draw=${roundHalfEvenFixed(sf.drawMs, 2)}ms)`
      );
    }
  }
  return lines.join('\n');
}

/**
 * Compare before vs after trace summaries matched by window name (or single-burst index).
 */
export function compareTraceSummaries(beforeSummaries, afterSummaries) {
  const beforeByWin = collectWindowMedianOrMean(beforeSummaries);
  const afterByWin = collectWindowMedianOrMean(afterSummaries);

  const matchedNames = [];
  for (const name of beforeByWin.keys()) {
    if (afterByWin.has(name)) matchedNames.push(name);
  }
  // Single-window fallback if auto-detected burst names match (`burst_1` === `burst_1`) or 1 window each
  const pairs = [];
  if (matchedNames.length > 0) {
    for (const name of matchedNames) {
      pairs.push({ window: name, before: beforeByWin.get(name), after: afterByWin.get(name) });
    }
  } else if (beforeByWin.size === 1 && afterByWin.size === 1) {
    const [bName, bVal] = [...beforeByWin.entries()][0];
    const [aName, aVal] = [...afterByWin.entries()][0];
    pairs.push({ window: `${bName} -> ${aName}`, before: bVal, after: aVal });
  }

  return pairs.map(({ window, before, after }) => ({
    window,
    before,
    after,
    delta: {
      uiOverBudget: after.uiOverBudget - before.uiOverBudget,
      uiOver16Ms: after.uiOver16Ms - before.uiOver16Ms,
      uiMaxMs: round2(after.uiMaxMs - before.uiMaxMs),
      rtOverBudget: after.rtOverBudget - before.rtOverBudget,
      rtMaxMs: round2(after.rtMaxMs - before.rtMaxMs),
      saveLayers: after.saveLayers - before.saveLayers,
      shaderMisses: after.shaderMisses - before.shaderMisses,
      appJank: (before.sfAvailable && after.sfAvailable) ? (after.appJank - before.appJank) : 'unavailable',
      anyJank: (before.sfAvailable && after.sfAvailable) ? (after.anyJank - before.anyJank) : 'unavailable',
    },
  }));
}

function collectWindowMedianOrMean(summaries) {
  const buckets = new Map();
  for (const s of summaries) {
    for (const w of s.windows) {
      if (!buckets.has(w.name)) buckets.set(w.name, []);
      buckets.get(w.name).push(w);
    }
  }
  const agg = new Map();
  for (const [name, list] of buckets.entries()) {
    const avg = (fn) => round2(list.reduce((acc, x) => acc + fn(x), 0) / list.length);
    const sfAvail = list.every((x) => x.frameTimeline.available && x.frameTimeline.frames > 0);
    agg.set(name, {
      runs: list.length,
      uiFrames: avg((x) => x.ui.frames),
      uiOverBudget: avg((x) => x.ui.overBudget),
      uiOver16Ms: avg((x) => x.ui.over16Ms),
      uiMaxMs: avg((x) => x.ui.maxMs),
      rtOverBudget: avg((x) => x.renderThread.overBudget),
      rtMaxMs: avg((x) => x.renderThread.maxMs),
      saveLayers: avg((x) => x.renderThread.saveLayers),
      shaderMisses: avg((x) => x.renderThread.shaderMisses),
      sfAvailable: sfAvail,
      appJank: sfAvail ? avg((x) => x.frameTimeline.appJank) : null,
      anyJank: sfAvail ? avg((x) => x.frameTimeline.anyJank) : null,
    });
  }
  return agg;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

export async function runTraceCommand(rawArgs, io = defaultIo()) {
  const args = [...rawArgs];
  if (args[0] === 'trace') args.shift();

  let processSubstr = '';
  const explicitWindows = [];
  let burstGapMs = 800.0;
  let budgetMs = 8.33;
  let topN = 3;
  let explicitTp = null;
  let timeoutMs = 60000;
  let json = false;
  let compareMode = false;
  let seenDoubleDash = false;
  const tracesBefore = [];
  const tracesAfter = [];

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (!seenDoubleDash && (a === '--help' || a === '-h')) {
      io.stdout.write(TRACE_USAGE);
      return 0;
    }
    if (a === '--') {
      seenDoubleDash = true;
      continue;
    }
    if (!seenDoubleDash && a === '--json') {
      json = true;
    } else if (!seenDoubleDash && a === '--compare') {
      compareMode = true;
    } else if (!seenDoubleDash && (a === '--process' || a.startsWith('--process='))) {
      processSubstr = a.includes('=') ? a.slice('--process='.length) : (args[++i] ?? '');
    } else if (!seenDoubleDash && (a === '--window' || a.startsWith('--window='))) {
      const val = a.includes('=') ? a.slice('--window='.length) : args[++i];
      try {
        explicitWindows.push(parseWindowSpec(val));
      } catch (err) {
        io.stderr.write(`Error: ${err.message}\n`);
        return 1;
      }
    } else if (!seenDoubleDash && (a === '--burst-gap-ms' || a.startsWith('--burst-gap-ms='))) {
      const val = Number(a.includes('=') ? a.slice('--burst-gap-ms='.length) : args[++i]);
      if (!Number.isFinite(val) || val <= 0) {
        io.stderr.write('Error: --burst-gap-ms must be a positive number.\n');
        return 1;
      }
      burstGapMs = val;
    } else if (!seenDoubleDash && (a === '--budget-ms' || a.startsWith('--budget-ms='))) {
      const val = Number(a.includes('=') ? a.slice('--budget-ms='.length) : args[++i]);
      if (!Number.isFinite(val) || val <= 0) {
        io.stderr.write('Error: --budget-ms must be a positive number.\n');
        return 1;
      }
      budgetMs = val;
    } else if (!seenDoubleDash && (a === '--top' || a.startsWith('--top='))) {
      const val = Number.parseInt(a.includes('=') ? a.slice('--top='.length) : args[++i], 10);
      if (!Number.isFinite(val) || val < 0) {
        io.stderr.write('Error: --top must be a non-negative integer.\n');
        return 1;
      }
      topN = val;
    } else if (!seenDoubleDash && (a === '--trace-processor' || a.startsWith('--trace-processor='))) {
      explicitTp = a.includes('=') ? a.slice('--trace-processor='.length) : args[++i];
    } else if (!seenDoubleDash && (a === '--timeout-ms' || a.startsWith('--timeout-ms='))) {
      const val = Number.parseInt(a.includes('=') ? a.slice('--timeout-ms='.length) : args[++i], 10);
      if (!Number.isFinite(val) || val <= 0) {
        io.stderr.write('Error: --timeout-ms must be a positive integer.\n');
        return 1;
      }
      timeoutMs = val;
    } else if (!seenDoubleDash && a.startsWith('--')) {
      io.stderr.write(`Error: unknown trace option "${a}". Run android-ux trace --help.\n`);
      return 1;
    } else if (seenDoubleDash) {
      tracesAfter.push(a);
    } else {
      tracesBefore.push(a);
    }
  }

  if (compareMode && (tracesBefore.length === 0 || tracesAfter.length === 0)) {
    io.stderr.write('Error: --compare requires at least one before trace and one after trace separated by `--`.\n  Example: npx android-ux trace --process com.app --compare before_1.perfetto-trace -- after_1.perfetto-trace\n');
    return 1;
  }

  const allTraces = compareMode ? [...tracesBefore, ...tracesAfter] : tracesBefore;
  if (allTraces.length === 0) {
    io.stderr.write('Error: pass at least one .perfetto-trace file. Run android-ux trace --help.\n');
    return 1;
  }

  for (const t of allTraces) {
    const abs = path.resolve(io.cwd, t);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      io.stderr.write(`Error: trace file not found: ${t}\n`);
      return 1;
    }
  }

  const tpResolution = resolveTraceProcessor({
    explicitPath: explicitTp ? path.resolve(io.cwd, explicitTp) : null,
    env: io.env,
    platform: io.platform || process.platform,
  });
  const tpBinary = tpResolution.binaryPath;

  if ((io.platform || process.platform) === 'win32' && tpBinary && /\.(cmd|bat)$/i.test(tpBinary)) {
    const diag = createDiagnostic({
      code: 'AUX-TRACE-004',
      severity: 'error',
      status: 'fail',
      domain: 'trace',
      summary: `Perfetto trace processor resolved to a Windows batch shim (${tpBinary}), which cannot be spawned directly without cmd.exe.`,
      impact: `\`npx android-ux trace\` refuses shell-spawning .cmd/.bat shims on Windows.`,
      remediation: [
        'Pass the native `trace_processor_shell.exe` binary directly via `--trace-processor C:\\path\\to\\trace_processor_shell.exe`,',
        'or set `ANDROID_UX_TRACE_PROCESSOR` to the `.exe` path.',
      ],
      docPath: 'references/perfetto-workflow.md',
    });
    if (json) {
      io.stdout.write(`${JSON.stringify(createJsonEnvelope('trace', { status: 'error', diagnostic: diag }), null, 2)}\n`);
    } else {
      io.stderr.write(`${formatDiagnosticText(diag)}\n`);
    }
    return 1;
  }

  if (!tpBinary) {
    const wrapperHint = tpResolution.wrapperPath
      ? `Found Python network wrapper at ${tpResolution.wrapperPath}, which \`android-ux trace\` refuses to invoke directly to stay offline-safe.`
      : 'Perfetto trace processor (`trace_processor_shell`) is not installed or not on PATH.';
    const diag = createDiagnostic({
      code: tpResolution.wrapperPath ? 'AUX-TRACE-003' : 'AUX-TRACE-001',
      severity: 'error',
      status: 'fail',
      domain: 'trace',
      summary: wrapperHint,
      searched: ['--trace-processor', '~/.local/share/perfetto/prebuilts/', '$PATH (trace_processor_shell, trace_processor)'],
      impact: `\`npx android-ux trace\` cannot analyze ${path.basename(allTraces[0])}. (\`detect\`, \`context\`, and \`doctor\` still work.)`,
      remediation: tpResolution.wrapperPath
        ? [
            `Run \`"${tpResolution.wrapperPath}" --version\` once while online to cache the native binary under ~/.local/share/perfetto/prebuilts/,`,
            'or download a standalone native `trace_processor_shell` binary from https://github.com/google/perfetto/releases/latest.',
          ]
        : (io.platform || process.platform) === 'win32'
          ? [
              'Download windows-amd64 trace_processor_shell.exe from https://github.com/google/perfetto/releases/latest',
              'Or pass an existing binary via `--trace-processor C:\\path\\to\\trace_processor_shell.exe`.',
            ]
          : [
              'Download native `trace_processor_shell` from https://github.com/google/perfetto/releases/latest (or run Perfetto\'s `get.perfetto.dev/trace_processor --version` once online to populate ~/.local/share/perfetto/prebuilts/)',
              'Or pass an existing binary via `--trace-processor /path/to/trace_processor_shell`.',
            ],
      docPath: 'references/perfetto-workflow.md',
    });
    if (json) {
      io.stdout.write(`${JSON.stringify(createJsonEnvelope('trace', { status: 'error', diagnostic: diag }), null, 2)}\n`);
    } else {
      io.stderr.write(`${formatDiagnosticText(diag)}\n`);
    }
    return 1;
  }

  try {
    const analyzeList = (paths) =>
      paths.map((t) => {
        const abs = path.resolve(io.cwd, t);
        const runner = createShellSqlRunner(tpBinary, abs, { timeoutMs });
        return analyzeTraceWithRunner(runner, path.basename(abs), {
          processSubstr,
          explicitWindows,
          burstGapMs,
          budgetMs,
          topN,
        });
      });

    if (!compareMode) {
      const summaries = analyzeList(tracesBefore);
      if (json) {
        io.stdout.write(`${JSON.stringify(createJsonEnvelope('trace', {
          status: 'ok',
          traceProcessor: tpBinary,
          traces: summaries,
        }), null, 2)}\n`);
      } else {
        for (const s of summaries) {
          io.stdout.write(`${formatTraceSummaryText(s)}\n`);
        }
      }
      return 0;
    }

    const beforeSummaries = analyzeList(tracesBefore);
    const afterSummaries = analyzeList(tracesAfter);
    const comparisons = compareTraceSummaries(beforeSummaries, afterSummaries);

    if (json) {
      io.stdout.write(`${JSON.stringify(createJsonEnvelope('trace.compare', {
        status: 'ok',
        traceProcessor: tpBinary,
        before: beforeSummaries,
        after: afterSummaries,
        comparisons,
      }), null, 2)}\n`);
    } else {
      for (const s of [...beforeSummaries, ...afterSummaries]) {
        io.stdout.write(`${formatTraceSummaryText(s)}\n`);
      }
      io.stdout.write('=== Comparison (after - before) ===\n');
      if (comparisons.length === 0) {
        io.stdout.write('  No matching window names between before and after traces; pass explicit --window NAME:START:END to align windows.\n');
      } else {
        for (const c of comparisons) {
          const fmtDelta = (v, suffix = '') => (typeof v === 'number' ? `${v > 0 ? '+' : ''}${v}${suffix}` : v);
          io.stdout.write(
            `  [${c.window}] UI >budget: ${fmtDelta(c.delta.uiOverBudget)}, UI max: ${fmtDelta(c.delta.uiMaxMs, 'ms')} | ` +
            `RT >budget: ${fmtDelta(c.delta.rtOverBudget)}, RT max: ${fmtDelta(c.delta.rtMaxMs, 'ms')}, ` +
            `saveLayers: ${fmtDelta(c.delta.saveLayers)}, shaderMisses: ${fmtDelta(c.delta.shaderMisses)} | ` +
            `SF appJank: ${fmtDelta(c.delta.appJank)}, anyJank: ${fmtDelta(c.delta.anyJank)}\n`
          );
        }
      }
    }
    return 0;
  } catch (err) {
    io.stderr.write(`Error: ${err?.message || String(err)}\n`);
    return 1;
  }
}

function defaultIo() {
  return {
    cwd: process.cwd(),
    env: process.env,
    platform: process.platform,
    stdout: process.stdout,
    stderr: process.stderr,
  };
}
