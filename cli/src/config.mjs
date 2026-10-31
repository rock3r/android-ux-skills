import fs from 'node:fs';
import path from 'node:path';
import { STANDARDS_VERSION } from './version.mjs';

export const CONFIG_DIR_NAME = '.android-ux';
export const SHARED_CONFIG_FILE = 'config.json';
export const LOCAL_CONFIG_FILE = 'config.local.json';

const EXCLUDE_OPEN = '# android-ux-ignore-start';
const EXCLUDE_CLOSE = '# android-ux-ignore-end';

export const DEFAULT_PROJECT_CONFIG = Object.freeze({
  hook: {
    enabled: true,
    quiet: false,
    perEditRules: 'all',
    auditLog: null,
    limits: {
      maxFindings: 5,
      maxChars: 8000,
      maxFileBytes: 262144,
    },
  },
  ignoreFiles: [],
  waivers: [],
});

export function getSharedConfigPath(cwd) {
  return path.join(path.resolve(cwd), CONFIG_DIR_NAME, SHARED_CONFIG_FILE);
}

export function getLocalConfigPath(cwd) {
  return path.join(path.resolve(cwd), CONFIG_DIR_NAME, LOCAL_CONFIG_FILE);
}

export function normalizePosixPath(p) {
  return String(p || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

export function normalizeWaiverEntry(entry, source = 'shared') {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const rule = String(entry.rule || '').trim().toUpperCase();
  const reason = String(entry.reason || '').trim();
  if (!rule || !reason) return null;

  const kind = entry.kind === 'false-positive' ? 'false-positive' : 'waiver';
  const rawFiles = [];
  if (typeof entry.file === 'string' && entry.file.trim()) rawFiles.push(entry.file.trim());
  if (Array.isArray(entry.files)) {
    for (const f of entry.files) {
      if (typeof f === 'string' && f.trim()) rawFiles.push(f.trim());
    }
  }
  const files = Array.from(new Set(rawFiles.map(normalizePosixPath))).sort();
  const value = typeof entry.value === 'string' && entry.value.trim() ? entry.value.trim() : undefined;
  const createdAt = typeof entry.createdAt === 'string' && entry.createdAt.trim()
    ? entry.createdAt.trim()
    : undefined;
  const standardsVersion = typeof entry.standardsVersion === 'string' && entry.standardsVersion.trim()
    ? entry.standardsVersion.trim()
    : STANDARDS_VERSION;
  const expiresAt = typeof entry.expiresAt === 'string' && entry.expiresAt.trim()
    ? entry.expiresAt.trim()
    : undefined;

  const out = { rule };
  if (value !== undefined) out.value = value;
  if (files.length > 0) out.files = files;
  out.kind = kind;
  out.reason = reason;
  if (createdAt !== undefined) out.createdAt = createdAt;
  out.standardsVersion = standardsVersion;
  if (expiresAt !== undefined) out.expiresAt = expiresAt;
  Object.defineProperty(out, '_source', { value: source, enumerable: false });
  return out;
}

export function waiverKey(w) {
  const filesPart = Array.isArray(w.files) ? [...w.files].sort().join('\x1f') : '';
  return `${w.rule}\0${w.value || ''}\0${filesPart}\0${w.kind || 'waiver'}`;
}

function readRawJson(filePath) {
  if (!fs.existsSync(filePath)) return { exists: false, malformed: false, data: null };
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { exists: true, malformed: true, data: null };
    }
    return { exists: true, malformed: false, data: parsed };
  } catch {
    return { exists: true, malformed: true, data: null };
  }
}

