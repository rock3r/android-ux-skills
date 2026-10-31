import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  parseRfc4180Csv,
  roundHalfEvenFixed,
  analyzeTraceWithRunner,
  compareTraceSummaries,
  isPythonPerfettoWrapper,
  resolveTraceProcessor,
  runCli,
} from '../src/index.mjs';
import { parseWindowSpec, detectBurstsFromFrameTimes, formatTraceSummaryText } from '../src/commands/trace.mjs';

test('trace: RFC-4180 CSV parser handles quotes, commas, multiline fields, and CRLF', () => {
  const csv = [
    '"kind","c1","c2"',
    '"bounds","100000000000","105000000000"',
    '"note","hello, ""world""","line1\nline2"',
    '',
  ].join('\r\n');

  const rows = parseRfc4180Csv(csv);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { kind: 'bounds', c1: '100000000000', c2: '105000000000' });
  assert.deepEqual(rows[1], { kind: 'note', c1: 'hello, "world"', c2: 'line1\nline2' });
});

test('trace: roundHalfEvenFixed matches Python IEEE-754 round-half-to-even formatting', () => {
  assert.equal(roundHalfEvenFixed(1.125, 2), '1.12');
  assert.equal(roundHalfEvenFixed(1.135, 2), '1.14');
  assert.equal(roundHalfEvenFixed(1.375, 2), '1.38');
  assert.equal(roundHalfEvenFixed(1.625, 2), '1.62');
  assert.equal(roundHalfEvenFixed(2.5, 0), '2');
  assert.equal(roundHalfEvenFixed(3.5, 0), '4');
  assert.equal(roundHalfEvenFixed(8.33, 1), '8.3');
  assert.equal(roundHalfEvenFixed(-1.125, 2), '-1.12');
  assert.equal(roundHalfEvenFixed(0, 3), '0.000');
});

test('trace: parseWindowSpec rejects empty bounds, NaN, Infinity, and inverted ranges', () => {
  assert.deepEqual(parseWindowSpec('open_sheet:1.25:2.75'), {
    name: 'open_sheet',
    startSec: 1.25,
    endSec: 2.75,
  });
  for (const invalid of ['', 'no_bounds', 'w::1.0', 'w:0.5:', 'w:NaN:2.0', 'w:0:Infinity', 'w:3.0:2.0', 'w:2.0:2.0']) {
    assert.throws(() => parseWindowSpec(invalid));
  }
});

test('trace: detectBurstsFromFrameTimes applies minFrames=5, 20ms pre-roll, 50ms post-roll, and full_trace fallback', () => {
  // 3 isolated frames (<5) + 5-frame burst starting at 1.000s..1.064s
  const times = [0.01, 0.02, 0.03, 1.0, 1.016, 1.032, 1.048, 1.064];
  const bursts = detectBurstsFromFrameTimes(times, 0.8);
  assert.equal(bursts.length, 1);
  assert.equal(bursts[0].name, 'burst_1');
  assert.equal(roundHalfEvenFixed(bursts[0].startSec, 2), '0.98');
  assert.equal(roundHalfEvenFixed(bursts[0].endSec, 3), '1.114');

  assert.deepEqual(detectBurstsFromFrameTimes([0.1, 0.2], 0.8), [
    { name: 'full_trace', startSec: 0, endSec: 9999 },
  ]);
});

