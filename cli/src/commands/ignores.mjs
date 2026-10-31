import fs from 'node:fs';
import path from 'node:path';
import { createJsonEnvelope } from '../diagnostics.mjs';
import {
  readProjectConfig,
  readEditableConfigObject,
  writeConfigObject,
  normalizeWaiverEntry,
  waiverKey,
  normalizePosixPath,
  getSharedConfigPath,
  getLocalConfigPath,
} from '../config.mjs';
import { findRuleById } from '../domains/registry.mjs';
import { runStaticScan } from './detect.mjs';
import { STANDARDS_VERSION } from '../version.mjs';

const IGNORES_USAGE = `Usage: android-ux ignores <list|add|remove|prune> [options]

Manage narrow, auditable static-detector waivers in .android-ux/config.json (shared)
or .android-ux/config.local.json (personal, excluded via <gitdir>/info/exclude).

Subcommands:
  list [--json]
      List configured waivers and their live freshness status (used, proven-unused, unknown, expired).

  add <RULE_ID> --reason "<why>" [--file <path-or-glob>]... [--value "<substr>"]
      [--kind waiver|false-positive] [--expires YYYY-MM-DD] [--shared|--local] [--json]
      Add or update a waiver. Floor and obligation rules (F-*, O-*) cannot be waived as
      design preferences: they only accept --kind false-positive scoped to explicit --file path(s).

  remove <RULE_ID> [--file <path-or-glob>]... [--value "<substr>"] [--shared|--local] [--json]
      Remove matching waiver entries.

  prune [--shared|--local] [--yes] [--dry-run] [--json]
      Remove proven-unused and expired waivers (defaults to personal config.local.json;
      pass --yes or --shared to also prune committed team waivers in config.json).
`;

export async function runIgnoresCommand(rawArgs, io = defaultIo()) {
  const args = [...rawArgs];
  if (args[0] === 'ignores' || args[0] === 'ignore') args.shift();

  if (args.includes('--help') || args.includes('-h')) {
    io.stdout.write(IGNORES_USAGE);
    return 0;
  }

  const sub = (args[0] && !args[0].startsWith('--')) ? args.shift().toLowerCase() : 'list';
  if (!['list', 'add', 'remove', 'prune'].includes(sub)) {
    io.stderr.write(`Error: unknown ignores subcommand "${sub}". Valid: list, add, remove, prune\n`);
    return 1;
  }

  if (sub === 'list') return handleList(args, io);
  if (sub === 'add') return handleAdd(args, io);
  if (sub === 'remove') return handleRemove(args, io);
  return handlePrune(args, io);
}

function handleList(args, io) {
  const json = args.includes('--json');
  const config = readProjectConfig(io.cwd);

  // Run full scan only if waivers exist so `ignores list` stays zero-footprint and fast
  let auditEntries = [];
  if (config.waivers.length > 0) {
    const scan = runStaticScan({ targets: [io.cwd], cwd: io.cwd });
    auditEntries = scan.waiverAudit;
  }

  if (json) {
    io.stdout.write(`${JSON.stringify(createJsonEnvelope('ignores.list', {
      waivers: auditEntries.map((a) => ({
        ...a.waiver,
        source: a.source,
        usageStatus: a.usageStatus,
        expired: a.expired,
        missingFiles: a.missingFiles,
        issues: a.issues,
      })),
    }), null, 2)}\n`);
    return 0;
  }

  if (auditEntries.length === 0) {
    io.stdout.write('No waivers configured (.android-ux/config*.json).\n');
    return 0;
  }

  for (const a of auditEntries) {
    const w = a.waiver;
    const scopeStr = w.files?.length ? ` files=[${w.files.join(', ')}]` : ' (project-wide)';
    const valStr = w.value ? ` value="${w.value}"` : '';
    const expStr = w.expiresAt ? ` expires=${w.expiresAt}` : '';
    const statusTag = a.issues.length > 0 ? `${a.usageStatus}; ${a.issues.join(', ')}` : a.usageStatus;
    io.stdout.write(`[${a.source}] ${w.rule} (${w.kind})${scopeStr}${valStr}${expStr} -> ${statusTag}\n  Reason: ${w.reason}\n`);
  }
  return 0;
}

