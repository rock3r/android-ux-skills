import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENVELOPE_PREFIX } from '../version.mjs';
import {
  readProjectSessionCache,
  writeProjectSessionCache,
  recordSessionRoot,
  listSessionRoots,
  claimHookEvent,
  sha256Hex,
} from '../cache.mjs';
import {
  readProjectConfig,
  matchesFilePattern,
  normalizePosixPath,
} from '../config.mjs';
import { findRuleById } from '../domains/registry.mjs';
import { runStaticScan } from './detect.mjs';

const EDIT_CAP_PER_FILE = 6;
const CURSOR_MAX_CHARS = 9500;
const GENERATED_OR_SENSITIVE_RE = /(?:^|\/)(?:\.git|\.gradle|build|node_modules|dist|out|\.env(?:\..+)?|secrets?|credentials)(?:\/|$)/i;

function isTruthyEnv(val) {
  if (!val) return false;
  const s = String(val).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || (/^\d+$/.test(s) && Number(s) > 0);
}

function resolveWorkspaceEntry(entry) {
  if (typeof entry !== 'string') return '';
  const trimmed = entry.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('file://')) {
    try {
      return path.resolve(fileURLToPath(trimmed));
    } catch {
      return '';
    }
  }
  return path.resolve(trimmed);
}

function normalizeWorkspaceRoots(rawRoots, fallbackRoot) {
  const resolved = [];
  if (Array.isArray(rawRoots)) {
    for (const entry of rawRoots) {
      const r = resolveWorkspaceEntry(entry);
      if (r && !resolved.includes(r)) resolved.push(r);
    }
  }
  if (resolved.length === 0) {
    resolved.push(path.resolve(fallbackRoot));
  }
  return resolved;
}

function resolveCandidatePathAgainstRoots(candidate, roots, defaultBase) {
  if (typeof candidate !== 'string') return '';
  const trimmed = candidate.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('file://')) {
    try {
      return path.resolve(fileURLToPath(trimmed));
    } catch {
      return '';
    }
  }
  if (path.isAbsolute(trimmed)) {
    return path.resolve(trimmed);
  }
  const primary = path.resolve(defaultBase, trimmed);
  if (fs.existsSync(primary)) return primary;
  for (const root of roots || []) {
    const alt = path.resolve(root, trimmed);
    if (fs.existsSync(alt)) return alt;
  }
  return primary;
}

export function findOwningWorkspaceRoot(filePath, roots) {
  if (!filePath || !Array.isArray(roots) || roots.length === 0) return null;
  const resolvedFile = path.resolve(filePath);

  let bestLexicalRoot = null;
  for (const r of roots) {
    const resolvedRoot = path.resolve(r);
    const rel = path.relative(resolvedRoot, resolvedFile);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
      if (!bestLexicalRoot || resolvedRoot.length > bestLexicalRoot.length) {
        bestLexicalRoot = resolvedRoot;
      }
    }
  }
  if (bestLexicalRoot) {
    return { root: bestLexicalRoot, absFile: resolvedFile };
  }

  // Symlinked root fallback (e.g. /var/folders vs /private/var/folders on macOS)
  try {
    const realFile = fs.realpathSync(resolvedFile);
    let bestRealMatch = null;
    for (const r of roots) {
      const resolvedRoot = path.resolve(r);
      try {
        const realRoot = fs.realpathSync(resolvedRoot);
        const realRel = path.relative(realRoot, realFile);
        if (realRel && !realRel.startsWith('..') && !path.isAbsolute(realRel)) {
          if (!bestRealMatch || realRoot.length > bestRealMatch.realRoot.length) {
            bestRealMatch = { resolvedRoot, realRoot, realRel };
          }
        }
      } catch {
        // Ignore unreadable workspace root.
      }
    }
    if (bestRealMatch) {
      return {
        root: bestRealMatch.resolvedRoot,
        absFile: path.join(bestRealMatch.resolvedRoot, bestRealMatch.realRel),
      };
    }
  } catch {
    // Target does not exist on disk; fail closed for root ownership.
  }

  return null;
}

/**
 * Normalize stdin payload from Claude Code, Codex, Cursor, GitHub Copilot, or Antigravity/Jetski.
 */