test('trace: <=2 SQL passes, BigInt ns bounds, and FrameTimeline unavailable vs 0 jank distinction', () => {
  const queries = [];
  const startNs = 900719925474099300n; // Exceeds Number.MAX_SAFE_INTEGER to exercise BigInt math

  const mockRunnerWithSfTable = {
    get queryCount() {
      return queries.length;
    },
    query(sql) {
      queries.push(sql);
      if (queries.length === 1) {
        return [
          { kind: 'bounds', c1: startNs.toString(), c2: (startNs + 5_000_000_000n).toString(), c3: '', c4: '', c5: '', c6: '' },
          // Unfiltered `actual_frame_timeline_slice` has 40 rows in trace, even if window 2 has 0 rows!
          { kind: 'avail', c1: '40', c2: '10', c3: '', c4: '', c5: '', c6: '' },
          { kind: 'doframe', c1: '101', c2: (startNs + 1_000_000_000n).toString(), c3: '12500000', c4: '7', c5: '1.0', c6: '12.5' },
          { kind: 'doframe', c1: '102', c2: (startNs + 1_016_000_000n).toString(), c3: '6000000', c4: '7', c5: '1.016', c6: '6.0' },
        ];
      }
      return [
        { kind: 'rt', tag: '0', v1: '2', v2: '1', v3: '9.125', v4: '2', v5: '1', v6: '4.5', v7: '1.25' },
        { kind: 'sf', tag: '0', v1: '0', v2: '0', v3: '0', v4: '0', v5: '', v6: '', v7: '' },
        { kind: 'sub', tag: '0:0', v1: 'Recomposer:recompose', v2: '7.125', v3: '', v4: '', v5: '', v6: '', v7: '' },
        { kind: 'sub', tag: '0:0', v1: 'AndroidOwner:measureAndLayout', v2: '3.25', v3: '', v4: '', v5: '', v6: '', v7: '' },
        { kind: 'rt', tag: '1', v1: '0', v2: '0', v3: '0', v4: '0', v5: '0', v6: '0', v7: '0' },
        { kind: 'sf', tag: '1', v1: '0', v2: '0', v3: '0', v4: '0', v5: '', v6: '', v7: '' },
      ];
    },
  };

  const summary = analyzeTraceWithRunner(mockRunnerWithSfTable, 'before_1.perfetto-trace', {
    processSubstr: 'com.example.app',
    explicitWindows: [
      { name: 'win_a', startSec: 0.9, endSec: 1.5 },
      { name: 'win_empty', startSec: 2.0, endSec: 3.0 },
    ],
  });

  assert.equal(summary.queryPasses, 2, 'Must execute at most 2 SQL passes regardless of window count');
  assert.equal(summary.tracks.frameTimeline, 'available');
  assert.equal(summary.windows[1].frameTimeline.available, true, 'Empty window when SF table exists must report 0 frames, not unavailable');
  assert.equal(summary.windows[1].frameTimeline.frames, 0);

  const formatted = formatTraceSummaryText(summary);
  assert.match(formatted, /RT: max=9\.12ms/); // 9.125 -> 9.12 via round-half-even
  assert.match(formatted, /recompose=7\.12ms/); // 7.125 -> 7.12 via round-half-even

  // Now verify missing FrameTimeline table (`c1 = '0'`) reports `unavailable` and compare preserves `unavailable`
  let q2 = 0;
  const mockNoSfRunner = {
    get queryCount() { return q2; },
    query() {
      q2 += 1;
      if (q2 === 1) {
        return [
          { kind: 'bounds', c1: '0', c2: '2000000000', c3: '', c4: '', c5: '', c6: '' },
          { kind: 'avail', c1: '0', c2: '0', c3: '', c4: '', c5: '', c6: '' },
          { kind: 'doframe', c1: '1', c2: '500000000', c3: '4000000', c4: '1', c5: '0.5', c6: '4.0' },
        ];
      }
      return [{ kind: 'rt', tag: '0', v1: '1', v2: '0', v3: '3.0', v4: '0', v5: '0', v6: '0', v7: '0.2' }];
    },
  };

  const afterNoSf = analyzeTraceWithRunner(mockNoSfRunner, 'after_1.perfetto-trace', {
    explicitWindows: [{ name: 'win_a', startSec: 0.0, endSec: 1.5 }],
  });
  assert.equal(afterNoSf.tracks.frameTimeline, 'unavailable');
  assert.equal(afterNoSf.windows[0].frameTimeline.available, false);

  const cmp = compareTraceSummaries([summary], [afterNoSf]);
  assert.equal(cmp.length, 1);
  assert.equal(cmp[0].delta.uiOverBudget, -1);
  assert.equal(cmp[0].delta.appJank, 'unavailable');
});

