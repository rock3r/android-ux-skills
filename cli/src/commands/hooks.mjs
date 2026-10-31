import fs from 'node:fs';
import path from 'node:path';
import { createJsonEnvelope } from '../diagnostics.mjs';
import {
  readProjectConfig,
  readEditableConfigObject,
  writeConfigObject,
  getSharedConfigPath,
  getLocalConfigPath,
  normalizePosixPath,
} from '../config.mjs';
import {
  readProjectSessionCache,
  clearProjectSessionCache,
  getProjectCachePath,
  resolveHomeDir,
} from '../cache.mjs';
import { detectActiveHookMode } from './context.mjs';

export const SUPPORTED_PROVIDERS = ['claude', 'codex', 'cursor', 'copilot', 'jetski'];

const HOOKS_USAGE = `Usage: android-ux hooks <status|on|off|reset> [options]

Inspect or toggle non-blocking Android UX context hooks.

Subcommands:
  status [--json]
      Show hook enablement (.android-ux/config*.json), active harness manifests, and OS session cache count.

  on [--local|--shared] [--providers <list>] [--scope project|global] [--json]
      Re-enable hooks in config and wire hook manifests for installed/selected providers.

  off [--local|--shared] [--json]
      Disable hooks for this repo (defaults to --local via .android-ux/config.local.json + <gitdir>/info/exclude).

  reset [--json]
      Clear OS user-cache session dedupe state for this project.
`;