export function normalizeHookPayload(raw, { cwd = process.cwd(), env = process.env } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { kind: 'noop', harness: 'unknown' };
  }

  const forcedHarness = String(env.ANDROID_UX_HOOK_HARNESS || '').trim().toLowerCase();

  // 1. Antigravity / Jetski native plugin payloads (camelCase: conversationId, workspacePaths, workspaceUris, toolCall, invocationNum, terminationReason)
  const isJetski =
    forcedHarness === 'jetski' ||
    forcedHarness === 'antigravity' ||
    typeof raw.conversationId === 'string' ||
    Array.isArray(raw.workspacePaths) ||
    Array.isArray(raw.workspaceUris) ||
    typeof raw.invocationNum === 'number' ||
    typeof raw.terminationReason === 'string' ||
    (raw.toolCall && typeof raw.toolCall === 'object');

  if (isJetski) {
    const rawRoots = Array.isArray(raw.workspacePaths) && raw.workspacePaths.length > 0
      ? raw.workspacePaths
      : raw.workspaceUris;
    const roots = normalizeWorkspaceRoots(rawRoots, cwd);
    const sessionId = String(raw.conversationId || 'jetski-session');

    if (typeof raw.terminationReason === 'string') {
      return {
        kind: 'jetski-stop',
        harness: 'jetski',
        sessionId,
        projectRoot: roots[0],
        roots,
      };
    }

    if (raw.toolCall && typeof raw.toolCall === 'object') {
      const toolName = String(raw.toolCall.name || '');
      const args = raw.toolCall.args && typeof raw.toolCall.args === 'object' ? raw.toolCall.args : {};
      const rawCandidates = [];
      for (const candidate of [args.Path, args.NotebookPath, args.file_path, args.path]) {
        if (typeof candidate === 'string' && candidate.trim()) rawCandidates.push(candidate.trim());
      }
      const files = Array.from(
        new Set(rawCandidates.map((c) => resolveCandidatePathAgainstRoots(c, roots, roots[0])).filter(Boolean))
      );
      const primaryOwner = files.length > 0 ? findOwningWorkspaceRoot(files[0], roots) : null;
      const toolUseId = raw.stepIdx != null ? `jetski-step-${raw.stepIdx}` : null;
      return {
        kind: 'jetski-post-tool-use',
        harness: 'jetski',
        sessionId,
        projectRoot: primaryOwner ? primaryOwner.root : roots[0],
        roots,
        toolName,
        toolUseId,
        files,
        preimage: resolvePreimageInfo(toolName, raw),
        failedTool: Boolean(raw.error),
      };
    }

    return {
      kind: 'jetski-pre-invocation',
      harness: 'jetski',
      sessionId,
      projectRoot: roots[0],
      roots,
    };
  }

  // 2. Claude Code / Codex `Stop` event
  const eventName = String(raw.hook_event_name || raw.hookEventName || '');
  if (eventName === 'Stop') {
    const harness = forcedHarness || 'claude';
    const projectRoot = path.resolve(raw.cwd || cwd);
    return {
      kind: 'stop',
      harness,
      sessionId: String(raw.session_id || raw.sessionId || 'default-session'),
      projectRoot,
      roots: [projectRoot],
      stopHookActive: raw.stop_hook_active === true,
    };
  }

  if (eventName === 'SessionStart') {
    return { kind: 'noop', harness: forcedHarness || 'claude' };
  }

  // 3. Cursor `postToolUse`
  const isCursor =
    forcedHarness === 'cursor' ||
    typeof raw.conversation_id === 'string' ||
    Array.isArray(raw.workspace_roots);

  if (isCursor) {
    const fallbackRoot = path.resolve(env.CURSOR_PROJECT_DIR || raw.cwd || cwd);
    const roots = normalizeWorkspaceRoots(raw.workspace_roots, fallbackRoot);
    const defaultBase = path.resolve(raw.cwd || env.CURSOR_PROJECT_DIR || roots[0]);
    const toolName = String(raw.tool_name || '');
    const files = extractTargetFilesFromEvent(raw, defaultBase, roots);
    const primaryOwner = files.length > 0 ? findOwningWorkspaceRoot(files[0], roots) : null;
    return {
      kind: 'post-tool-use',
      harness: 'cursor',
      sessionId: String(raw.conversation_id || raw.session_id || 'cursor-session'),
      projectRoot: primaryOwner ? primaryOwner.root : roots[0],
      roots,
      toolName,
      toolUseId: raw.tool_use_id || raw.generation_id || null,
      files,
      preimage: resolvePreimageInfo(toolName, raw),
    };
  }

  // 4. GitHub Copilot `postToolUse`
  const isCopilot =
    forcedHarness === 'copilot' ||
    forcedHarness === 'github' ||
    eventName === 'postToolUse' ||
    typeof raw.toolArgs !== 'undefined';

  if (isCopilot) {
    const projectRoot = path.resolve(raw.cwd || cwd);
    const roots = [projectRoot];
    const toolName = String(raw.toolName || raw.tool_name || '');
    return {
      kind: 'post-tool-use',
      harness: 'copilot',
      sessionId: String(raw.sessionId || raw.session_id || 'copilot-session'),
      projectRoot,
      roots,
      toolName,
      toolUseId: raw.toolUseId || raw.tool_use_id || (raw.timestamp ? `copilot-${raw.timestamp}` : null),
      files: extractTargetFilesFromEvent(raw, projectRoot, roots),
      preimage: resolvePreimageInfo(toolName, raw),
    };
  }

  // 5. Claude Code / Codex `PostToolUse`
  const harness = forcedHarness || 'claude';
  const projectRoot = path.resolve(raw.cwd || cwd);
  const roots = [projectRoot];
  const toolName = String(raw.tool_name || raw.toolName || '');
  return {
    kind: 'post-tool-use',
    harness,
    sessionId: String(raw.session_id || raw.sessionId || 'claude-session'),
    projectRoot,
    roots,
    toolName,
    toolUseId: raw.tool_use_id || raw.toolUseId || raw.tool_call_id || null,
    files: extractTargetFilesFromEvent(raw, projectRoot, roots),
    preimage: resolvePreimageInfo(toolName, raw),
  };
}

