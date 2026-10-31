import fs from 'node:fs';
import path from 'node:path';
import { createJsonEnvelope, createDiagnostic, formatDiagnosticText } from '../diagnostics.mjs';
import {
  readProjectConfig,
  matchesFilePattern,
  matchesExactProjectPath,
  isWaiverExpired,
  normalizePosixPath,
} from '../config.mjs';
import { scanKotlinSource } from '../scanner/kotlin-scanner.mjs';
import { parseMotionMd, findMotionMdForTarget } from '../scanner/motion-md.mjs';
import { analyzeLottieJson } from '../scanner/lottie-scanner.mjs';
import {
  getAllDomainPacks,
  getAllRules,
  findRuleById,
  parseScopeList,
  getRegisteredDomainIds,
} from '../domains/registry.mjs';

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'build',
  '.gradle',
  '.idea',
  '.kotlin',
  '.cxx',
  'dist',
  'out',
  '__pycache__',
  '.evals',
  'batteries',
]);

/**
 * Walk a directory recursively for scannable `.kt`, `.json`, and UX contract `.md` files.
 */
export function walkScannableFiles(rootDir, { ignoreFiles = [], cwd = process.cwd() } = {}) {
  const files = [];
  const errors = [];

  function visit(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      errors.push({ file: dir, error: err?.message || String(err) });
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) {
          continue;
        }
        visit(full);
      } else if (entry.isFile()) {
        if (ignoreFiles.length > 0 && matchesFilePattern(full, ignoreFiles, cwd)) {
          continue;
        }
        const lower = entry.name.toLowerCase();
        if (lower.endsWith('.kt') || lower.endsWith('.json') || lower === 'motion.md') {
          files.push(full);
        }
      }
    }
  }

  visit(path.resolve(rootDir));
  return { files, errors };
}

/**
 * Programmatic multi-domain static scan over target files/directories.
 */
