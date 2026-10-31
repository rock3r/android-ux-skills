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

export const OWNED_SKILL_PREFERENCE = [
  'animate-compose',
  'review-android-motion',
  'improve-android-motion',
  'optimize-android-motion',
];

const HOOKS_USAGE = `Usage: android-ux hooks <status|on|off|install|uninstall|reset> [options]

Inspect, wire, or toggle non-blocking Android UX context hooks.

Subcommands:
  status [--json]
      Show hook enablement (.android-ux/config*.json), active harness manifests, and OS session cache count.

  on | install [--local|--shared] [--providers <list>] [--scope project|global] [--json]
      Enable hooks in config and wire hook manifests for installed/selected providers.

  off [--local|--shared] [--json]
      Disable hooks for this repo (defaults to --local via .android-ux/config.local.json + <gitdir>/info/exclude).

  uninstall [--providers <list>] [--scope project|global] [--json]
      Remove Android UX hook entries from harness manifests while preserving unrelated user hooks and settings.

  reset [--json]
      Clear OS user-cache session dedupe state for this project.
`;

function selectProviderLauncherSkill(skillsDir, preferredSkills = null) {
  if (Array.isArray(preferredSkills) && preferredSkills.length > 0) {
    const preferredSet = new Set(preferredSkills);
    const orderedHit = OWNED_SKILL_PREFERENCE.find((s) => preferredSet.has(s));
    return orderedHit || preferredSkills[0];
  }
  for (const s of OWNED_SKILL_PREFERENCE) {
    if (
      fs.existsSync(path.join(skillsDir, s, 'scripts', 'android-ux')) ||
      fs.existsSync(path.join(skillsDir, s, 'scripts', 'android-ux.mjs'))
    ) {
      return s;
    }
  }
  for (const s of OWNED_SKILL_PREFERENCE) {
    if (fs.existsSync(path.join(skillsDir, s))) {
      return s;
    }
  }
  return OWNED_SKILL_PREFERENCE[0];
}

