import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CACHE_MAX_SESSIONS = 8;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CLAIM_BUCKET_SEC = 600;

export function sha256Hex(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

export function resolveHomeDir(env = process.env, platform = process.platform) {
  if (platform === 'win32') {
    return env.USERPROFILE || env.HOME || safeOsHomedir();
  }
  return env.HOME || env.USERPROFILE || safeOsHomedir();
}

function safeOsHomedir() {
  try {
    return os.homedir() || '';
  } catch {
    return '';
  }
}

export function resolveUserCacheDir(env = process.env, platform = process.platform) {
  if (env.ANDROID_UX_CACHE_DIR && String(env.ANDROID_UX_CACHE_DIR).trim()) {
    return path.resolve(String(env.ANDROID_UX_CACHE_DIR).trim());
  }
  if (env.XDG_CACHE_HOME && String(env.XDG_CACHE_HOME).trim()) {
    return path.join(path.resolve(String(env.XDG_CACHE_HOME).trim()), 'android-ux');
  }
  const home = resolveHomeDir(env, platform);
  if (platform === 'win32') {
    if (env.LOCALAPPDATA && String(env.LOCALAPPDATA).trim()) {
      return path.join(path.resolve(String(env.LOCALAPPDATA).trim()), 'android-ux', 'cache');
    }
    return home ? path.join(home, '.cache', 'android-ux') : '';
  }
  if (platform === 'darwin') {
    return home ? path.join(home, 'Library', 'Caches', 'android-ux') : '';
  }
  return home ? path.join(home, '.cache', 'android-ux') : '';
}

function ensureSafeDir(dirPath, platform = process.platform) {
  if (!dirPath) return false;
  try {
    const resolved = path.resolve(dirPath);
    fs.mkdirSync(resolved, { recursive: true, mode: 0o700 });
    const stat = fs.lstatSync(resolved);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
    if (platform !== 'win32' && typeof process.getuid === 'function') {
      if (stat.uid !== process.getuid()) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function getProjectCachePath(projectRoot, env = process.env, platform = process.platform) {
  const base = resolveUserCacheDir(env, platform);
  if (!base) return '';
  return path.join(base, 'projects', `${sha256Hex(path.resolve(projectRoot))}.json`);
}

export function readProjectSessionCache(projectRoot, env = process.env, platform = process.platform, nowMs = Date.now()) {
  const filePath = getProjectCachePath(projectRoot, env, platform);
  const empty = { version: 1, projectRoot: path.resolve(projectRoot), sessions: {} };
  if (!filePath) return empty;
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) return empty;
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!raw || typeof raw !== 'object' || raw.version !== 1 || !raw.sessions || typeof raw.sessions !== 'object') {
      return empty;
    }
    const prunedSessions = {};
    const entries = Object.entries(raw.sessions)
      .filter(([, s]) => s && typeof s === 'object' && typeof s.updatedAt === 'number' && (nowMs - s.updatedAt) <= SESSION_TTL_MS)
      .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
      .slice(0, CACHE_MAX_SESSIONS);
    for (const [sid, session] of entries) {
      prunedSessions[sid] = session;
    }
    return {
      version: 1,
      projectRoot: path.resolve(projectRoot),
      sessions: prunedSessions,
    };
  } catch {
    return empty;
  }
}

export function writeProjectSessionCache(projectRoot, cache, env = process.env, platform = process.platform, nowMs = Date.now()) {
  const filePath = getProjectCachePath(projectRoot, env, platform);
  if (!filePath) return false;
  const dir = path.dirname(filePath);
  if (!ensureSafeDir(dir, platform)) return false;

  try {
    const entries = Object.entries(cache?.sessions || {})
      .filter(([, s]) => s && typeof s === 'object')
      .map(([sid, s]) => [sid, { ...s, updatedAt: typeof s.updatedAt === 'number' ? s.updatedAt : nowMs }])
      .filter(([, s]) => (nowMs - s.updatedAt) <= SESSION_TTL_MS)
      .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
      .slice(0, CACHE_MAX_SESSIONS);

    const normalized = {
      version: 1,
      projectRoot: path.resolve(projectRoot),
      sessions: Object.fromEntries(entries),
    };
    const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(normalized), { mode: 0o600 });
    fs.renameSync(tmp, filePath);
    sweepStaleProjectCaches(dir, nowMs);
    return true;
  } catch {
    return false;
  }
}

function sweepStaleProjectCaches(projectsDir, nowMs) {
  try {
    const names = fs.readdirSync(projectsDir).slice(0, 128);
    let removed = 0;
    for (const name of names) {
      if (removed >= 16) break;
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
      const full = path.join(projectsDir, name);
      try {
        const st = fs.lstatSync(full);
        if (st.isFile() && !st.isSymbolicLink() && (nowMs - st.mtimeMs) > SESSION_TTL_MS) {
          fs.unlinkSync(full);
          removed += 1;
        }
      } catch {
        // Ignore race.
      }
    }
  } catch {
    // Fail open.
  }
}

export function clearProjectSessionCache(projectRoot, env = process.env, platform = process.platform) {
  const filePath = getProjectCachePath(projectRoot, env, platform);
  if (!filePath) return false;
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
  } catch {
    // Fail open.
  }
  return false;
}