export function resolveProviderPaths(provider, { cwd, scope = 'project', env = process.env, platform = process.platform }) {
  const baseRoot = scope === 'global'
    ? resolveHomeDir(env, platform)
    : path.resolve(cwd);

  if (!baseRoot) return null;

  switch (provider) {
    case 'claude': {
      const skillsDir = path.join(baseRoot, '.claude', 'skills');
      const manifestPath = scope === 'global'
        ? path.join(baseRoot, '.claude', 'settings.json')
        : path.join(baseRoot, '.claude', 'settings.local.json');
      const launcherPosix = scope === 'global'
        ? normalizePosixPath(path.join(skillsDir, 'animate-compose', 'scripts', 'android-ux'))
        : '.claude/skills/animate-compose/scripts/android-ux';
      return { provider, skillsDir, manifestPath, launcherPosix };
    }
    case 'codex': {
      const skillsDir = path.join(baseRoot, '.codex', 'skills');
      const manifestPath = path.join(baseRoot, '.codex', 'hooks.json');
      const launcherPosix = scope === 'global'
        ? normalizePosixPath(path.join(skillsDir, 'animate-compose', 'scripts', 'android-ux'))
        : '.codex/skills/animate-compose/scripts/android-ux';
      const launcherWin = scope === 'global'
        ? path.win32.join(skillsDir.replace(/\//g, '\\'), 'animate-compose', 'scripts', 'android-ux.cmd')
        : '.codex\\skills\\animate-compose\\scripts\\android-ux.cmd';
      return { provider, skillsDir, manifestPath, launcherPosix, launcherWin };
    }
    case 'cursor': {
      const skillsDir = path.join(baseRoot, '.cursor', 'skills');
      const manifestPath = path.join(baseRoot, '.cursor', 'hooks.json');
      const launcherPosix = scope === 'global'
        ? normalizePosixPath(path.join(skillsDir, 'animate-compose', 'scripts', 'android-ux'))
        : '.cursor/skills/animate-compose/scripts/android-ux';
      return { provider, skillsDir, manifestPath, launcherPosix };
    }
    case 'copilot': {
      if (scope === 'global') return null;
      const skillsDir = path.join(baseRoot, '.github', 'skills');
      const manifestPath = path.join(baseRoot, '.github', 'hooks', 'android-ux.json');
      const launcherPosix = '$(git rev-parse --show-toplevel)/.github/skills/animate-compose/scripts/android-ux';
      return { provider, skillsDir, manifestPath, launcherPosix };
    }
    case 'jetski': {
      const hasAgentsDir = scope === 'project' && fs.existsSync(path.join(baseRoot, '_agents'));
      const containerDir = hasAgentsDir
        ? path.join(baseRoot, '_agents')
        : path.join(baseRoot, '.gemini');
      const skillsDir = path.join(containerDir, 'skills');
      const manifestPath = path.join(containerDir, 'hooks.json');
      // Jetski runs hook commands with cwd = directory containing hooks.json
      const launcherPosix = './skills/animate-compose/scripts/android-ux';
      return { provider, skillsDir, manifestPath, launcherPosix };
    }
    default:
      return null;
  }
}

function posixSingleQuote(str) {
  return `'${String(str).replace(/'/g, "'\\''")}'`;
}

export function installProviderHookManifest(info) {
  if (!info || !info.manifestPath) return false;
  const existing = readExistingJsonObject(info.manifestPath);

  let next;
  if (info.provider === 'claude') {
    next = stripAndroidUxEntriesFromClaudeOrCodex(existing);
    next.hooks = next.hooks && typeof next.hooks === 'object' ? next.hooks : {};
    const quoted = posixSingleQuote(info.launcherPosix);
    const cmd = `[ ! -f ${quoted} ] || ${quoted} hook`;
    next.hooks.PostToolUse = [
      ...(Array.isArray(next.hooks.PostToolUse) ? next.hooks.PostToolUse : []),
      {
        matcher: 'Edit|Write|MultiEdit',
        hooks: [
          {
            type: 'command',
            command: cmd,
            timeout: 5,
            statusMessage: 'Checking Android UX changes',
          },
        ],
      },
    ];
    next.hooks.Stop = [
      ...(Array.isArray(next.hooks.Stop) ? next.hooks.Stop : []),
      {
        hooks: [
          {
            type: 'command',
            command: cmd,
            timeout: 15,
            statusMessage: 'Android UX turn check',
          },
        ],
      },
    ];
  } else if (info.provider === 'codex') {
    next = stripAndroidUxEntriesFromClaudeOrCodex(existing);
    next.hooks = next.hooks && typeof next.hooks === 'object' ? next.hooks : {};
    const quoted = posixSingleQuote(info.launcherPosix);
    const cmd = `[ ! -f ${quoted} ] || ANDROID_UX_HOOK_HARNESS=codex ${quoted} hook`;
    const winSafe = String(info.launcherWin || '').replace(/"/g, '');
    const cmdWin = `cmd /c if exist "${winSafe}" set ANDROID_UX_HOOK_HARNESS=codex&& "${winSafe}" hook`;
    next.hooks.PostToolUse = [
      ...(Array.isArray(next.hooks.PostToolUse) ? next.hooks.PostToolUse : []),
      {
        matcher: 'Edit|Write|apply_patch',
        hooks: [
          {
            type: 'command',
            command: cmd,
            commandWindows: cmdWin,
            timeout: 5,
            statusMessage: 'Checking Android UX changes',
          },
        ],
      },
    ];
    next.hooks.Stop = [
      ...(Array.isArray(next.hooks.Stop) ? next.hooks.Stop : []),
      {
        hooks: [
          {
            type: 'command',
            command: cmd,
            commandWindows: cmdWin,
            timeout: 15,
            statusMessage: 'Android UX turn check',
          },
        ],
      },
    ];
  } else if (info.provider === 'cursor') {
    next = { version: 1, ...existing };
    next.hooks = next.hooks && typeof next.hooks === 'object' ? { ...next.hooks } : {};
    for (const [k, list] of Object.entries(next.hooks)) {
      if (Array.isArray(list)) {
        next.hooks[k] = list.filter((h) => !String(h?.command || '').includes('android-ux'));
        if (next.hooks[k].length === 0) delete next.hooks[k];
      }
    }
    const quoted = posixSingleQuote(info.launcherPosix);
    const cmd = `[ ! -f ${quoted} ] || ${quoted} hook`;
    next.hooks.postToolUse = [
      ...(Array.isArray(next.hooks.postToolUse) ? next.hooks.postToolUse : []),
      {
        command: cmd,
        matcher: '^Write$',
        timeout: 5,
      },
    ];
  } else if (info.provider === 'copilot') {
    const bashCmd = `[ ! -f "${info.launcherPosix}" ] || "${info.launcherPosix}" hook`;
    next = {
      version: 1,
      hooks: {
        postToolUse: [
          {
            type: 'command',
            matcher: 'edit|create|apply_patch',
            bash: bashCmd,
            timeoutSec: 5,
          },
        ],
      },
    };
  } else if (info.provider === 'jetski') {
    next = { ...existing };
    const jetskiCmd = `"${info.launcherPosix}" hook || "skills\\animate-compose\\scripts\\android-ux.cmd" hook || echo {}`;
    next['android-ux'] = {
      PostToolUse: [
        {
          matcher: 'write_file|edit_file|notebook_edit',
          hooks: [
            {
              type: 'command',
              command: jetskiCmd,
              timeout: 10,
            },
          ],
        },
      ],
      PreInvocation: [
        {
          type: 'command',
          command: jetskiCmd,
          timeout: 10,
        },
      ],
    };
  } else {
    return false;
  }

  fs.mkdirSync(path.dirname(info.manifestPath), { recursive: true });
  fs.writeFileSync(info.manifestPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return true;
}

function readExistingJsonObject(filePath) {
  if (!fs.existsSync(filePath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function stripAndroidUxEntriesFromClaudeOrCodex(obj) {
  const clone = JSON.parse(JSON.stringify(obj || {}));
  if (!clone.hooks || typeof clone.hooks !== 'object') return clone;
  for (const [evt, entries] of Object.entries(clone.hooks)) {
    if (!Array.isArray(entries)) continue;
    clone.hooks[evt] = entries
      .map((entry) => {
        if (Array.isArray(entry?.hooks)) {
          const kept = entry.hooks.filter((h) => !String(h?.command || '').includes('android-ux'));
          return kept.length > 0 ? { ...entry, hooks: kept } : null;
        }
        return String(entry?.command || '').includes('android-ux') ? null : entry;
      })
      .filter(Boolean);
    if (clone.hooks[evt].length === 0) delete clone.hooks[evt];
  }
  return clone;
}

export async function runHooksCommand(rawArgs, io = defaultIo()) {
  const args = [...rawArgs];
  if (args[0] === 'hooks') args.shift();

  if (args.includes('--help') || args.includes('-h')) {
    io.stdout.write(HOOKS_USAGE);
    return 0;
  }

  const sub = args[0] && !args[0].startsWith('--') ? args.shift().toLowerCase() : 'status';
  if (!['status', 'on', 'off', 'reset'].includes(sub)) {
    io.stderr.write(`Error: unknown hooks subcommand "${sub}". Valid: status, on, off, reset\n`);
    return 1;
  }

  if (sub === 'status') return handleHooksStatus(args, io);
  if (sub === 'on') return handleHooksToggle(args, io, true);
  if (sub === 'off') return handleHooksToggle(args, io, false);
  return handleHooksReset(args, io);
}

function handleHooksStatus(args, io) {
  const json = args.includes('--json');
  const cfg = readProjectConfig(io.cwd);
  const mode = detectActiveHookMode(io.cwd, io.env);
  const cache = readProjectSessionCache(io.cwd, io.env, io.platform || process.platform);
  const activeSessions = Object.keys(cache.sessions || {}).length;
  const cachePath = getProjectCachePath(io.cwd, io.env, io.platform || process.platform);

  const statusObj = {
    enabledInConfig: cfg.hook.enabled !== false,
    quiet: cfg.hook.quiet === true,
    perEditRules: cfg.hook.perEditRules,
    active: mode.active,
    reason: mode.reason,
    manifests: mode.manifests,
    sessionCache: {
      path: cachePath,
      activeSessions,
    },
  };

  if (json) {
    io.stdout.write(`${JSON.stringify(createJsonEnvelope('hooks.status', statusObj), null, 2)}\n`);
    return 0;
  }

  io.stdout.write(
    [
      `Hooks: ${statusObj.active ? 'active' : 'inactive'} (${statusObj.reason})`,
      `Config enabled: ${statusObj.enabledInConfig} (perEditRules=${statusObj.perEditRules}, quiet=${statusObj.quiet})`,
      `Manifests: ${statusObj.manifests.length > 0 ? statusObj.manifests.join(', ') : '(none)'}`,
      `Session cache: ${activeSessions} session(s) in ${cachePath || '(unavailable)'}`,
    ].join('\n') + '\n'
  );
  return 0;
}

function handleHooksToggle(args, io, enable) {
  let json = false;
  let local = true;
  let scope = 'project';
  const requestedProviders = [];

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--json') json = true;
    else if (a === '--shared') local = false;
    else if (a === '--local') local = true;
    else if (a === '--scope' || a.startsWith('--scope=')) {
      const v = a.includes('=') ? a.slice('--scope='.length) : args[++i];
      if (!['project', 'global'].includes(v)) {
        io.stderr.write('Error: --scope must be project or global\n');
        return 1;
      }
      scope = v;
    } else if (a === '--providers' || a.startsWith('--providers=')) {
      const v = a.includes('=') ? a.slice('--providers='.length) : args[++i];
      for (const p of String(v || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) {
        if (!SUPPORTED_PROVIDERS.includes(p)) {
          io.stderr.write(`Error: unknown provider "${p}". Valid: ${SUPPORTED_PROVIDERS.join(', ')}\n`);
          return 1;
        }
        requestedProviders.push(p);
      }
    } else {
      io.stderr.write(`Error: unknown hooks option "${a}"\n`);
      return 1;
    }
  }

  const targetCfgPath = local ? getLocalConfigPath(io.cwd) : getSharedConfigPath(io.cwd);
  const rawObj = readEditableConfigObject(io.cwd, { local });

  if (!enable) {
    rawObj.hook = { ...(rawObj.hook || {}), enabled: false };
    writeConfigObject(io.cwd, rawObj, { local });
    if (json) {
      io.stdout.write(`${JSON.stringify(createJsonEnvelope('hooks.off', {
        enabled: false,
        configFile: normalizePosixPath(path.relative(io.cwd, targetCfgPath)),
      }), null, 2)}\n`);
    } else {
      io.stdout.write(`Disabled Android UX hooks in ${normalizePosixPath(path.relative(io.cwd, targetCfgPath))}.\n`);
    }
    return 0;
  }

  // Re-enabling: update config if `enabled: false` was set in either shared or local
  for (const isLoc of [true, false]) {
    const p = isLoc ? getLocalConfigPath(io.cwd) : getSharedConfigPath(io.cwd);
    if (!fs.existsSync(p)) continue;
    const editable = readEditableConfigObject(io.cwd, { local: isLoc });
    if (editable.hook && editable.hook.enabled === false) {
      editable.hook.enabled = true;
      writeConfigObject(io.cwd, editable, { local: isLoc });
    }
  }

  // Wire manifests for explicitly requested providers or providers whose skill bundle is already installed
  const providersToWire = requestedProviders.length > 0
    ? requestedProviders
    : SUPPORTED_PROVIDERS.filter((prov) => {
        const info = resolveProviderPaths(prov, { cwd: io.cwd, scope, env: io.env, platform: io.platform || process.platform });
        return info && fs.existsSync(path.join(info.skillsDir, 'animate-compose'));
      });

  const wiredManifests = [];
  for (const prov of providersToWire) {
    const info = resolveProviderPaths(prov, { cwd: io.cwd, scope, env: io.env, platform: io.platform || process.platform });
    if (info && installProviderHookManifest(info)) {
      wiredManifests.push(normalizePosixPath(path.relative(io.cwd, info.manifestPath) || info.manifestPath));
    }
  }

  if (json) {
    io.stdout.write(`${JSON.stringify(createJsonEnvelope('hooks.on', {
      enabled: true,
      wiredManifests,
    }), null, 2)}\n`);
  } else {
    io.stdout.write(
      wiredManifests.length > 0
        ? `Enabled Android UX hooks and updated manifests: ${wiredManifests.join(', ')}\n`
        : 'Enabled Android UX hooks (run `npx android-ux install` to install skill bundles + harness manifests).\n'
    );
  }
  return 0;
}

function handleHooksReset(args, io) {
  const json = args.includes('--json');
  const cleared = clearProjectSessionCache(io.cwd, io.env, io.platform || process.platform);
  if (json) {
    io.stdout.write(`${JSON.stringify(createJsonEnvelope('hooks.reset', { cleared }), null, 2)}\n`);
  } else {
    io.stdout.write(cleared ? 'Cleared session hook cache for this project.\n' : 'Session hook cache was already empty.\n');
  }
  return 0;
}

function defaultIo() {
  return {
    cwd: process.cwd(),
    env: process.env,
    stdout: process.stdout,
    stderr: process.stderr,
  };
}