function extractTargetFilesFromEvent(raw, projectRoot, roots = [projectRoot]) {
  const candidates = [];
  const ti = raw.tool_input && typeof raw.tool_input === 'object' ? raw.tool_input : {};

  for (const val of [ti.file_path, ti.path, ti.notebook_path, raw.file_path, raw.path]) {
    if (typeof val === 'string' && val.trim()) candidates.push(val.trim());
  }

  if (Array.isArray(ti.edits)) {
    for (const ed of ti.edits) {
      if (typeof ed?.file_path === 'string' && ed.file_path.trim()) {
        candidates.push(ed.file_path.trim());
      }
    }
  }

  // Codex / Copilot `apply_patch` patch text
  const patchSources = [];
  if (typeof ti.command === 'string') patchSources.push(ti.command);
  if (typeof ti.patch === 'string') patchSources.push(ti.patch);
  if (typeof raw.toolArgs === 'string') {
    const trimmed = raw.toolArgs.trim();
    if (trimmed.startsWith('{')) {
      try {
        const parsedArgs = JSON.parse(trimmed);
        for (const v of [parsedArgs.path, parsedArgs.file_path, parsedArgs.file]) {
          if (typeof v === 'string' && v.trim()) candidates.push(v.trim());
        }
        if (typeof parsedArgs.patch === 'string') patchSources.push(parsedArgs.patch);
      } catch {
        patchSources.push(trimmed);
      }
    } else {
      patchSources.push(trimmed);
    }
  } else if (raw.toolArgs && typeof raw.toolArgs === 'object') {
    for (const v of [raw.toolArgs.path, raw.toolArgs.file_path, raw.toolArgs.file]) {
      if (typeof v === 'string' && v.trim()) candidates.push(v.trim());
    }
  }

  for (const patchText of patchSources) {
    for (const p of parseApplyPatchPaths(patchText)) {
      candidates.push(p);
    }
  }

  return Array.from(
    new Set(candidates.map((p) => resolveCandidatePathAgainstRoots(p, roots, projectRoot)).filter(Boolean))
  );
}

export function parseApplyPatchPaths(patchText) {
  if (!patchText || typeof patchText !== 'string') return [];
  const out = [];
  const re = /^\*\*\*\s+(?:(?:Update|Add|Move to)\s+File:|Move to:)\s+(.+)$/gm;
  let m;
  while ((m = re.exec(patchText)) !== null) {
    const p = m[1].trim();
    if (p) out.push(p);
  }
  return out;
}

function resolvePreimageInfo(toolName, raw) {
  const tr = raw.tool_response && typeof raw.tool_response === 'object' ? raw.tool_response : {};
  if (typeof tr.originalFile === 'string') {
    return { status: 'captured', originalContent: tr.originalFile };
  }
  if (typeof tr.old_content === 'string') {
    return { status: 'captured', originalContent: tr.old_content };
  }
  const lowerTool = String(toolName || '').toLowerCase();
  if (tr.type === 'create' || lowerTool === 'create') {
    return { status: 'created', originalContent: '' };
  }
  return { status: 'unavailable', originalContent: null };
}