export function runStaticScan({
  targets = [],
  cwd = process.cwd(),
  scopes = null,
  draft = false,
  baseContractPath = null,
  configEnabled = true,
  inlineIgnoresEnabled = true,
  collectStats = false,
  autoLoadMotionContract = true,
}) {
  const resolvedCwd = path.resolve(cwd);
  const projectConfig = configEnabled
    ? readProjectConfig(resolvedCwd)
    : { ignoreFiles: [], waivers: [], hook: {}, meta: {} };

  const effectiveTargets = targets.length > 0 ? targets : [resolvedCwd];
  const isFullProjectScan =
    effectiveTargets.length === 1 && path.resolve(resolvedCwd, effectiveTargets[0]) === resolvedCwd;

  const collectedFiles = new Set();
  const operationalErrors = [];

  for (const rawTarget of effectiveTargets) {
    const resolvedTarget = path.resolve(resolvedCwd, rawTarget);
    let st;
    try {
      st = fs.statSync(resolvedTarget);
    } catch (err) {
      operationalErrors.push({
        file: rawTarget,
        error: `Cannot access target "${rawTarget}": ${err?.code || err?.message || String(err)}`,
      });
      continue;
    }

    if (st.isDirectory()) {
      const walked = walkScannableFiles(resolvedTarget, {
        ignoreFiles: configEnabled ? projectConfig.ignoreFiles : [],
        cwd: resolvedCwd,
      });
      for (const f of walked.files) collectedFiles.add(f);
      for (const e of walked.errors) operationalErrors.push(e);
    } else if (st.isFile()) {
      if (configEnabled && projectConfig.ignoreFiles.length > 0 && matchesFilePattern(resolvedTarget, projectConfig.ignoreFiles, resolvedCwd)) {
        continue;
      }
      collectedFiles.add(resolvedTarget);
    }
  }

  const kotlinFiles = [];
  const lottieFiles = [];
  const motionContracts = [];
  const seenMotionPaths = new Set();
  let lexErrorCount = 0;

  let baseMotionContent = null;
  if (draft && baseContractPath) {
    try {
      baseMotionContent = fs.readFileSync(path.resolve(resolvedCwd, baseContractPath), 'utf8');
    } catch (err) {
      operationalErrors.push({
        file: baseContractPath,
        error: `Cannot read --base contract "${baseContractPath}": ${err?.message || String(err)}`,
      });
    }
  }

  const analyzedFilesSet = new Set();
  const skippedFilesSet = new Set();

  for (const filePath of collectedFiles) {
    const absFilePath = path.resolve(filePath);
    const baseLower = path.basename(filePath).toLowerCase();

    if (baseLower.endsWith('.json')) {
      try {
        const st = fs.statSync(filePath);
        if (st.size > 4 * 1024 * 1024) {
          skippedFilesSet.add(absFilePath);
          continue;
        }
      } catch (err) {
        skippedFilesSet.add(absFilePath);
        operationalErrors.push({
          file: filePath,
          error: `Cannot read "${filePath}": ${err?.message || String(err)}`,
        });
        continue;
      }
    }

    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      skippedFilesSet.add(absFilePath);
      operationalErrors.push({
        file: filePath,
        error: `Cannot read "${filePath}": ${err?.message || String(err)}`,
      });
      continue;
    }

    if (baseLower === 'motion.md') {
      seenMotionPaths.add(absFilePath);
      analyzedFilesSet.add(absFilePath);
      motionContracts.push(parseMotionMd(content, filePath, { draft, baseContent: baseMotionContent }));
    } else if (baseLower.endsWith('.kt')) {
      const parsed = scanKotlinSource(content, filePath);
      if (parsed.lexError) {
        lexErrorCount += 1;
        skippedFilesSet.add(absFilePath);
      } else {
        analyzedFilesSet.add(absFilePath);
      }
      kotlinFiles.push(parsed);
    } else if (baseLower.endsWith('.json')) {
      // Skip oversized JSON files (>4 MiB) while marking them skipped so waiver audits never prune live waivers
      if (content.length <= 4 * 1024 * 1024) {
        const lottie = analyzeLottieJson(content, filePath);
        if (lottie.parseError) {
          skippedFilesSet.add(absFilePath);
        } else {
          analyzedFilesSet.add(absFilePath);
          if (lottie.isLottie) {
            lottieFiles.push(lottie);
          }
        }
      } else {
        skippedFilesSet.add(absFilePath);
      }
    }
  }

  // Auto-load nearest `MOTION.md` context for scanned `.kt` targets (without linting an unrequested `MOTION.md` unless it was inside `targets`)
  const contextOnlyMotionPaths = new Set();
  if (autoLoadMotionContract && configEnabled && kotlinFiles.length > 0) {
    for (const kf of kotlinFiles) {
      const found = findMotionMdForTarget(kf.filePath, resolvedCwd);
      if (found && !seenMotionPaths.has(path.resolve(found))) {
        try {
          const content = fs.readFileSync(found, 'utf8');
          const parsed = parseMotionMd(content, found, { draft: false });
          // Suppress structural lint findings on auto-loaded parent `MOTION.md` when the user only asked to scan a `.kt` file
          parsed.lintFindings = [];
          seenMotionPaths.add(path.resolve(found));
          contextOnlyMotionPaths.add(path.resolve(found));
          motionContracts.push(parsed);
        } catch {
          // Ignore unreadable parent contract.
        }
      }
    }
  }

  const packs = getAllDomainPacks(scopes);
  const includedDomainSet = new Set(packs.map((p) => p.id));

  let findings = [];
  let candidates = [];
  let contractDiagnostics = [];
  let suppressed = [];
  let rawPreWaiverItems = [];
  const domainStats = {};

  for (const pack of packs) {
    const res = pack.run({
      kotlinFiles,
      lottieFiles,
      motionContracts,
      inlineIgnoresEnabled: configEnabled && inlineIgnoresEnabled,
      collectStats,
    });
    findings.push(...res.findings);
    candidates.push(...res.candidates);
    contractDiagnostics.push(...(res.contractDiagnostics || []));
    suppressed.push(...res.suppressed);
    rawPreWaiverItems.push(...(res.rawPreWaiverItems || []));
    if (collectStats && res.stats) {
      domainStats[pack.id] = res.stats;
    }
  }

  // Apply project waivers from `.android-ux/config*.json` and track tri-state usage (`used | proven-unused | unknown`)
  const activeWaivers = configEnabled ? projectConfig.waivers : [];
  const usedWaiverIndices = new Set();

  if (activeWaivers.length > 0) {
    const filterList = (items, isCandidateList) => {
      const kept = [];
      for (const item of items) {
        const matchIdx = findMatchingProjectWaiver(item, activeWaivers, resolvedCwd);
        if (matchIdx !== -1) {
          usedWaiverIndices.add(matchIdx);
          const w = activeWaivers[matchIdx];
          suppressed.push({
            ...item,
            suppressedBy: w._source === 'local' ? '.android-ux/config.local.json' : '.android-ux/config.json',
            suppressionReason: w.reason,
            waiverKind: w.kind,
          });
        } else {
          kept.push(item);
        }
      }
      void isCandidateList;
      return kept;
    };

    findings = filterList(findings, false);
    candidates = filterList(candidates, true);

    // Also mark waivers that matched an item already suppressed by inline comment so inline+config overlap isn't mislabeled unused
    for (const rawItem of rawPreWaiverItems) {
      const idx = findMatchingProjectWaiver(rawItem, activeWaivers, resolvedCwd);
      if (idx !== -1) usedWaiverIndices.add(idx);
    }
  }

  const waiverAudit = auditProjectWaivers({
    waivers: projectConfig.waivers || [],
    usedWaiverIndices,
    includedDomainSet,
    scannedFilesSet: analyzedFilesSet,
    skippedFilesSet,
    projectIgnoreFiles: configEnabled ? projectConfig.ignoreFiles || [] : [],
    isFullProjectScan,
    hasScanErrors: operationalErrors.length > 0 || lexErrorCount > 0,
    cwd: resolvedCwd,
  });

  // Relativize file paths for clean display while keeping deterministic order
  const relativizeItem = (item) => {
    const next = {
      ...item,
      file: displayPath(item.file, resolvedCwd),
    };
    if (Array.isArray(item.alsoAt)) {
      next.alsoAt = item.alsoAt.map((a) => ({
        ...a,
        file: displayPath(a.file, resolvedCwd),
      }));
    }
    if (item.exception?.file) {
      next.exception = {
        ...item.exception,
        file: displayPath(item.exception.file, resolvedCwd),
      };
    }
    return next;
  };

  return {
    cwd: resolvedCwd,
    scopes: packs.map((p) => p.id),
    findings: findings.map(relativizeItem),
    candidates: candidates.map(relativizeItem),
    contractDiagnostics: contractDiagnostics.map(relativizeItem),
    suppressed: suppressed.map(relativizeItem),
    operationalErrors,
    coverage: {
      kotlinFilesScanned: kotlinFiles.length,
      kotlinFilesAbstainedOnSyntax: lexErrorCount,
      lottieAssetsScanned: lottieFiles.length,
      motionContractsLoaded: motionContracts.length,
      contextOnlyContracts: contextOnlyMotionPaths.size,
    },
    waiverAudit,
    stats: collectStats ? domainStats : undefined,
  };
}