function applyConfigLayer(target, raw, source) {
  if (!raw || typeof raw !== 'object') return;
  if (raw.hook && typeof raw.hook === 'object' && !Array.isArray(raw.hook)) {
    const h = raw.hook;
    if (Object.prototype.hasOwnProperty.call(h, 'enabled')) {
      target.hook.enabled = h.enabled !== false;
    }
    if (Object.prototype.hasOwnProperty.call(h, 'quiet')) {
      target.hook.quiet = h.quiet === true;
    }
    if (h.perEditRules === 'all' || h.perEditRules === 'immediate') {
      target.hook.perEditRules = h.perEditRules;
    }
    if (typeof h.auditLog === 'string' && h.auditLog.trim()) {
      target.hook.auditLog = h.auditLog.trim();
    }
    if (h.limits && typeof h.limits === 'object' && !Array.isArray(h.limits)) {
      if (Number.isFinite(h.limits.maxFindings) && h.limits.maxFindings > 0) {
        target.hook.limits.maxFindings = h.limits.maxFindings;
      }
      if (Number.isFinite(h.limits.maxChars) && h.limits.maxChars > 0) {
        target.hook.limits.maxChars = h.limits.maxChars;
      }
      if (Number.isFinite(h.limits.maxFileBytes) && h.limits.maxFileBytes > 0) {
        target.hook.limits.maxFileBytes = h.limits.maxFileBytes;
      }
    }
  }
  if (Array.isArray(raw.ignoreFiles)) {
    const merged = new Set([
      ...target.ignoreFiles,
      ...raw.ignoreFiles.filter((x) => typeof x === 'string' && x.trim()).map(normalizePosixPath),
    ]);
    target.ignoreFiles = Array.from(merged);
  }
  if (Array.isArray(raw.waivers)) {
    const byKey = new Map(target.waivers.map((w) => [waiverKey(w), w]));
    for (const item of raw.waivers) {
      const norm = normalizeWaiverEntry(item, source);
      if (norm) byKey.set(waiverKey(norm), norm);
    }
    target.waivers = Array.from(byKey.values());
  }
}

/**
 * Pure read-only config loader. Never creates `.android-ux/`.
 */
export function readProjectConfig(cwd) {
  const sharedPath = getSharedConfigPath(cwd);
  const localPath = getLocalConfigPath(cwd);
  const sharedRaw = readRawJson(sharedPath);
  const localRaw = readRawJson(localPath);

  const merged = {
    hook: {
      enabled: DEFAULT_PROJECT_CONFIG.hook.enabled,
      quiet: DEFAULT_PROJECT_CONFIG.hook.quiet,
      perEditRules: DEFAULT_PROJECT_CONFIG.hook.perEditRules,
      auditLog: DEFAULT_PROJECT_CONFIG.hook.auditLog,
      limits: { ...DEFAULT_PROJECT_CONFIG.hook.limits },
    },
    ignoreFiles: [],
    waivers: [],
  };

  if (sharedRaw.data) applyConfigLayer(merged, sharedRaw.data, 'shared');
  if (localRaw.data) applyConfigLayer(merged, localRaw.data, 'local');

  return {
    ...merged,
    meta: {
      sharedPath,
      localPath,
      sharedExists: sharedRaw.exists,
      localExists: localRaw.exists,
      sharedMalformed: sharedRaw.malformed,
      localMalformed: localRaw.malformed,
    },
  };
}

export function writeConfigObject(cwd, nextObj, { local = false } = {}) {
  const resolvedCwd = path.resolve(cwd);
  const targetPath = local ? getLocalConfigPath(resolvedCwd) : getSharedConfigPath(resolvedCwd);
  if (local) {
    ensureLocalConfigGitExclude(resolvedCwd);
  }
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const serialized = `${JSON.stringify(nextObj, null, 2)}\n`;
  fs.writeFileSync(targetPath, serialized, 'utf8');
  return targetPath;
}

export function readEditableConfigObject(cwd, { local = false } = {}) {
  const targetPath = local ? getLocalConfigPath(cwd) : getSharedConfigPath(cwd);
  const raw = readRawJson(targetPath);
  if (raw.malformed) {
    throw new Error(`Refusing to overwrite malformed or unreadable config file "${targetPath}".`);
  }
  return raw.data ? { ...raw.data } : {};
}

/**
 * Ensure `.android-ux/config.local.json` is listed in `<gitdir-or-commondir>/info/exclude`
 * without ever modifying tracked `.gitignore`. Supports standard `.git/` directories and
 * linked git worktrees (`gitdir:` file + `commondir`).
 */