function isScannableInsideProject(absFile, projectRoot, config) {
  const resolvedRoot = path.resolve(projectRoot);
  const resolvedFile = path.resolve(absFile);
  const rel = path.relative(resolvedRoot, resolvedFile);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return false;

  const posixRel = normalizePosixPath(rel);
  if (GENERATED_OR_SENSITIVE_RE.test(posixRel)) return false;

  const lower = path.basename(resolvedFile).toLowerCase();
  if (!(lower.endsWith('.kt') || lower.endsWith('.json') || lower === 'motion.md')) {
    return false;
  }

  try {
    const lst = fs.lstatSync(resolvedFile);
    if (!lst.isFile() || lst.isSymbolicLink()) return false;
    const realRoot = fs.realpathSync(resolvedRoot);
    const realFile = fs.realpathSync(resolvedFile);
    const realRel = path.relative(realRoot, realFile);
    if (!realRel || realRel.startsWith('..') || path.isAbsolute(realRel)) return false;

    const maxBytes = config.hook?.limits?.maxFileBytes ?? 262144;
    if (maxBytes > 0 && lst.size > maxBytes) return false;
  } catch {
    return false;
  }

  if (config.ignoreFiles?.length > 0 && matchesFilePattern(resolvedFile, config.ignoreFiles, resolvedRoot)) {
    return false;
  }

  return true;
}

export function computeFindingFingerprints(findings) {
  const counts = new Map();
  return findings.map((f) => {
    const normalizedEvidence = String(f.evidence || '').replace(/\s*\(line \d+\)/g, '').trim();
    const baseKey = `${f.rule}|${normalizedEvidence}`;
    const ord = (counts.get(baseKey) || 0) + 1;
    counts.set(baseKey, ord);
    return `${f.rule}:${sha256Hex(`${baseKey}#${ord}`).slice(0, 16)}`;
  });
}

function computeBaselineKeysForContent(content, absFile, projectRoot) {
  if (!content) return [];
  const preimageFindings = scanContentInMemory(content, absFile, projectRoot).filter(isPrimaryHookFinding);
  return computeFindingFingerprints(preimageFindings);
}

import { scanKotlinSource } from '../scanner/kotlin-scanner.mjs';
import { parseMotionMd, findMotionMdForTarget } from '../scanner/motion-md.mjs';
import { analyzeLottieJson } from '../scanner/lottie-scanner.mjs';
import { getAllDomainPacks } from '../domains/registry.mjs';

function scanContentInMemory(content, absFile, projectRoot) {
  const lower = path.basename(absFile).toLowerCase();
  const kotlinFiles = [];
  const lottieFiles = [];
  const motionContracts = [];

  if (lower.endsWith('.kt')) {
    kotlinFiles.push(scanKotlinSource(content, absFile));
    const motionPath = findMotionMdForTarget(absFile, projectRoot);
    if (motionPath && fs.existsSync(motionPath)) {
      try {
        const parsed = parseMotionMd(fs.readFileSync(motionPath, 'utf8'), motionPath);
        parsed.lintFindings = [];
        motionContracts.push(parsed);
      } catch {
        // Ignore unreadable contract.
      }
    }
  } else if (lower === 'motion.md') {
    motionContracts.push(parseMotionMd(content, absFile));
  } else if (lower.endsWith('.json')) {
    const lottie = analyzeLottieJson(content, absFile);
    if (lottie.isLottie) lottieFiles.push(lottie);
  }

  const findings = [];
  for (const pack of getAllDomainPacks()) {
    const res = pack.run({
      kotlinFiles,
      lottieFiles,
      motionContracts,
      inlineIgnoresEnabled: true,
      collectStats: false,
    });
    findings.push(...res.findings);
  }
  return findings;
}

function isPrimaryHookFinding(f) {
  return f.class === 'floor' || f.class === 'obligation' || f.severity === 'major';
}

function tryReadGitHeadPreimage(absFile, _projectRoot, env = process.env) {
  try {
    const realpathFn = fs.realpathSync.native || fs.realpathSync;
    const realFile = realpathFn(path.resolve(absFile));
    const fileDir = path.dirname(realFile);
    const fileName = path.basename(realFile);
    if (!fileName || fileName.includes('/') || fileName.includes('\\')) return null;
    const gitEnv = { ...env, ANDROID_UX_HOOK_DEPTH: '1', GIT_OPTIONAL_LOCKS: '0' };
    const proc = spawnSync('git', ['show', `HEAD:./${fileName}`], {
      cwd: fileDir,
      env: gitEnv,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1500,
      maxBuffer: 2 * 1024 * 1024,
    });
    if (proc.status === 0 && typeof proc.stdout === 'string') {
      return proc.stdout;
    }
  } catch {
    // Fall back to unavailable if git is missing or times out.
  }
  return null;
}