const CROSS_FILE_WAIVER_RULES = new Set(['O-002']);

function findMatchingProjectWaiver(item, waivers, cwd) {
  const itemFiles = [
    item.file,
    ...(Array.isArray(item.alsoAt) ? item.alsoAt.map((a) => a.file).filter(Boolean) : []),
  ];
  for (let i = 0; i < waivers.length; i += 1) {
    const w = waivers[i];
    if (isWaiverExpired(w)) continue;
    if (w.rule !== item.rule) continue;
    const ruleMeta = findRuleById(w.rule);
    // Floor and obligation rules only honor narrow `false-positive` waivers scoped to explicit literal files
    if (ruleMeta && !ruleMeta.overridable) {
      if (
        w.kind !== 'false-positive' ||
        !Array.isArray(w.files) ||
        w.files.length === 0 ||
        w.files.some((pat) => /[*?[\]{}]/.test(pat))
      ) {
        continue;
      }
      if (!itemFiles.some((f) => matchesExactProjectPath(f, w.files, cwd))) continue;
    } else if (Array.isArray(w.files) && w.files.length > 0) {
      if (!itemFiles.some((f) => matchesFilePattern(f, w.files, cwd))) continue;
    }
    if (w.value) {
      const hay = `${item.evidence || ''} ${item.summary || ''}`.toLowerCase();
      if (!hay.includes(w.value.toLowerCase())) continue;
    }
    return i;
  }
  return -1;
}