function handleAdd(args, io) {
  let ruleId = null;
  let reason = '';
  let value = '';
  let kind = null;
  let expiresAt = '';
  let scopeFlag = null;
  let json = false;
  const files = [];

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--json') {
      json = true;
    } else if (a === '--shared') {
      if (scopeFlag === 'local') {
        io.stderr.write('Error: pass only one of --shared or --local\n');
        return 1;
      }
      scopeFlag = 'shared';
    } else if (a === '--local') {
      if (scopeFlag === 'shared') {
        io.stderr.write('Error: pass only one of --shared or --local\n');
        return 1;
      }
      scopeFlag = 'local';
    } else if (a === '--reason' || a.startsWith('--reason=')) {
      reason = a.includes('=') ? a.slice('--reason='.length) : (args[++i] || '');
    } else if (a === '--value' || a.startsWith('--value=')) {
      value = a.includes('=') ? a.slice('--value='.length) : (args[++i] || '');
    } else if (a === '--kind' || a.startsWith('--kind=')) {
      kind = a.includes('=') ? a.slice('--kind='.length) : (args[++i] || '');
    } else if (a === '--expires' || a.startsWith('--expires=')) {
      expiresAt = a.includes('=') ? a.slice('--expires='.length) : (args[++i] || '');
    } else if (a === '--file' || a === '--files' || a.startsWith('--file=') || a.startsWith('--files=')) {
      const f = a.includes('=') ? a.slice(a.indexOf('=') + 1) : (args[++i] || '');
      if (!f || f.startsWith('--')) {
        io.stderr.write('Error: --file requires a non-empty path or glob\n');
        return 1;
      }
      files.push(normalizePosixPath(f));
    } else if (a.startsWith('--')) {
      io.stderr.write(`Error: unknown option "${a}" for ignores add\n`);
      return 1;
    } else if (!ruleId) {
      ruleId = a.trim().toUpperCase();
    } else {
      io.stderr.write(`Error: unexpected positional argument "${a}"\n`);
      return 1;
    }
  }

  if (!ruleId) {
    io.stderr.write('Error: missing <RULE_ID>. Example: npx android-ux ignores add T-002 --file app/Legacy.kt --reason "Legacy screen frozen until Q3"\n');
    return 1;
  }

  const ruleMeta = findRuleById(ruleId);
  if (!ruleMeta) {
    io.stderr.write(`Error: unknown rule ID "${ruleId}". Run \`npx android-ux detect --list-rules\` to view valid rule IDs.\n`);
    return 1;
  }

  if (!reason.trim()) {
    io.stderr.write('Error: --reason "<why>" is mandatory when adding a waiver.\n');
    return 1;
  }

  if (expiresAt && !/^\d{4}-\d{2}-\d{2}$/.test(expiresAt)) {
    io.stderr.write('Error: --expires must use YYYY-MM-DD format.\n');
    return 1;
  }

  const effectiveKind = kind ? kind.trim().toLowerCase() : (ruleMeta.overridable ? 'waiver' : null);
  if (!effectiveKind || !['waiver', 'false-positive'].includes(effectiveKind)) {
    io.stderr.write(
      `Error: rule ${ruleId} (${ruleMeta.class}) is not overridable as a design waiver. ` +
      `Only --kind false-positive with explicit --file <path> is permitted on floor and obligation rules.\n`
    );
    return 1;
  }

  const normalizedFiles = [];
  if (!ruleMeta.overridable) {
    if (effectiveKind !== 'false-positive') {
      io.stderr.write(
        `Error: rule ${ruleId} (${ruleMeta.class}) cannot be waived with --kind waiver. ` +
        `If suppressing a scanner false positive, pass --kind false-positive and an explicit --file <path>.\n`
      );
      return 1;
    }
    if (files.length === 0 || files.some((f) => /[*?[\]{}]/.test(f))) {
      io.stderr.write(
        `Error: false-positive suppression for ${ruleId} (${ruleMeta.class}) requires an explicit literal --file <path> (globs/wildcards are not allowed).\n`
      );
      return 1;
    }
    const resolvedRoot = path.resolve(io.cwd);
    for (const f of files) {
      const abs = path.resolve(resolvedRoot, f);
      const rel = path.relative(resolvedRoot, abs);
      let isFile = false;
      try {
        isFile = fs.existsSync(abs) && fs.statSync(abs).isFile();
      } catch {
        isFile = false;
      }
      if (!isFile || !rel || rel.startsWith('..') || path.isAbsolute(rel)) {
        io.stderr.write(
          `Error: false-positive --file "${f}" for ${ruleId} must resolve to an existing file inside ${resolvedRoot}.\n`
        );
        return 1;
      }
      normalizedFiles.push(normalizePosixPath(rel));
    }
  } else {
    const resolvedRoot = path.resolve(io.cwd);
    for (const f of files) {
      if (!/[*?[\]{}]/.test(f)) {
        const abs = path.resolve(resolvedRoot, f);
        const rel = path.relative(resolvedRoot, abs);
        if (rel && !rel.startsWith('..') && !path.isAbsolute(rel) && fs.existsSync(abs)) {
          normalizedFiles.push(normalizePosixPath(rel));
          continue;
        }
      }
      normalizedFiles.push(f);
    }
  }

  const isLocal = scopeFlag === 'local';
  const entry = normalizeWaiverEntry({
    rule: ruleId,
    ...(value.trim() ? { value: value.trim() } : {}),
    ...(normalizedFiles.length > 0 ? { files: normalizedFiles } : {}),
    kind: effectiveKind,
    reason: reason.trim(),
    createdAt: new Date().toISOString().slice(0, 10),
    standardsVersion: STANDARDS_VERSION,
    ...(expiresAt ? { expiresAt } : {}),
  }, isLocal ? 'local' : 'shared');

  const rawObj = readEditableConfigObject(io.cwd, { local: isLocal });
  const existingWaivers = Array.isArray(rawObj.waivers)
    ? rawObj.waivers.map((x) => normalizeWaiverEntry(x)).filter(Boolean)
    : [];

  const targetKey = waiverKey(entry);
  const idx = existingWaivers.findIndex((x) => waiverKey(x) === targetKey);
  if (idx !== -1) {
    existingWaivers[idx] = entry;
  } else {
    existingWaivers.push(entry);
  }
  rawObj.waivers = existingWaivers;
  const writtenPath = writeConfigObject(io.cwd, rawObj, { local: isLocal });

  if (json) {
    io.stdout.write(`${JSON.stringify(createJsonEnvelope('ignores.add', {
      file: writtenPath,
      waiver: entry,
    }), null, 2)}\n`);
  } else {
    io.stdout.write(`Saved ${effectiveKind} for ${ruleId} in ${isLocal ? '.android-ux/config.local.json' : '.android-ux/config.json'}.\n`);
  }
  return 0;
}