function formatHookPayload(text, eventKind, harness) {
  if (!text) {
    if (eventKind === 'jetski-stop') return { decision: 'allow' };
    return {};
  }
  if (harness === 'jetski') {
    if (eventKind === 'jetski-pre-invocation') {
      return {
        injectSteps: [
          { ephemeralMessage: text },
        ],
      };
    }
    if (eventKind === 'jetski-stop') {
      return { decision: 'allow' };
    }
    return {};
  }
  if (harness === 'cursor') {
    return { additional_context: text.slice(0, CURSOR_MAX_CHARS) };
  }
  if (harness === 'copilot') {
    return { additionalContext: text };
  }
  // Never block Stop on Claude Code or Codex (Coordinator ruling #2): emit non-blocking systemMessage
  if (eventKind === 'stop') {
    return { systemMessage: text };
  }
  return {
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: text,
    },
  };
}

function renderHookFindingsMessage(groups, { cwd, maxFindings = 5, maxChars = 8000, isStopPass = false }) {
  const lines = [];
  const totalIssues = groups.reduce((acc, g) => acc + g.findings.length, 0);
  const headerVerb = isStopPass
    ? 'End-of-turn UX check on touched file(s)'
    : 'UX hook check on edited file(s)';
  lines.push(`${ENVELOPE_PREFIX} ${headerVerb} (${totalIssues} proven issue${totalIssues === 1 ? '' : 's'}):`);

  let shown = 0;
  for (const group of groups) {
    const relFile = normalizePosixPath(path.relative(cwd, group.filePath)) || path.basename(group.filePath);
    for (const f of group.findings) {
      if (shown >= maxFindings) break;
      const lineStr = f.lines?.[0] ? `:${f.lines[0]}` : '';
      const attrTag = f._attributionTag ? ` ${f._attributionTag}` : '';
      lines.push(`- ${relFile}${lineStr} [${f.rule}]${attrTag} ${f.evidence}`);
      lines.push(`  Fix: ${f.remediation} (${f.docPath})`);
      shown += 1;
    }
    if (shown >= maxFindings) break;
  }

  if (totalIssues > shown) {
    lines.push(`(${totalIssues - shown} more proven finding(s) omitted; run \`npx android-ux detect\` to view all.)`);
  }
  lines.push('Fix proven issues in code; if you suspect a detector false positive, flag it for the user rather than adding a waiver yourself.');

  const full = lines.join('\n');
  return full.length > maxChars ? `${full.slice(0, maxChars - 24)}\n...[truncated]` : full;
}

/**
 * Core programmatic hook execution. Never throws and always returns exitCode 0.
 */