/**
 * Tri-state unused-waiver audit (`used | proven-unused | unknown`) + unknown-rule / missing-file / expired checks.
 */
export function auditProjectWaivers({
  waivers,
  usedWaiverIndices,
  includedDomainSet,
  scannedFilesSet,
  skippedFilesSet = new Set(),
  projectIgnoreFiles = [],
  isFullProjectScan,
  hasScanErrors,
  cwd,
}) {
  const scannedFilesArr = Array.from(scannedFilesSet);
  const skippedFilesArr = Array.from(skippedFilesSet);

  return waivers.map((w, index) => {
    const ruleMeta = findRuleById(w.rule);
    const expired = isWaiverExpired(w);
    const isUsed = usedWaiverIndices.has(index);
    const missingFiles = [];

    if (Array.isArray(w.files) && !isUsed) {
      for (const pat of w.files) {
        if (!/[*?[\]{}]/.test(pat)) {
          const abs = path.resolve(cwd, pat);
          const existsAtPath = fs.existsSync(abs);
          const matchesScannedSuffix =
            Boolean(ruleMeta?.overridable) &&
            scannedFilesArr.some((sf) => matchesFilePattern(sf, [pat], cwd));
          if (!existsAtPath && !matchesScannedSuffix) {
            missingFiles.push(pat);
          }
        }
      }
    }

    let usageStatus = 'unknown';
    if (isUsed) {
      usageStatus = 'used';
    } else if (!ruleMeta) {
      usageStatus = 'unknown';
    } else if (ruleMeta.detectionMode === 'review-only') {
      // Semantic review-only rule: static detector never emits it, so static scan cannot prove unused
      usageStatus = 'unknown';
    } else if (!includedDomainSet.has(ruleMeta.domain)) {
      usageStatus = 'unknown';
    } else if (hasScanErrors) {
      usageStatus = 'unknown';
    } else if (
      CROSS_FILE_WAIVER_RULES.has(w.rule) &&
      (!isFullProjectScan || skippedFilesSet.size > 0 || projectIgnoreFiles.length > 0)
    ) {
      // Cross-file consumer/asset rules (e.g. O-002) require full, unskipped project coverage to prove unused
      usageStatus = 'unknown';
    } else if (Array.isArray(w.files) && w.files.length > 0) {
      // Proven-unused ONLY when every pattern in `w.files` actually covered at least one analyzed file
      // and zero skipped files (so waivers targeting >4 MiB Lottie assets or excluded dirs stay `unknown`, never pruned!)
      const everyPatternCovered = w.files.every((pat) => {
        if (!/[*?[\]{}]/.test(pat)) {
          const abs = path.resolve(cwd, pat);
          if (skippedFilesSet.has(abs)) {
            return false;
          }
          if (fs.existsSync(abs)) {
            return scannedFilesSet.has(abs) && !skippedFilesSet.has(abs);
          }
          if (!ruleMeta.overridable) return false;
        }
        if (skippedFilesArr.some((sf) => matchesFilePattern(sf, [pat], cwd))) {
          return false;
        }
        return (
          isFullProjectScan &&
          projectIgnoreFiles.length === 0 &&
          scannedFilesArr.some((sf) => matchesFilePattern(sf, [pat], cwd))
        );
      });
      if (everyPatternCovered) {
        usageStatus = 'proven-unused';
      }
    } else if (
      isFullProjectScan &&
      projectIgnoreFiles.length === 0 &&
      skippedFilesSet.size === 0 &&
      scannedFilesArr.length > 0
    ) {
      usageStatus = 'proven-unused';
    }

    const issues = [];
    if (!ruleMeta && !w.rule.startsWith('MOTION-MD-')) issues.push('ignore-unknown-rule');
    if (missingFiles.length > 0) issues.push('ignore-missing-file');
    if (expired) issues.push('ignore-expired');
    if (usageStatus === 'proven-unused' && missingFiles.length === 0 && !expired) {
      issues.push('ignore-unused');
    }

    return {
      waiver: w,
      source: w._source || 'shared',
      usageStatus,
      expired,
      missingFiles,
      issues,
    };
  });
}