function handleRemove(args, io) {
  let ruleId = null;
  let value = null;
  let scopeFlag = null;
  let json = false;
  const files = [];

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--json') json = true;
    else if (a === '--shared') scopeFlag = 'shared';
    else if (a === '--local') scopeFlag = 'local';
    else if (a === '--value' || a.startsWith('--value=')) {
      value = a.includes('=') ? a.slice('--value='.length) : (args[++i] || '');
    } else if (a === '--file' || a === '--files' || a.startsWith('--file=') || a.startsWith('--files=')) {
      const f = a.includes('=') ? a.slice(a.indexOf('=') + 1) : (args[++i] || '');
      if (f) files.push(normalizePosixPath(f));
    } else if (!a.startsWith('--') && !ruleId) {
      ruleId = a.trim().toUpperCase();
    } else {
      io.stderr.write(`Error: unknown or unexpected argument "${a}"\n`);
      return 1;
    }
  }

  if (!ruleId) {
    io.stderr.write('Error: pass <RULE_ID> to ignores remove.\n');
    return 1;
  }

  const targetsToEdit = scopeFlag === 'local'
    ? [true]
    : scopeFlag === 'shared'
      ? [false]
      : [false, true];

  let removedCount = 0;
  for (const isLocal of targetsToEdit) {
    const cfgPath = isLocal ? getLocalConfigPath(io.cwd) : getSharedConfigPath(io.cwd);
    if (!fs.existsSync(cfgPath)) continue;
    const rawObj = readEditableConfigObject(io.cwd, { local: isLocal });
    if (!Array.isArray(rawObj.waivers) || rawObj.waivers.length === 0) continue;

    const sortedFiles = [...files].sort().join('\x1f');
    const kept = [];
    for (const raw of rawObj.waivers) {
      const norm = normalizeWaiverEntry(raw);
      if (!norm) continue;
      const matchesRule = norm.rule === ruleId;
      const matchesVal = value === null || (norm.value || '') === value;
      const matchesFiles = files.length === 0 || (norm.files || []).join('\x1f') === sortedFiles;
      if (matchesRule && matchesVal && matchesFiles) {
        removedCount += 1;
      } else {
        kept.push(norm);
      }
    }
    if (kept.length !== rawObj.waivers.length) {
      rawObj.waivers = kept;
      cleanupOrWriteConfig(io.cwd, rawObj, isLocal, cfgPath);
    }
  }

  if (json) {
    io.stdout.write(`${JSON.stringify(createJsonEnvelope('ignores.remove', { removedCount }), null, 2)}\n`);
  } else {
    io.stdout.write(`Removed ${removedCount} waiver(s) matching ${ruleId}.\n`);
  }
  return 0;
}