export function recordSessionRoot(sessionId, projectRoot, env = process.env, platform = process.platform, nowMs = Date.now()) {
  if (!sessionId || sessionId === 'unknown' || !projectRoot) return false;
  const base = resolveUserCacheDir(env, platform);
  if (!base) return false;
  const sessionsRoot = path.join(base, 'hook-sessions');
  const sessionDir = path.join(sessionsRoot, sha256Hex(sessionId));
  if (!ensureSafeDir(sessionDir, platform)) return false;

  const resolvedRoot = path.resolve(projectRoot);
  const recordFile = path.join(sessionDir, sha256Hex(resolvedRoot));
  try {
    if (!fs.existsSync(recordFile)) {
      fs.writeFileSync(recordFile, resolvedRoot, { flag: 'wx', mode: 0o600 });
    }
    sweepExpiredSessionDirs(sessionsRoot, nowMs);
    return true;
  } catch (err) {
    if (err && err.code === 'EEXIST') return true;
    return false;
  }
}

export function listSessionRoots(sessionId, env = process.env, platform = process.platform) {
  if (!sessionId || sessionId === 'unknown') return [];
  const base = resolveUserCacheDir(env, platform);
  if (!base) return [];
  const sessionDir = path.join(base, 'hook-sessions', sha256Hex(sessionId));
  try {
    const st = fs.lstatSync(sessionDir);
    if (!st.isDirectory() || st.isSymbolicLink()) return [];
    const entries = fs.readdirSync(sessionDir).slice(0, 16);
    const out = [];
    for (const name of entries) {
      if (!/^[a-f0-9]{64}$/.test(name)) continue;
      const full = path.join(sessionDir, name);
      try {
        const fst = fs.lstatSync(full);
        if (!fst.isFile() || fst.isSymbolicLink()) continue;
        const content = fs.readFileSync(full, 'utf8').trim();
        if (!content || !path.isAbsolute(content)) continue;
        if (sha256Hex(content) !== name) continue;
        if (fs.existsSync(content) && fs.statSync(content).isDirectory()) {
          out.push(content);
        }
      } catch {
        // Ignore broken entry.
      }
    }
    return out;
  } catch {
    return [];
  }
}

function sweepExpiredSessionDirs(sessionsRoot, nowMs) {
  try {
    const names = fs.readdirSync(sessionsRoot).slice(0, 128);
    let removed = 0;
    for (const name of names) {
      if (removed >= 16) break;
      if (!/^[a-f0-9]{64}$/.test(name)) continue;
      const dir = path.join(sessionsRoot, name);
      try {
        const st = fs.lstatSync(dir);
        if (!st.isDirectory() || st.isSymbolicLink()) continue;
        if ((nowMs - st.mtimeMs) <= SESSION_TTL_MS) continue;
        for (const child of fs.readdirSync(dir)) {
          if (/^[a-f0-9]{64}$/.test(child)) {
            const childPath = path.join(dir, child);
            const cst = fs.lstatSync(childPath);
            if (cst.isFile() && !cst.isSymbolicLink()) fs.unlinkSync(childPath);
          }
        }
        fs.rmdirSync(dir);
        removed += 1;
      } catch {
        // Ignore race.
      }
    }
  } catch {
    // Fail open.
  }
}

/**
 * Atomic O_EXCL claim for deduplicating identical hook invocations when both
 * project and user/plugin manifests fire on the same tool_use_id.
 * Returns true if claimed (caller should proceed), false if already claimed.
 * Fails open (returns true) on any filesystem error.
 */
export function claimHookEvent(sessionId, toolUseId, projectRoot, targetFiles, env = process.env, platform = process.platform, nowMs = Date.now()) {
  if (!toolUseId) return true;
  const base = resolveUserCacheDir(env, platform);
  if (!base) return true;
  const claimsRoot = path.join(base, 'hook-claims');
  if (!ensureSafeDir(claimsRoot, platform)) return true;

  const bucket = Math.floor(nowMs / 1000 / CLAIM_BUCKET_SEC);
  const prevBucket = bucket - 1;
  const key = sha256Hex([
    sessionId || '',
    toolUseId,
    path.resolve(projectRoot),
    ...[...(targetFiles || [])].map((f) => path.resolve(f)).sort(),
  ].join('\0'));

  const prevPath = path.join(claimsRoot, String(prevBucket), key);
  try {
    if (fs.existsSync(prevPath)) return false;
  } catch {
    // Fail open.
  }

  const bucketDir = path.join(claimsRoot, String(bucket));
  const createdBucket = !fs.existsSync(bucketDir);
  if (!ensureSafeDir(bucketDir, platform)) return true;

  const claimPath = path.join(bucketDir, key);
  try {
    fs.writeFileSync(claimPath, '', { flag: 'wx', mode: 0o600 });
    if (createdBucket) {
      sweepOldClaimBuckets(claimsRoot, prevBucket);
    }
    return true;
  } catch (err) {
    if (err && err.code === 'EEXIST') return false;
    return true;
  }
}

function sweepOldClaimBuckets(claimsRoot, minKeepBucket) {
  try {
    for (const entry of fs.readdirSync(claimsRoot)) {
      if (!/^\d+$/.test(entry)) continue;
      if (Number(entry) >= minKeepBucket) continue;
      const dir = path.join(claimsRoot, entry);
      try {
        const st = fs.lstatSync(dir);
        if (!st.isDirectory() || st.isSymbolicLink()) continue;
        for (const child of fs.readdirSync(dir)) {
          if (/^[a-f0-9]{64}$/.test(child)) {
            const p = path.join(dir, child);
            const cst = fs.lstatSync(p);
            if (cst.isFile() && !cst.isSymbolicLink()) fs.unlinkSync(p);
          }
        }
        fs.rmdirSync(dir);
      } catch {
        // Ignore race.
      }
    }
  } catch {
    // Fail open.
  }
}