function displayPath(filePath, cwd) {
  const abs = path.resolve(cwd, filePath);
  const rel = path.relative(cwd, abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    return normalizePosixPath(filePath);
  }
  return normalizePosixPath(rel);
}

const DETECT_USAGE = `Usage: android-ux detect [options] [paths...]

Run deterministic static checks over Kotlin Compose (.kt), Lottie (.json), and UX contract (MOTION.md) files.

Options:
  --scope <domains>        Comma-separated domain filter (all, ${getRegisteredDomainIds().join(', ')})
  --format <fmt>           Output format: text (default), json, or github
  --json                   Shorthand for --format json (single JSON document on stdout)
  --github                 Shorthand for --format github (GitHub Actions annotations on stdout)
  --quiet                  Print only summary counts in text mode (or rule IDs with --list-rules)
  --stats                  Include call-site motion inventory statistics (for improve-android-motion)
  --draft                  Enforce fresh-draft contract rules on MOTION.md (rejects new DECIDED tags)
  --base <file>            Base MOTION.md file whose existing DECIDED entries remain allowed under --draft
  --fail-on <level>        Blocking threshold for exit code 2: major (default: floor, obligation & major taste),
                           minor (any proven finding), or floor (floor & obligation only)
  --list-rules             Print registered rule catalog and exit 0 (takes no target paths)
  --no-advisory            Omit advisory candidates[] (and minor taste in text mode when non-blocking)
  --no-config              Ignore .android-ux/config*.json, inline comments, and auto-loaded MOTION.md
  --no-inline-ignores      Ignore inline // android-ux-disable* comments
  --report-unused-ignores  Include proven-unused / expired waiver diagnostics in output
  --help, -h               Show this help message

Exit codes:
  0  Zero blocking proven findings (minor taste & advisory candidates exit 0 unless --fail-on minor)
  1  Operational or argument error (takes precedence over 2 on partial scans)
  2  One or more blocking proven findings (or major MOTION.md contract errors) detected
`;