export function pruneStaleWaivers(cwd, { scopeFlag = null, includeShared = false, dryRun = false } = {}) {
  const config = readProjectConfig(cwd);
  if (config.waivers.length === 0) {
    return { pruned: [], skippedShared: [], keptCount: 0 };
  }

  const scan = runStaticScan({ targets: [cwd], cwd });
  const pruneKeysBySource = { shared: new Set(), local: new Set() };
  const pruned = [];
  const skippedShared = [];
  const allowShared = scopeFlag === 'shared' || (!scopeFlag && includeShared);

  for (const audit of scan.waiverAudit) {
    // Only prune when `expired`, or (not `used` and (`missing-file` or `proven-unused`)).
    // NEVER prune a `used` waiver or an `unknown` waiver (incomplete scan, excluded file, or review-only rule)!
    const allFilesMissing =
      audit.usageStatus !== 'used' &&
      Array.isArray(audit.waiver.files) &&
      audit.waiver.files.length > 0 &&
      audit.missingFiles.length === audit.waiver.files.length;

    const shouldPrune =
      audit.expired ||
      (audit.usageStatus !== 'used' && (allFilesMissing || audit.usageStatus === 'proven-unused'));

    if (!shouldPrune) continue;
    if (scopeFlag && audit.source !== scopeFlag) continue;

    const item = {
      ...audit.waiver,
      source: audit.source,
      pruneReason: audit.expired
        ? 'expired'
        : allFilesMissing
          ? 'missing-file'
          : 'proven-unused',
    };

    if (audit.source === 'shared' && !allowShared) {
      skippedShared.push(item);
      continue;
    }

    pruneKeysBySource[audit.source].add(waiverKey(audit.waiver));
    pruned.push(item);
  }

  if (!dryRun) {
    for (const [sourceName, keySet] of Object.entries(pruneKeysBySource)) {
      if (keySet.size === 0) continue;
      const isLocal = sourceName === 'local';
      const cfgPath = isLocal ? getLocalConfigPath(cwd) : getSharedConfigPath(cwd);
      if (!fs.existsSync(cfgPath)) continue;
      const rawObj = readEditableConfigObject(cwd, { local: isLocal });
      if (!Array.isArray(rawObj.waivers)) continue;
      rawObj.waivers = rawObj.waivers
        .map((x) => normalizeWaiverEntry(x))
        .filter((w) => w && !keySet.has(waiverKey(w)));
      cleanupOrWriteConfig(cwd, rawObj, isLocal, cfgPath);
    }
  }

  return {
    pruned,
    skippedShared,
    keptCount: config.waivers.length - pruned.length,
  };
}

function handlePrune(args, io) {
  let scopeFlag = null;
  let includeShared = false;
  let dryRun = false;
  let json = false;
  for (const a of args) {
    if (a === '--json') json = true;
    else if (a === '--dry-run') dryRun = true;
    else if (a === '--yes' || a === '-y') includeShared = true;
    else if (a === '--shared') scopeFlag = 'shared';
    else if (a === '--local') scopeFlag = 'local';
    else {
      io.stderr.write(`Error: unknown option "${a}" for ignores prune\n`);
      return 1;
    }
  }

  const res = pruneStaleWaivers(io.cwd, { scopeFlag, includeShared, dryRun });
  if (json) {
    io.stdout.write(`${JSON.stringify(createJsonEnvelope('ignores.prune', {
      dryRun,
      prunedCount: res.pruned.length,
      skippedSharedCount: res.skippedShared.length,
      keptCount: res.keptCount,
      pruned: res.pruned,
      skippedShared: res.skippedShared,
    }), null, 2)}\n`);
  } else if (res.pruned.length === 0 && res.skippedShared.length === 0) {
    io.stdout.write('No proven-unused or expired waivers to prune.\n');
  } else {
    if (res.pruned.length > 0) {
      io.stdout.write(`${dryRun ? 'Would prune' : 'Pruned'} ${res.pruned.length} stale waiver(s) (${res.keptCount} active remaining).\n`);
    }
    if (res.skippedShared.length > 0) {
      io.stdout.write(`Skipped ${res.skippedShared.length} stale shared waiver(s) in .android-ux/config.json; pass --yes (or --shared) to prune committed team waivers.\n`);
    }
  }
  return 0;
}

function cleanupOrWriteConfig(cwd, rawObj, isLocal, cfgPath) {
  const hasWaivers = Array.isArray(rawObj.waivers) && rawObj.waivers.length > 0;
  const hasIgnoreFiles = Array.isArray(rawObj.ignoreFiles) && rawObj.ignoreFiles.length > 0;
  const hasHook = rawObj.hook && typeof rawObj.hook === 'object' && Object.keys(rawObj.hook).length > 0;
  if (!hasWaivers) delete rawObj.waivers;
  if (!hasWaivers && !hasIgnoreFiles && !hasHook) {
    try {
      fs.unlinkSync(cfgPath);
      const dir = fs.readdirSync(fs.realpathSync(cfgPath.replace(/[/\\][^/\\]+$/, '')));
      if (dir.length === 0) {
        fs.rmdirSync(cfgPath.replace(/[/\\][^/\\]+$/, ''));
      }
    } catch {
      // Ignore cleanup race.
    }
    return;
  }
  writeConfigObject(cwd, rawObj, { local: isLocal });
}

function defaultIo() {
  return {
    cwd: process.cwd(),
    env: process.env,
    stdout: process.stdout,
    stderr: process.stderr,
  };
}