export function executeHookPayload(stdinText, { cwd = process.cwd(), env = process.env, platform = process.platform, nowMs = Date.now() } = {}) {
  try {
    // 1. Re-entrancy and kill-switch checks
    if (isTruthyEnv(env.ANDROID_UX_HOOK_DEPTH) || isTruthyEnv(env.CLAUDE_HOOK_DEPTH)) {
      return { exitCode: 0, payload: {}, skipped: 'reentrant' };
    }
    if (isTruthyEnv(env.ANDROID_UX_HOOK_DISABLED)) {
      return { exitCode: 0, payload: {}, skipped: 'env-disabled' };
    }

    const trimmed = String(stdinText || '').trim();
    if (!trimmed) {
      return { exitCode: 0, payload: {}, skipped: 'stdin-empty' };
    }

    let raw;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      return { exitCode: 0, payload: {}, skipped: 'stdin-malformed' };
    }

    const event = normalizeHookPayload(raw, { cwd, env });
    if (event.kind === 'noop') {
      return { exitCode: 0, payload: {}, skipped: 'noop' };
    }
    if (event.kind === 'jetski-stop') {
      return { exitCode: 0, payload: { decision: 'allow' }, skipped: 'jetski-stop-allow' };
    }
    if (event.kind === 'stop' && event.stopHookActive) {
      return { exitCode: 0, payload: {}, skipped: 'stop-hook-active' };
    }

    // 2. Jetski `PreInvocation`: flush queued reminders from `PostToolUse`
    if (event.kind === 'jetski-pre-invocation') {
      const candidateRoots = Array.from(new Set([
        ...(event.roots || []),
        ...listSessionRoots(event.sessionId, env, platform),
      ]));
      const messages = [];
      for (const root of candidateRoots) {
        const cfg = readProjectConfig(root);
        if (cfg.hook.enabled === false) continue;
        const cache = readProjectSessionCache(root, env, platform, nowMs);
        const sess = cache.sessions[event.sessionId];
        if (sess && Array.isArray(sess.pendingJetskiMessages) && sess.pendingJetskiMessages.length > 0) {
          messages.push(...sess.pendingJetskiMessages);
          sess.pendingJetskiMessages = [];
          sess.updatedAt = nowMs;
          writeProjectSessionCache(root, cache, env, platform, nowMs);
        }
      }
      if (messages.length === 0) {
        return { exitCode: 0, payload: {}, skipped: 'no-queued-messages' };
      }
      const joined = messages.join('\n\n');
      return {
        exitCode: 0,
        payload: formatHookPayload(joined, 'jetski-pre-invocation', 'jetski'),
        emitted: true,
      };
    }

    // 3. Claude Code / Codex `Stop`: deep pass over session-touched files with preimage diffing
    if (event.kind === 'stop') {
      const candidateRoots = Array.from(new Set([
        event.projectRoot,
        ...listSessionRoots(event.sessionId, env, platform),
      ]));

      const allGroups = [];
      let maxFindings = 5;
      let maxChars = 8000;

      for (const root of candidateRoots) {
        const config = readProjectConfig(root);
        if (config.hook.enabled === false) continue;
        maxFindings = config.hook.limits?.maxFindings ?? maxFindings;
        maxChars = config.hook.limits?.maxChars ?? maxChars;

        const cache = readProjectSessionCache(root, env, platform, nowMs);
        const sess = cache.sessions[event.sessionId];
        if (!sess || !sess.files || typeof sess.files !== 'object') continue;

        const touchedFiles = Object.keys(sess.files).slice(0, 20);
        let cacheMutated = false;

        for (const absFile of touchedFiles) {
          if (!isScannableInsideProject(absFile, root, config)) continue;
          const fileState = sess.files[absFile];
          const scanRes = runStaticScan({
            targets: [absFile],
            cwd: root,
            noAdvisory: true,
          });
          const liveFindings = (scanRes.findings || []).filter(isPrimaryHookFinding);
          const liveFingerprints = computeFindingFingerprints(liveFindings);
          const baselineSet = new Set(fileState.baselineKeys || []);
          const reportedSet = new Set(fileState.reportedKeys || []);

          const freshForStop = [];
          const allLiveKeys = [];

          for (let idx = 0; idx < liveFindings.length; idx += 1) {
            const f = liveFindings[idx];
            const fp = liveFingerprints[idx];
            allLiveKeys.push(fp);
            // Suppress already-reported findings in this session
            if (reportedSet.has(fp)) continue;
            // Suppress pre-existing legacy findings proven present before the first edit
            if (fileState.baselineStatus === 'captured' && baselineSet.has(fp)) continue;

            const tagged = {
              ...f,
              _attributionTag:
                fileState.baselineStatus === 'captured' || fileState.baselineStatus === 'created'
                  ? '[new]'
                  : '[attribution unknown]',
            };
            freshForStop.push(tagged);
          }

          fileState.reportedKeys = Array.from(new Set([...reportedSet, ...allLiveKeys]));
          sess.updatedAt = nowMs;
          cacheMutated = true;

          if (freshForStop.length > 0) {
            allGroups.push({ filePath: absFile, findings: freshForStop, root });
          }
        }

        if (cacheMutated) {
          writeProjectSessionCache(root, cache, env, platform, nowMs);
        }
      }

      if (allGroups.length === 0) {
        return { exitCode: 0, payload: {}, skipped: 'stop-clean' };
      }

      const text = renderHookFindingsMessage(allGroups, {
        cwd: event.projectRoot,
        maxFindings,
        maxChars,
        isStopPass: true,
      });
      return {
        exitCode: 0,
        payload: formatHookPayload(text, 'stop', event.harness),
        emitted: true,
      };
    }

    // 4. `PostToolUse` (Claude Code, Codex, Cursor, Copilot, and Jetski queue)
    if (event.failedTool) {
      return { exitCode: 0, payload: {}, skipped: 'tool-failed' };
    }

    const candidateRoots = normalizeWorkspaceRoots(event.roots, event.projectRoot);
    const filesByRoot = new Map();
    for (const rawFile of event.files || []) {
      const match = findOwningWorkspaceRoot(rawFile, candidateRoots);
      if (!match) continue;
      if (!filesByRoot.has(match.root)) {
        filesByRoot.set(match.root, []);
      }
      const list = filesByRoot.get(match.root);
      if (!list.includes(match.absFile)) {
        list.push(match.absFile);
      }
    }

    if (filesByRoot.size === 0) {
      const defaultCfg = readProjectConfig(event.projectRoot);
      if (defaultCfg.hook.enabled === false) {
        return { exitCode: 0, payload: {}, skipped: 'config-disabled' };
      }
      return { exitCode: 0, payload: {}, skipped: 'no-scannable-file' };
    }

    let sawConfigDisabled = false;
    let sawScannableFile = false;
    let sawDuplicateEvent = false;
    let processedAnyRoot = false;
    const emittedMessages = [];

    for (const [projectRoot, rootCandidateFiles] of filesByRoot.entries()) {
      const config = readProjectConfig(projectRoot);
      if (config.hook.enabled === false) {
        sawConfigDisabled = true;
        continue;
      }

      const scannableFiles = rootCandidateFiles.filter((f) => isScannableInsideProject(f, projectRoot, config));
      if (scannableFiles.length === 0) {
        continue;
      }
      sawScannableFile = true;

      // Atomic O_EXCL deduplication across overlapping project + user/plugin manifests
      if (event.toolUseId) {
        const claimed = claimHookEvent(event.sessionId, event.toolUseId, projectRoot, scannableFiles, env, platform, nowMs);
        if (!claimed) {
          sawDuplicateEvent = true;
          continue;
        }
      }
      processedAnyRoot = true;

      const cache = readProjectSessionCache(projectRoot, env, platform, nowMs);
      if (!cache.sessions[event.sessionId]) {
        cache.sessions[event.sessionId] = {
          updatedAt: nowMs,
          files: {},
          pendingJetskiMessages: [],
        };
      }
      const sess = cache.sessions[event.sessionId];
      sess.updatedAt = nowMs;

      // Harnesses without a `Stop` hook (Cursor, Copilot, Jetski) check Tier 1 + Tier 2 immediately
      const useImmediateTierOnly =
        config.hook.perEditRules !== 'all' &&
        (event.harness === 'claude' || event.harness === 'codex');

      const freshGroups = [];
      let suppressionNoticeFile = null;
      let cacheShouldPersist = false;

      for (const absFile of scannableFiles) {
        if (!sess.files[absFile]) {
          let baselineStatus = event.preimage?.status || 'unavailable';
          let baselineContent = event.preimage?.originalContent ?? null;
          if (baselineStatus === 'unavailable') {
            const headContent = tryReadGitHeadPreimage(absFile, projectRoot, env);
            if (headContent !== null) {
              baselineStatus = 'captured';
              baselineContent = headContent;
            }
          }
          const baselineKeys =
            baselineStatus === 'captured' && baselineContent !== null
              ? computeBaselineKeysForContent(baselineContent, absFile, projectRoot)
              : [];
          sess.files[absFile] = {
            editCount: 0,
            baselineStatus,
            baselineKeys,
            reportedKeys: [],
          };
        }

        const fileState = sess.files[absFile];
        fileState.editCount = (fileState.editCount || 0) + 1;
        cacheShouldPersist = true;

        if (fileState.editCount > EDIT_CAP_PER_FILE) {
          if (fileState.editCount === EDIT_CAP_PER_FILE + 1 && !suppressionNoticeFile) {
            suppressionNoticeFile = absFile;
          }
          continue;
        }

        const scanRes = runStaticScan({
          targets: [absFile],
          cwd: projectRoot,
        });

        const liveFindings = (scanRes.findings || []).filter(isPrimaryHookFinding);
        const liveFingerprints = computeFindingFingerprints(liveFindings);
        const baselineSet = new Set(fileState.baselineKeys || []);
        const reportedSet = new Set(fileState.reportedKeys || []);

        const immediateFresh = [];
        const newlyReportedKeys = [];

        for (let idx = 0; idx < liveFindings.length; idx += 1) {
          const f = liveFindings[idx];
          const fp = liveFingerprints[idx];
          const ruleMeta = findRuleById(f.rule);
          const isImmediate = !useImmediateTierOnly || ruleMeta?.hookTier === 'immediate';
          if (!isImmediate) continue;

          newlyReportedKeys.push(fp);
          if (reportedSet.has(fp)) continue;
          if (fileState.baselineStatus === 'captured' && baselineSet.has(fp)) continue;
          immediateFresh.push(f);
        }

        fileState.reportedKeys = Array.from(new Set([...reportedSet, ...newlyReportedKeys]));
        if (immediateFresh.length > 0) {
          freshGroups.push({ filePath: absFile, findings: immediateFresh });
        }
      }

      let rootMessageText = '';
      if (freshGroups.length > 0) {
        rootMessageText = renderHookFindingsMessage(freshGroups, {
          cwd: projectRoot,
          maxFindings: config.hook.limits?.maxFindings ?? 5,
          maxChars: event.harness === 'cursor'
            ? Math.min(config.hook.limits?.maxChars ?? 8000, CURSOR_MAX_CHARS)
            : (config.hook.limits?.maxChars ?? 8000),
          isStopPass: false,
        });
      } else if (suppressionNoticeFile && !config.hook.quiet && !isTruthyEnv(env.ANDROID_UX_HOOK_QUIET)) {
        const rel = normalizePosixPath(path.relative(projectRoot, suppressionNoticeFile)) || path.basename(suppressionNoticeFile);
        rootMessageText = `${ENVELOPE_PREFIX} Per-edit UX reminders paused for ${rel} after ${EDIT_CAP_PER_FILE} edits in this session (run \`npx android-ux detect ${rel}\` when ready).`;
      }

      if (event.harness === 'jetski' && rootMessageText) {
        sess.pendingJetskiMessages = sess.pendingJetskiMessages || [];
        sess.pendingJetskiMessages.push(rootMessageText);
        cacheShouldPersist = true;
      }

      if (cacheShouldPersist) {
        writeProjectSessionCache(projectRoot, cache, env, platform, nowMs);
        recordSessionRoot(event.sessionId, projectRoot, env, platform, nowMs);
      }

      if (rootMessageText) {
        emittedMessages.push(rootMessageText);
      }
    }

    if (!processedAnyRoot) {
      if (sawDuplicateEvent) {
        return { exitCode: 0, payload: {}, skipped: 'duplicate-event' };
      }
      if (!sawScannableFile && sawConfigDisabled) {
        return { exitCode: 0, payload: {}, skipped: 'config-disabled' };
      }
      return { exitCode: 0, payload: {}, skipped: 'no-scannable-file' };
    }

    const messageText = emittedMessages.join('\n\n');
    if (!messageText || event.harness === 'jetski') {
      return { exitCode: 0, payload: {}, emitted: false };
    }

    return {
      exitCode: 0,
      payload: formatHookPayload(messageText, 'post-tool-use', event.harness),
      emitted: true,
    };
  } catch (err) {
    if (isTruthyEnv(env.ANDROID_UX_HOOK_DEBUG)) {
      process.stderr.write(`[android-ux-hook] ${err?.stack || err?.message || String(err)}\n`);
    }
    return { exitCode: 0, payload: {}, skipped: 'exception' };
  }
}