export async function runDetectCommand(rawArgs, io = defaultIo()) {
  const args = [...rawArgs];
  if (args[0] === 'detect') args.shift();

  let format = 'text';
  let formatSetBy = null;
  let quiet = false;
  let stats = false;
  let draft = false;
  let baseContractPath = null;
  let failOn = 'major';
  let listRules = false;
  let noAdvisory = false;
  let configEnabled = true;
  let inlineIgnoresEnabled = true;
  let reportUnusedIgnores = false;
  let showHelp = false;
  const rawScopes = [];
  const targets = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      showHelp = true;
    } else if (arg === '--json' || arg === '-json') {
      if (formatSetBy === '--github') {
        io.stderr.write('Error: --github cannot be used with --json\n');
        return 1;
      }
      format = 'json';
      formatSetBy = '--json';
    } else if (arg === '--github') {
      if (formatSetBy === '--json') {
        io.stderr.write('Error: --github cannot be used with --json\n');
        return 1;
      }
      format = 'github';
      formatSetBy = '--github';
    } else if (arg === '--format' || arg.startsWith('--format=')) {
      const val = arg.includes('=') ? arg.slice('--format='.length) : args[++i];
      if (!val || !['text', 'json', 'github'].includes(val)) {
        io.stderr.write('Error: --format must be one of: text, json, github\n');
        return 1;
      }
      format = val;
      formatSetBy = `--format ${val}`;
    } else if (arg === '--scope' || arg.startsWith('--scope=')) {
      const val = arg.includes('=') ? arg.slice('--scope='.length) : args[++i];
      if (!val || val.startsWith('--')) {
        io.stderr.write(`Error: --scope requires a value. Valid scopes: all, ${getRegisteredDomainIds().join(', ')}\n`);
        return 1;
      }
      rawScopes.push(val);
    } else if (arg === '--fail-on' || arg.startsWith('--fail-on=')) {
      const val = arg.includes('=') ? arg.slice('--fail-on='.length) : args[++i];
      if (!val || !['major', 'minor', 'floor'].includes(val)) {
        io.stderr.write('Error: --fail-on must be one of: major, minor, floor\n');
        return 1;
      }
      failOn = val;
    } else if (arg === '--base' || arg.startsWith('--base=')) {
      const val = arg.includes('=') ? arg.slice('--base='.length) : args[++i];
      if (!val || val.startsWith('--')) {
        io.stderr.write('Error: --base requires a path to a base MOTION.md file\n');
        return 1;
      }
      baseContractPath = val;
    } else if (arg === '--quiet' || arg === '-q') {
      quiet = true;
    } else if (arg === '--stats') {
      stats = true;
    } else if (arg === '--draft') {
      draft = true;
    } else if (arg === '--list-rules') {
      listRules = true;
    } else if (arg === '--no-advisory') {
      noAdvisory = true;
    } else if (arg === '--no-config') {
      configEnabled = false;
      inlineIgnoresEnabled = false;
    } else if (arg === '--no-inline-ignores') {
      inlineIgnoresEnabled = false;
    } else if (arg === '--report-unused-ignores') {
      reportUnusedIgnores = true;
    } else if (arg.startsWith('--')) {
      io.stderr.write(`Error: unknown detect option "${arg}". Run android-ux detect --help.\n`);
      return 1;
    } else {
      targets.push(arg);
    }
  }

  const parsedScopes = parseScopeList(rawScopes);
  if (parsedScopes.unknown.length > 0) {
    io.stderr.write(
      `Error: unknown --scope value(s): ${parsedScopes.unknown.join(', ')}. Valid scopes: ${parsedScopes.validScopes.join(', ')}\n`
    );
    return 1;
  }

  if (showHelp) {
    io.stdout.write(DETECT_USAGE);
    return 0;
  }

  if (baseContractPath && !draft) {
    io.stderr.write('Error: --base can only be used together with --draft.\n');
    return 1;
  }

  if (listRules) {
    if (format === 'github') {
      io.stderr.write('Error: --github annotates scan findings and cannot be used with --list-rules\n');
      return 1;
    }
    if (targets.length > 0) {
      io.stderr.write('Error: --list-rules prints the rule catalog and takes no file or directory targets\n');
      return 1;
    }
    const rules = getAllRules(parsedScopes.scopes).filter((r) => !(noAdvisory && r.detectionMode === 'candidate'));
    if (format === 'json') {
      io.stdout.write(`${JSON.stringify(createJsonEnvelope('detect.rules', { rules }), null, 2)}\n`);
    } else if (quiet) {
      for (const r of rules) io.stdout.write(`${r.id}\n`);
    } else {
      for (const r of rules) {
        io.stdout.write(`${r.id.padEnd(7)} [${r.class.padEnd(10)}] (${r.detectionMode.padEnd(11)}) ${r.title}\n`);
      }
    }
    return 0;
  }

  const result = runStaticScan({
    targets,
    cwd: io.cwd,
    scopes: parsedScopes.scopes,
    draft,
    baseContractPath,
    configEnabled,
    inlineIgnoresEnabled,
    collectStats: stats,
  });

  const candidates = noAdvisory ? [] : result.candidates;
  const contractDiagnostics = result.contractDiagnostics || [];
  const unusedDiagnostics = reportUnusedIgnores
    ? result.waiverAudit
        .filter((a) => a.issues.length > 0)
        .map((a) =>
          createDiagnostic({
            code: 'AUX-CONFIG-002',
            severity: 'warning',
            status: 'warn',
            summary: `Waiver for ${a.waiver.rule} has stale state (${a.issues.join(', ')}).`,
            evidence: a.waiver.reason,
            remediation: 'Run `npx android-ux ignores prune` to remove proven-unused or expired waivers.',
          })
        )
    : [];

  const isBlockingFinding = (f) => {
    if (f.class === 'floor' || f.class === 'obligation') return true;
    if (failOn === 'floor') return false;
    if (failOn === 'minor') return true;
    return f.severity === 'major';
  };

  const blockingFindings = result.findings.filter(isBlockingFinding);
  const advisoryFindings = result.findings.filter((f) => !isBlockingFinding(f));
  const blockingContractErrors = failOn === 'floor'
    ? []
    : contractDiagnostics.filter((d) => failOn === 'minor' || d.severity === 'major');

  const hadOperationalFailure = result.operationalErrors.length > 0;
  const hasBlockingFailure = blockingFindings.length > 0 || blockingContractErrors.length > 0;
  const exitCode = hadOperationalFailure ? 1 : hasBlockingFailure ? 2 : 0;

  if (format === 'json') {
    for (const err of result.operationalErrors) {
      io.stderr.write(`Error: ${err.error}\n`);
    }
    const payload = createJsonEnvelope('detect', {
      status: hadOperationalFailure
        ? 'error'
        : hasBlockingFailure
          ? 'findings'
          : advisoryFindings.length > 0
            ? 'advisory'
            : 'clean',
      failOn,
      scopes: result.scopes,
      coverage: result.coverage,
      findings: result.findings,
      blockingCount: blockingFindings.length,
      advisoryCount: advisoryFindings.length,
      candidates,
      ...(contractDiagnostics.length > 0 ? { contractDiagnostics } : {}),
      suppressed: result.suppressed,
      ...(stats ? { stats: result.stats } : {}),
      ...(reportUnusedIgnores ? { unusedWaivers: unusedDiagnostics } : {}),
      ...(hadOperationalFailure ? { errors: result.operationalErrors } : {}),
    });
    io.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return exitCode;
  }

  if (format === 'github') {
    for (const err of result.operationalErrors) {
      io.stderr.write(`Error: ${err.error}\n`);
    }
    const ws = io.env?.GITHUB_WORKSPACE ? path.resolve(io.env.GITHUB_WORKSPACE) : io.cwd;
    for (const f of result.findings) {
      const relFile = normalizePosixPath(path.relative(ws, path.resolve(io.cwd, f.file)));
      const level = isBlockingFinding(f) ? 'error' : 'warning';
      const linePart = f.lines?.[0] ? `,line=${f.lines[0]},endLine=${f.lines[1] || f.lines[0]}` : '';
      const msg = escapeGithubData(`[${f.rule}] ${f.evidence}\nFix: ${f.remediation}`);
      io.stdout.write(`::${level} file=${relFile}${linePart},title=${f.rule} (${f.class})::${msg}\n`);
    }
    for (const d of contractDiagnostics) {
      const relFile = normalizePosixPath(path.relative(ws, path.resolve(io.cwd, d.file)));
      const level = d.severity === 'major' ? 'error' : 'warning';
      const linePart = d.lines?.[0] ? `,line=${d.lines[0]},endLine=${d.lines[1] || d.lines[0]}` : '';
      const msg = escapeGithubData(`[${d.code}] ${d.summary}\nFix: ${d.remediation}`);
      io.stdout.write(`::${level} file=${relFile}${linePart},title=${d.code} (contract)::${msg}\n`);
    }
    return exitCode;
  }

  // Human-readable text mode (writes human findings/notes to stderr, matching Impeccable)
  for (const err of result.operationalErrors) {
    io.stderr.write(`Error: ${err.error}\n`);
  }

  if (quiet) {
    if (blockingFindings.length > 0) {
      io.stderr.write(`${blockingFindings.length} blocking finding${blockingFindings.length === 1 ? '' : 's'} found.\n`);
    }
    if (advisoryFindings.length > 0 && !noAdvisory) {
      io.stderr.write(`${advisoryFindings.length} advisory minor taste finding${advisoryFindings.length === 1 ? '' : 's'} found (non-blocking).\n`);
    }
    if (contractDiagnostics.length > 0) {
      io.stderr.write(`${contractDiagnostics.length} contract diagnostic${contractDiagnostics.length === 1 ? '' : 's'} found.\n`);
    }
    if (candidates.length > 0) {
      io.stderr.write(`${candidates.length} candidate${candidates.length === 1 ? '' : 's'} for semantic verification (not counted as failures).\n`);
    }
    return exitCode;
  }

  const linesOut = [];
  if (blockingFindings.length > 0) {
    const grouped = groupByFile(blockingFindings);
    for (const [file, items] of grouped.entries()) {
      linesOut.push(`\n${file}`);
      for (const f of items) {
        const span = f.lines[0] === f.lines[1] ? `line ${f.lines[0]}` : `lines ${f.lines[0]}-${f.lines[1]}`;
        linesOut.push(`  ${span}: [${f.rule}] (${f.class}/${f.severity}) ${f.evidence}`);
        linesOut.push(`    → ${f.remediation} (${f.docPath})`);
      }
    }
    linesOut.push(`\n${blockingFindings.length} blocking proven finding${blockingFindings.length === 1 ? '' : 's'} found.`);
  } else if (!hadOperationalFailure && contractDiagnostics.length === 0) {
    linesOut.push(`No blocking static findings across ${result.coverage.kotlinFilesScanned} Kotlin file(s) and ${result.coverage.lottieAssetsScanned} Lottie asset(s).`);
  }

  if (advisoryFindings.length > 0 && !noAdvisory) {
    linesOut.push('\n── Advisory minor taste findings (non-blocking unless --fail-on minor) ──');
    const groupedAdv = groupByFile(advisoryFindings);
    for (const [file, items] of groupedAdv.entries()) {
      linesOut.push(`\n${file}`);
      for (const f of items) {
        const span = f.lines[0] === f.lines[1] ? `line ${f.lines[0]}` : `lines ${f.lines[0]}-${f.lines[1]}`;
        linesOut.push(`  ${span}: [${f.rule}] (${f.class}/${f.severity}) ${f.evidence}`);
        linesOut.push(`    → ${f.remediation} (${f.docPath})`);
      }
    }
  }

  if (contractDiagnostics.length > 0) {
    linesOut.push('\n── Contract diagnostics (MOTION.md) ──');
    for (const d of contractDiagnostics) {
      const span = d.lines[0] === d.lines[1] ? `line ${d.lines[0]}` : `lines ${d.lines[0]}-${d.lines[1]}`;
      linesOut.push(`  ${d.file} (${span}): [${d.code}] (${d.severity}) ${d.summary}`);
      linesOut.push(`    → ${d.remediation} (${d.docPath})`);
    }
  }

  if (candidates.length > 0) {
    linesOut.push('\n── Candidates requiring semantic verification (not counted as failures) ──');
    const groupedCand = groupByFile(candidates);
    for (const [file, items] of groupedCand.entries()) {
      linesOut.push(`\n${file}`);
      for (const c of items) {
        const span = c.lines[0] === c.lines[1] ? `line ${c.lines[0]}` : `lines ${c.lines[0]}-${c.lines[1]}`;
        linesOut.push(`  ${span}: [${c.rule}] ${c.evidence}`);
        linesOut.push(`    ? ${c.verificationHint}`);
      }
    }
    linesOut.push(`\n${candidates.length} candidate${candidates.length === 1 ? '' : 's'}. Suppress with --no-advisory.`);
  }

  if (stats && result.stats?.motion) {
    const st = result.stats.motion;
    linesOut.push('\n── Motion Inventory (--stats) ──');
    linesOut.push(`  Kotlin files scanned:    ${st.scannedKotlinFiles}`);
    linesOut.push(`  Call-site spec literals: ${st.rawSpecs.totalCallSiteLiterals} (tween=${st.rawSpecs.tween}, spring=${st.rawSpecs.spring}, keyframes=${st.rawSpecs.keyframes})`);
    linesOut.push(`  Token definitions:       ${st.tokenDefinitions.count}`);
    linesOut.push(`  MotionScheme reads:      ${st.motionSchemeReads.count}`);
    linesOut.push(`  Named token references:  ${st.namedTokenReferences.count}`);
    linesOut.push(`  NavHost sites:           ${st.navigationHosts.navHostTotal} (${st.navigationHosts.navHostDefaultOnly} using default 700ms crossfade)`);
    linesOut.push(`  Unresolved spec sites:   ${st.unresolvedSpecSites.count}`);
  }

  for (const diag of unusedDiagnostics) {
    linesOut.push(`\n${formatDiagnosticText(diag)}`);
  }

  io.stderr.write(`${linesOut.join('\n')}\n`);
  return exitCode;
}

function groupByFile(items) {
  const map = new Map();
  for (const item of items) {
    if (!map.has(item.file)) map.set(item.file, []);
    map.get(item.file).push(item);
  }
  return map;
}

function escapeGithubData(str) {
  return String(str)
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A');
}

function defaultIo() {
  return {
    cwd: process.cwd(),
    env: process.env,
    stdout: process.stdout,
    stderr: process.stderr,
  };
}