export function resolveProviderPaths(
  provider,
  { cwd, scope = 'project', env = process.env, platform = process.platform, preferredSkills = null }
) {
  const baseRoot = scope === 'global'
    ? resolveHomeDir(env, platform)
    : path.resolve(cwd);

  if (!baseRoot) return null;

  switch (provider) {
    case 'claude': {
      const skillsDir = path.join(baseRoot, '.claude', 'skills');
      const launcherSkill = selectProviderLauncherSkill(skillsDir, preferredSkills);
      const manifestPath = scope === 'global'
        ? path.join(baseRoot, '.claude', 'settings.json')
        : path.join(baseRoot, '.claude', 'settings.local.json');
      const launcherPosix = scope === 'global'
        ? normalizePosixPath(path.join(skillsDir, launcherSkill, 'scripts', 'android-ux'))
        : `.claude/skills/${launcherSkill}/scripts/android-ux`;
      return { provider, skillsDir, manifestPath, launcherSkill, launcherPosix };
    }
    case 'codex': {
      const skillsDir = path.join(baseRoot, '.codex', 'skills');
      const launcherSkill = selectProviderLauncherSkill(skillsDir, preferredSkills);
      const manifestPath = path.join(baseRoot, '.codex', 'hooks.json');
      const launcherPosix = scope === 'global'
        ? normalizePosixPath(path.join(skillsDir, launcherSkill, 'scripts', 'android-ux'))
        : `.codex/skills/${launcherSkill}/scripts/android-ux`;
      const launcherWin = scope === 'global'
        ? path.win32.join(skillsDir.replace(/\//g, '\\'), launcherSkill, 'scripts', 'android-ux.cmd')
        : `.codex\\skills\\${launcherSkill}\\scripts\\android-ux.cmd`;
      return { provider, skillsDir, manifestPath, launcherSkill, launcherPosix, launcherWin };
    }
    case 'cursor': {
      const skillsDir = path.join(baseRoot, '.cursor', 'skills');
      const launcherSkill = selectProviderLauncherSkill(skillsDir, preferredSkills);
      const manifestPath = path.join(baseRoot, '.cursor', 'hooks.json');
      const launcherPosix = scope === 'global'
        ? normalizePosixPath(path.join(skillsDir, launcherSkill, 'scripts', 'android-ux'))
        : `.cursor/skills/${launcherSkill}/scripts/android-ux`;
      return { provider, skillsDir, manifestPath, launcherSkill, launcherPosix };
    }
    case 'copilot': {
      if (scope === 'global') return null;
      const skillsDir = path.join(baseRoot, '.github', 'skills');
      const launcherSkill = selectProviderLauncherSkill(skillsDir, preferredSkills);
      const manifestPath = path.join(baseRoot, '.github', 'hooks', 'android-ux.json');
      const launcherPosix = `$(git rev-parse --show-toplevel)/.github/skills/${launcherSkill}/scripts/android-ux`;
      return { provider, skillsDir, manifestPath, launcherSkill, launcherPosix };
    }
    case 'jetski': {
      const hasAgentsDir = scope === 'project' && fs.existsSync(path.join(baseRoot, '_agents'));
      const containerDir = hasAgentsDir
        ? path.join(baseRoot, '_agents')
        : path.join(baseRoot, '.gemini');
      const skillsDir = path.join(containerDir, 'skills');
      const launcherSkill = selectProviderLauncherSkill(skillsDir, preferredSkills);
      const manifestPath = path.join(containerDir, 'hooks.json');
      // Jetski runs hook commands with cwd = directory containing hooks.json
      const launcherPosix = `./skills/${launcherSkill}/scripts/android-ux`;
      return { provider, skillsDir, manifestPath, launcherSkill, launcherPosix };
    }
    default:
      return null;
  }
}

function posixSingleQuote(str) {
  return `'${String(str).replace(/'/g, "'\\''")}'`;
}

function formatCopilotBashLauncher(launcherPosix) {
  const prefix = '$(git rev-parse --show-toplevel)/';
  const raw = String(launcherPosix || '');
  if (raw.startsWith(prefix)) {
    const suffix = raw.slice(prefix.length).replace(/[\\"`$]/g, '\\$&');
    return `"${prefix}${suffix}"`;
  }
  return posixSingleQuote(raw);
}

function validateExistingProviderManifest(provider, existing, filePath, verb = 'overwrite') {
  if (!provider || !existing || typeof existing !== 'object') return;
  if (provider === 'claude' || provider === 'codex' || provider === 'cursor' || provider === 'copilot') {
    if (
      existing.hooks !== undefined &&
      (!existing.hooks || typeof existing.hooks !== 'object' || Array.isArray(existing.hooks))
    ) {
      throw new Error(`Refusing to ${verb} manifest "${filePath}": "hooks" field must be a JSON object.`);
    }
    if (existing.hooks && verb === 'overwrite') {
      const requiredArrayKeys = (provider === 'claude' || provider === 'codex')
        ? ['PostToolUse', 'Stop']
        : ['postToolUse'];
      for (const key of requiredArrayKeys) {
        if (existing.hooks[key] !== undefined && !Array.isArray(existing.hooks[key])) {
          throw new Error(`Refusing to ${verb} manifest "${filePath}": "hooks.${key}" must be a JSON array.`);
        }
      }
    }
  }
}

export function installProviderHookManifest(info) {
  if (!info || !info.manifestPath) return false;
  const existing = readExistingJsonObject(info.manifestPath, info.provider);

  let next;
  if (info.provider === 'claude') {
    next = stripAndroidUxEntriesFromClaudeOrCodex(existing).next;
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
    next = stripAndroidUxEntriesFromClaudeOrCodex(existing).next;
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
    next.hooks = next.hooks && typeof next.hooks === 'object' && !Array.isArray(next.hooks)
      ? { ...next.hooks }
      : {};
    for (const [k, list] of Object.entries(next.hooks)) {
      if (Array.isArray(list)) {
        const hadAndroidUx = list.some((h) => String(h?.command || '').includes('android-ux'));
        const kept = list.filter((h) => !String(h?.command || '').includes('android-ux'));
        if (kept.length === 0 && hadAndroidUx) {
          delete next.hooks[k];
        } else {
          next.hooks[k] = kept;
        }
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
    next = { version: 1, ...existing };
    next.hooks = next.hooks && typeof next.hooks === 'object' && !Array.isArray(next.hooks)
      ? { ...next.hooks }
      : {};
    for (const [k, list] of Object.entries(next.hooks)) {
      if (Array.isArray(list)) {
        const hadAndroidUx = list.some((h) =>
          String(h?.bash || h?.powershell || h?.command || '').includes('android-ux')
        );
        const kept = list.filter(
          (h) => !String(h?.bash || h?.powershell || h?.command || '').includes('android-ux')
        );
        if (kept.length === 0 && hadAndroidUx) {
          delete next.hooks[k];
        } else {
          next.hooks[k] = kept;
        }
      }
    }
    const quotedLauncher = formatCopilotBashLauncher(info.launcherPosix);
    const bashCmd = `[ ! -f ${quotedLauncher} ] || ${quotedLauncher} hook`;
    next.hooks.postToolUse = [
      ...(Array.isArray(next.hooks.postToolUse) ? next.hooks.postToolUse : []),
      {
        type: 'command',
        matcher: 'edit|create|apply_patch',
        bash: bashCmd,
        timeoutSec: 5,
      },
    ];
  } else if (info.provider === 'jetski') {
    next = { ...existing };
    const winSkill = info.launcherSkill || OWNED_SKILL_PREFERENCE[0];
    const jetskiCmd = `"${info.launcherPosix}" hook || "skills\\${winSkill}\\scripts\\android-ux.cmd" hook || echo {}`;
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

export function readExistingJsonObject(filePath, provider = null) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return {};
    throw new Error(`Refusing to overwrite unreadable manifest "${filePath}": ${err?.message || String(err)}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Refusing to overwrite malformed JSON manifest "${filePath}": ${err?.message || String(err)}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Refusing to overwrite manifest "${filePath}": top-level JSON value must be an object.`);
  }
  validateExistingProviderManifest(provider, parsed, filePath, 'overwrite');
  return parsed;
}

export function uninstallProviderHooks(info) {
  if (!info || !info.manifestPath) return false;
  let raw;
  try {
    raw = fs.readFileSync(info.manifestPath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return false;
    throw new Error(`Refusing to modify unreadable manifest "${info.manifestPath}": ${err?.message || String(err)}`);
  }

  let existing;
  try {
    existing = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Refusing to modify malformed JSON manifest "${info.manifestPath}": ${err?.message || String(err)}`);
  }

  if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
    throw new Error(`Refusing to modify manifest "${info.manifestPath}": top-level JSON value must be an object.`);
  }
  validateExistingProviderManifest(info.provider, existing, info.manifestPath, 'modify');

  let next;
  if (info.provider === 'claude' || info.provider === 'codex') {
    const stripped = stripAndroidUxEntriesFromClaudeOrCodex(existing);
    next = stripped.next;
    if (stripped.hadRemoved && next.hooks && typeof next.hooks === 'object' && Object.keys(next.hooks).length === 0) {
      delete next.hooks;
    }
  } else if (info.provider === 'cursor') {
    next = { ...existing };
    let hadRemoved = false;
    if (next.hooks && typeof next.hooks === 'object' && !Array.isArray(next.hooks)) {
      next.hooks = { ...next.hooks };
      for (const [k, list] of Object.entries(next.hooks)) {
        if (Array.isArray(list)) {
          const hadAndroidUx = list.some((h) => String(h?.command || '').includes('android-ux'));
          const kept = list.filter((h) => !String(h?.command || '').includes('android-ux'));
          if (hadAndroidUx) {
            hadRemoved = true;
            if (kept.length === 0) delete next.hooks[k];
            else next.hooks[k] = kept;
          }
        }
      }
      if (hadRemoved && Object.keys(next.hooks).length === 0) delete next.hooks;
    }
  } else if (info.provider === 'copilot') {
    next = { ...existing };
    let hadRemoved = false;
    if (next.hooks && typeof next.hooks === 'object' && !Array.isArray(next.hooks)) {
      next.hooks = { ...next.hooks };
      for (const [k, list] of Object.entries(next.hooks)) {
        if (Array.isArray(list)) {
          const hadAndroidUx = list.some((h) =>
            String(h?.bash || h?.powershell || h?.command || '').includes('android-ux')
          );
          const kept = list.filter(
            (h) => !String(h?.bash || h?.powershell || h?.command || '').includes('android-ux')
          );
          if (hadAndroidUx) {
            hadRemoved = true;
            if (kept.length === 0) delete next.hooks[k];
            else next.hooks[k] = kept;
          }
        }
      }
      if (hadRemoved && Object.keys(next.hooks).length === 0) delete next.hooks;
    }
    const remainingKeys = Object.keys(next).filter((k) => k !== 'version');
    if (hadRemoved && remainingKeys.length === 0) {
      fs.unlinkSync(info.manifestPath);
      return true;
    }
  } else if (info.provider === 'jetski') {
    if (!Object.prototype.hasOwnProperty.call(existing, 'android-ux')) return false;
    next = { ...existing };
    delete next['android-ux'];
  } else {
    return false;
  }

  const serialized = `${JSON.stringify(next, null, 2)}\n`;
  if (serialized === `${JSON.stringify(existing, null, 2)}\n`) {
    return false;
  }
  fs.writeFileSync(info.manifestPath, serialized, 'utf8');
  return true;
}

function stripAndroidUxEntriesFromClaudeOrCodex(obj) {
  const clone = JSON.parse(JSON.stringify(obj || {}));
  let hadRemoved = false;
  if (!clone.hooks || typeof clone.hooks !== 'object' || Array.isArray(clone.hooks)) {
    return { next: clone, hadRemoved };
  }
  for (const [evt, entries] of Object.entries(clone.hooks)) {
    if (!Array.isArray(entries)) continue;
    let evtRemoved = false;
    clone.hooks[evt] = entries
      .map((entry) => {
        if (Array.isArray(entry?.hooks)) {
          const kept = entry.hooks.filter((h) => !String(h?.command || '').includes('android-ux'));
          if (kept.length !== entry.hooks.length) {
            evtRemoved = true;
            hadRemoved = true;
          }
          return kept.length > 0 ? { ...entry, hooks: kept } : null;
        }
        if (String(entry?.command || '').includes('android-ux')) {
          evtRemoved = true;
          hadRemoved = true;
          return null;
        }
        return entry;
      })
      .filter(Boolean);
    if (evtRemoved && clone.hooks[evt].length === 0) delete clone.hooks[evt];
  }
  return { next: clone, hadRemoved };
}

export async function runHooksCommand(rawArgs, io = defaultIo()) {
  const args = [...rawArgs];
  if (args[0] === 'hooks') args.shift();

  if (args.includes('--help') || args.includes('-h')) {
    io.stdout.write(HOOKS_USAGE);
    return 0;
  }

  const sub = args[0] && !args[0].startsWith('--') ? args.shift().toLowerCase() : 'status';
  if (!['status', 'on', 'off', 'install', 'uninstall', 'reset'].includes(sub)) {
    io.stderr.write(`Error: unknown hooks subcommand "${sub}". Valid: status, on, off, install, uninstall, reset\n`);
    return 1;
  }

  if (sub === 'status') return handleHooksStatus(args, io);
  if (sub === 'on' || sub === 'install') return handleHooksToggle(args, io, true);
  if (sub === 'off') return handleHooksToggle(args, io, false);
  if (sub === 'uninstall') return handleHooksUninstall(args, io);
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
        if (p === 'all') {
          for (const sp of SUPPORTED_PROVIDERS) {
            if (!requestedProviders.includes(sp)) requestedProviders.push(sp);
          }
          continue;
        }
        if (!SUPPORTED_PROVIDERS.includes(p)) {
          io.stderr.write(`Error: unknown provider "${p}". Valid: all, ${SUPPORTED_PROVIDERS.join(', ')}\n`);
          return 1;
        }
        if (!requestedProviders.includes(p)) requestedProviders.push(p);
      }
    } else {
      io.stderr.write(`Error: unknown hooks option "${a}"\n`);
      return 1;
    }
  }

  try {
    const targetCfgPath = local ? getLocalConfigPath(io.cwd) : getSharedConfigPath(io.cwd);

    if (!enable) {
      const rawObj = readEditableConfigObject(io.cwd, { local });
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

    // Wire manifests for explicitly requested providers or providers whose skill bundle is already installed
    const providersToWire = requestedProviders.length > 0
      ? requestedProviders
      : SUPPORTED_PROVIDERS.filter((prov) => {
          const info = resolveProviderPaths(prov, { cwd: io.cwd, scope, env: io.env, platform: io.platform || process.platform });
          return info && OWNED_SKILL_PREFERENCE.some((s) => fs.existsSync(path.join(info.skillsDir, s)));
        });

    // Pre-validate existing manifests before mutating config or writing manifests
    const resolvedTargets = [];
    for (const prov of providersToWire) {
      const info = resolveProviderPaths(prov, { cwd: io.cwd, scope, env: io.env, platform: io.platform || process.platform });
      if (info) {
        readExistingJsonObject(info.manifestPath, info.provider);
        resolvedTargets.push(info);
      }
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

    const wiredManifests = [];
    for (const info of resolvedTargets) {
      if (installProviderHookManifest(info)) {
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
  } catch (err) {
    io.stderr.write(`Error: ${err?.message || String(err)}\n`);
    return 1;
  }
}

function handleHooksUninstall(args, io) {
  let json = false;
  let scope = 'project';
  const requestedProviders = [];

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--json') json = true;
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
        if (p === 'all') {
          for (const sp of SUPPORTED_PROVIDERS) {
            if (!requestedProviders.includes(sp)) requestedProviders.push(sp);
          }
          continue;
        }
        if (!SUPPORTED_PROVIDERS.includes(p)) {
          io.stderr.write(`Error: unknown provider "${p}". Valid: all, ${SUPPORTED_PROVIDERS.join(', ')}\n`);
          return 1;
        }
        if (!requestedProviders.includes(p)) requestedProviders.push(p);
      }
    } else {
      io.stderr.write(`Error: unknown hooks uninstall option "${a}"\n`);
      return 1;
    }
  }

  const providers = requestedProviders.length > 0 ? requestedProviders : SUPPORTED_PROVIDERS;
  try {
    const targets = [];
    for (const prov of providers) {
      const info = resolveProviderPaths(prov, { cwd: io.cwd, scope, env: io.env, platform: io.platform || process.platform });
      if (info && fs.existsSync(info.manifestPath)) {
        readExistingJsonObject(info.manifestPath, info.provider);
        targets.push(info);
      }
    }

    const removedManifests = [];
    for (const info of targets) {
      if (uninstallProviderHooks(info)) {
        removedManifests.push(normalizePosixPath(path.relative(io.cwd, info.manifestPath) || info.manifestPath));
      }
    }

    if (json) {
      io.stdout.write(`${JSON.stringify(createJsonEnvelope('hooks.uninstall', { removedManifests }), null, 2)}\n`);
    } else {
      io.stdout.write(
        removedManifests.length > 0
          ? `Removed Android UX hooks from: ${removedManifests.join(', ')}\n`
          : 'No Android UX hook entries found to remove.\n'
      );
    }
    return 0;
  } catch (err) {
    io.stderr.write(`Error: ${err?.message || String(err)}\n`);
    return 1;
  }
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