export async function runHookCommand(_rawArgs, io = defaultIo()) {
  const prevDepth = io.env?.ANDROID_UX_HOOK_DEPTH;
  // Pass original env (with parent depth preserved) into executeHookPayload so re-entrancy triggers if parent already set depth=1
  const evalEnv = prevDepth ? io.env : { ...io.env };
  const shouldMutateProcessEnv = io.env === process.env && !prevDepth;
  if (shouldMutateProcessEnv) {
    process.env.ANDROID_UX_HOOK_DEPTH = '1';
  }

  try {
    let stdinText = '';
    if (typeof io.stdinText === 'string') {
      stdinText = io.stdinText;
    } else if (io.stdin && !io.stdin.isTTY) {
      try {
        stdinText = fs.readFileSync(0, 'utf8');
      } catch {
        stdinText = '';
      }
    }

    const res = executeHookPayload(stdinText, {
      cwd: io.cwd,
      env: evalEnv,
      platform: io.platform || process.platform,
    });

    io.stdout.write(`${JSON.stringify(res.payload || {})}\n`);
    return 0;
  } finally {
    if (shouldMutateProcessEnv) {
      delete process.env.ANDROID_UX_HOOK_DEPTH;
    }
  }
}

function defaultIo() {
  return {
    cwd: process.cwd(),
    env: process.env,
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
  };
}