export function ensureLocalConfigGitExclude(cwd) {
  const resolvedCwd = path.resolve(cwd);
  let cur = resolvedCwd;
  let repoRoot = null;
  let gitEntry = null;

  while (true) {
    const candidate = path.join(cur, '.git');
    if (fs.existsSync(candidate)) {
      repoRoot = cur;
      gitEntry = candidate;
      break;
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }

  if (!repoRoot || !gitEntry) {
    return { mode: 'none', file: null, changed: false };
  }

  try {
    let gitDir = gitEntry;
    const st = fs.statSync(gitEntry);
    if (st.isFile()) {
      const text = fs.readFileSync(gitEntry, 'utf8');
      const m = text.match(/^gitdir:\s*(.+)$/m);
      if (!m) return { mode: 'none', file: null, changed: false };
      gitDir = path.resolve(repoRoot, m[1].trim());
    }

    let excludeBaseDir = gitDir;
    const commondirFile = path.join(gitDir, 'commondir');
    if (fs.existsSync(commondirFile) && fs.statSync(commondirFile).isFile()) {
      const commonRel = fs.readFileSync(commondirFile, 'utf8').trim();
      if (commonRel) {
        excludeBaseDir = path.resolve(gitDir, commonRel);
      }
    }

    const infoDir = path.join(excludeBaseDir, 'info');
    fs.mkdirSync(infoDir, { recursive: true });
    const excludeFile = path.join(infoDir, 'exclude');
    const relPrefix = normalizePosixPath(path.relative(repoRoot, resolvedCwd));
    const markerLabel = relPrefix || '.';
    const pattern = relPrefix
      ? `${relPrefix}/${CONFIG_DIR_NAME}/${LOCAL_CONFIG_FILE}`
      : `${CONFIG_DIR_NAME}/${LOCAL_CONFIG_FILE}`;
    const openLine = `${EXCLUDE_OPEN} ${markerLabel}`;
    const closeLine = `${EXCLUDE_CLOSE} ${markerLabel}`;
    const block = `${openLine}\n${pattern}\n${closeLine}`;

    const existing = fs.existsSync(excludeFile) ? fs.readFileSync(excludeFile, 'utf8') : '';
    const escapedOpen = openLine.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedClose = closeLine.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const blockRe = new RegExp(`^${escapedOpen}$[\\s\\S]*?^${escapedClose}$`, 'm');

    let next;
    if (blockRe.test(existing)) {
      next = existing.replace(blockRe, block);
    } else if (!existing) {
      next = `${block}\n`;
    } else {
      const withNl = existing.endsWith('\n') ? existing : `${existing}\n`;
      const sep = withNl.endsWith('\n\n') ? '' : '\n';
      next = `${withNl}${sep}${block}\n`;
    }

    if (next === existing) {
      return { mode: 'git-info-exclude', file: excludeFile, changed: false };
    }
    fs.writeFileSync(excludeFile, next, 'utf8');
    return { mode: 'git-info-exclude', file: excludeFile, changed: true };
  } catch (err) {
    return { mode: 'error', file: null, changed: false, error: err?.message || String(err) };
  }
}

export function globToRegExp(glob) {
  const norm = normalizePosixPath(glob);
  let out = '^';
  for (let i = 0; i < norm.length; i += 1) {
    const ch = norm[i];
    if (ch === '*') {
      if (norm[i + 1] === '*') {
        if (norm[i + 2] === '/') {
          out += '(?:.*/)?';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else {
        out += '[^/]*';
      }
    } else if (ch === '?') {
      out += '[^/]';
    } else if ('+()^$.|[]\\{}'.includes(ch)) {
      out += `\\${ch}`;
    } else {
      out += ch;
    }
  }
  out += '$';
  return new RegExp(out);
}

export function matchesFilePattern(filePath, patterns, cwd = process.cwd()) {
  if (!Array.isArray(patterns) || patterns.length === 0) return false;
  const abs = normalizePosixPath(path.resolve(cwd, filePath));
  const rel = normalizePosixPath(path.relative(path.resolve(cwd), path.resolve(cwd, filePath)));
  const base = path.posix.basename(abs);
  const parts = abs.split('/').filter(Boolean);

  for (const pat of patterns) {
    const re = globToRegExp(pat);
    if (re.test(rel) || re.test(abs) || re.test(base)) return true;
    for (let i = 0; i < parts.length; i += 1) {
      if (re.test(parts.slice(i).join('/'))) return true;
    }
  }
  return false;
}

export function matchesExactProjectPath(filePath, literalPatterns, cwd = process.cwd()) {
  if (!Array.isArray(literalPatterns) || literalPatterns.length === 0) return false;
  const resolvedCwd = path.resolve(cwd);
  const absFile = normalizePosixPath(path.resolve(resolvedCwd, filePath));
  const relFile = normalizePosixPath(path.relative(resolvedCwd, path.resolve(resolvedCwd, filePath)));

  for (const pat of literalPatterns) {
    if (/[*?[\]{}]/.test(pat)) continue;
    const normPat = normalizePosixPath(pat).replace(/^\.\//, '');
    const absPat = normalizePosixPath(path.resolve(resolvedCwd, pat));
    if (relFile === normPat || absFile === absPat) return true;
  }
  return false;
}

export function isWaiverExpired(waiver, nowDate = new Date()) {
  if (!waiver || !waiver.expiresAt) return false;
  const m = String(waiver.expiresAt).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const todayUtc = nowDate.toISOString().slice(0, 10);
  return waiver.expiresAt < todayUtc;
}