test('trace: Python Perfetto wrapper shebang guard stays 100% offline + multi-directory POSIX/Windows PATH splitting', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aux-tp-wrap-'));
  try {
    const emptyFirst = path.join(tmpDir, 'empty');
    const fakeBinDir = path.join(tmpDir, 'bin');
    const fakeHome = path.join(tmpDir, 'home');
    fs.mkdirSync(emptyFirst, { recursive: true });
    fs.mkdirSync(fakeBinDir, { recursive: true });
    fs.mkdirSync(fakeHome, { recursive: true });

    const pyWrapper = path.join(fakeBinDir, 'trace_processor_shell');
    fs.writeFileSync(
      pyWrapper,
      '#!/usr/bin/env python3\nimport urllib.request; raise SystemExit("NETWORK_CALLED")\n',
      { mode: 0o755 }
    );
    assert.equal(isPythonPerfettoWrapper(pyWrapper), true);

    const multiRealPath = [emptyFirst, fakeBinDir].join(path.delimiter);
    const resolved = resolveTraceProcessor({
      env: { PATH: multiRealPath, HOME: fakeHome, USERPROFILE: fakeHome },
      platform: process.platform,
    });
    assert.equal(resolved.binaryPath, null);
    assert.equal(resolved.wrapperPath, pyWrapper);

    // Explicit multi-directory POSIX PATH (`/opt/empty:/opt/perfetto/bin:/usr/bin`)
    const posixResolved = resolveTraceProcessor({
      env: { PATH: '/opt/empty:/opt/perfetto/bin:/usr/bin', HOME: fakeHome },
      platform: 'linux',
      existsFile: (p) => p === '/opt/perfetto/bin/trace_processor_shell',
      isWrapper: () => false,
    });
    assert.equal(posixResolved.binaryPath, '/opt/perfetto/bin/trace_processor_shell');

    // Explicit multi-directory Windows PATH (`C:\Empty;D:\Perfetto\bin;C:\Windows\System32`)
    const winResolved = resolveTraceProcessor({
      env: { PATH: 'C:\\Empty;D:\\Perfetto\\bin;C:\\Windows\\System32', USERPROFILE: fakeHome },
      platform: 'win32',
      existsFile: (p) => p === 'D:\\Perfetto\\bin\\trace_processor_shell.exe',
      isWrapper: () => false,
    });
    assert.equal(winResolved.binaryPath, 'D:\\Perfetto\\bin\\trace_processor_shell.exe');

    // `android-ux trace` must refuse to execute the Python wrapper and return AUX-TRACE-003
    const dummyTrace = path.join(tmpDir, 'sample.perfetto-trace');
    fs.writeFileSync(dummyTrace, 'stub', 'utf8');
    let out = '';
    const code = await runCli(['trace', '--json', dummyTrace], {
      cwd: tmpDir,
      env: { PATH: multiRealPath, HOME: fakeHome, USERPROFILE: fakeHome },
      platform: process.platform,
      stdout: { write: (s) => { out += s; } },
      stderr: { write: () => {} },
    });
    assert.equal(code, 1);
    const parsed = JSON.parse(out);
    assert.equal(parsed.diagnostic.code, 'AUX-TRACE-003');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('trace regressions: SQL LIKE escaping, per-process 0 FrameTimeline rows -> unavailable, and Windows .cmd refusal', async () => {
  const capturedSql = [];
  const runner = {
    get queryCount() { return capturedSql.length; },
    query(sql) {
      capturedSql.push(sql);
      if (capturedSql.length === 1) {
        return [
          { kind: 'bounds', c1: '0', c2: '1000000000', c3: '', c4: '', c5: '', c6: '' },
          // Global SF table has 55 rows (e.g. SystemUI), target process has 0 (`c3 = '0'`)!
          { kind: 'avail', c1: '55', c2: '4', c3: '0', c4: '', c5: '', c6: '' },
          { kind: 'doframe', c1: '1', c2: '100000000', c3: '5000000', c4: '1', c5: '0.1', c6: '5.0' },
        ];
      }
      return [{ kind: 'rt', tag: '0', v1: '1', v2: '0', v3: '3.0', v4: '0', v5: '0', v6: '0', v7: '0.1' }];
    },
  };

  const sum = analyzeTraceWithRunner(runner, 'proc_filtered.perfetto-trace', {
    processSubstr: 'com.my_app%1',
    explicitWindows: [{ name: 'w1', startSec: 0, endSec: 1 }],
  });
  assert.match(capturedSql[0], /LIKE '%com\.my\\_app\\%1%' ESCAPE '\\'/);
  assert.equal(sum.tracks.frameTimeline, 'no-frames-for-process');
  assert.equal(sum.windows[0].frameTimeline.available, false);

  const cmp = compareTraceSummaries([sum], [sum]);
  assert.equal(cmp[0].delta.appJank, 'unavailable');

  // Windows `.cmd` shim refused with AUX-TRACE-004
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aux-tp-win-'));
  try {
    const cmdShim = path.join(tmpDir, 'trace_processor_shell.cmd');
    const dummyTrace = path.join(tmpDir, 't.perfetto-trace');
    fs.writeFileSync(cmdShim, '@echo off\r\n', 'utf8');
    fs.writeFileSync(dummyTrace, 'stub', 'utf8');
    let out = '';
    const code = await runCli(['trace', '--json', '--trace-processor', cmdShim, dummyTrace], {
      cwd: tmpDir,
      env: {},
      platform: 'win32',
      stdout: { write: (s) => { out += s; } },
      stderr: { write: () => {} },
    });
    assert.equal(code, 1);
    assert.equal(JSON.parse(out).diagnostic.code, 'AUX-TRACE-004');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
