import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDiagnostic, formatDiagnosticText, createJsonEnvelope } from '../diagnostics.mjs';
import { resolveUserCacheDir, resolveHomeDir } from '../cache.mjs';
import { readProjectConfig, normalizePosixPath } from '../config.mjs';
import { parseMotionMd } from '../scanner/motion-md.mjs';
import { resolveTraceProcessor } from './trace.mjs';
import { runStaticScan, walkScannableFiles } from './detect.mjs';
import { pruneStaleWaivers } from './ignores.mjs';
import { collectEnabledHookCommands, extractLocalHookLauncherInfo } from './context.mjs';

const VALID_FEATURES = new Set(['all', 'detect', 'trace', 'hooks', 'capture']);

const DOCTOR_USAGE = `Usage: android-ux doctor [options]

Inspect OS/arch, Node >=20 runtime & hook /bin/sh visibility, modern android CLI,
Android SDK & adb, Perfetto trace_processor_shell (v58+), ImageMagick, ffmpeg/ffprobe,
MOTION.md git/symbol drift, .android-ux/config*.json waiver freshness, and hook manifests.

Options:
  --for <feature>          Require checks needed for: all, detect, trace, hooks, capture
                           (comma-separated; default treats optional tools as info)
  --trace-processor <path> Explicit path to trace_processor_shell when probing trace readiness
  --fix                    Repair safe mechanical drift (prune proven-unused/expired waivers,
                           remove broken android-ux hook entries, clear stale node-unsupported marker)
  --json                   Emit a single JSON document on stdout
  --help, -h               Show this help message

Exit codes:
  0  Healthy (missing optional tools are reported with install commands without failing)
  1  A check required by --for <feature> (or malformed config) failed
`;

const FRAMEWORK_MOTION_IDENTIFIERS = new Set([
  'MaterialTheme',
  'motionScheme',
  'defaultEffectsSpec',
  'fastEffectsSpec',
  'slowEffectsSpec',
  'defaultSpatialSpec',
  'fastSpatialSpec',
  'slowSpatialSpec',
  'tween',
  'spring',
  'keyframes',
  'snap',
  'EnterTransition',
  'ExitTransition',
  'None',
  'fadeIn',
  'fadeOut',
  'slideInHorizontally',
  'slideOutHorizontally',
  'slideInVertically',
  'slideOutVertically',
  'scaleIn',
  'scaleOut',
  'expandVertically',
  'shrinkVertically',
  'NavHost',
  'NavDisplay',
  'AnimatedVisibility',
  'AnimatedContent',
  'Crossfade',
  'Modifier',
  'animateContentSize',
  'animateItem',
  'DECIDED',
  'OBSERVED',
  'OPEN',
]);

export function detectHostProfile({
  platform = process.platform,
  arch = process.arch,
  env = process.env,
  readFile = (p) => fs.readFileSync(p, 'utf8'),
  exists = (p) => fs.existsSync(p),
  which = null,
} = {}) {
  const resolveBin = which || ((bin) => findBinaryOnPath(bin, env, platform, exists));
  let linuxDistro = null;
  if (platform === 'linux' && exists('/etc/os-release')) {
    try {
      const osRel = readFile('/etc/os-release');
      const idMatch = osRel.match(/^ID=["']?([a-zA-Z0-9._-]+)["']?/m);
      const likeMatch = osRel.match(/^ID_LIKE=["']?([^\r\n"']+)["']?/m);
      linuxDistro = {
        id: idMatch ? idMatch[1].toLowerCase() : 'linux',
        idLike: likeMatch ? likeMatch[1].toLowerCase() : '',
      };
    } catch {
      linuxDistro = { id: 'linux', idLike: '' };
    }
  }

  const packageManagers = [];
  for (const pm of ['brew', 'winget', 'scoop', 'apt', 'dnf', 'pacman', 'sdkmanager', 'android']) {
    if (resolveBin(pm)) packageManagers.push(pm);
  }

  const normalizedArch = arch === 'arm64' ? 'arm64' : 'x86_64';
  return {
    platform,
    arch,
    normalizedArch,
    linuxDistro,
    packageManagers,
  };
}

export function findBinaryOnPath(binName, env = process.env, platform = process.platform, exists = (p) => fs.existsSync(p)) {
  const pathSep = platform === 'win32' ? ';' : ':';
  const dirs = String(env.PATH || '').split(pathSep).filter(Boolean);
  if (platform === 'win32') {
    const home = env.USERPROFILE || env.HOME || '';
    const localAppData = env.LOCALAPPDATA || '';
    if (home) dirs.push(path.win32.join(home, 'scoop', 'shims'));
    if (localAppData) dirs.push(path.win32.join(localAppData, 'Microsoft', 'WinGet', 'Links'));
  }
  const exts = platform === 'win32'
    ? (/\.(exe|cmd|bat)$/i.test(binName) ? [''] : ['.exe', '.cmd', '.bat', ''])
    : [''];
  const joiner = platform === 'win32' ? path.win32.join : path.posix.join;

  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = joiner(dir, `${binName}${ext}`);
      try {
        if (exists(candidate)) return candidate;
      } catch {
        // Ignore unreadable dir.
      }
    }
  }
  return null;
}

function defaultExecProbe(cmd, args, { timeoutMs = 2000, env = process.env, cwd = process.cwd() } = {}) {
  const proc = spawnSync(cmd, args, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: timeoutMs,
    maxBuffer: 4 * 1024 * 1024,
  });
  return {
    error: proc.error || null,
    status: proc.status,
    stdout: proc.stdout || '',
    stderr: proc.stderr || '',
  };
}

function pickPkgInstallCommand(host, recipes) {
  const pms = new Set(host.packageManagers);
  if (host.platform === 'darwin') {
    if (pms.has('brew') && recipes.brew) return recipes.brew;
    return recipes.macosFallback || recipes.brew;
  }
  if (host.platform === 'win32') {
    if (pms.has('winget') && recipes.winget) return recipes.winget;
    if (pms.has('scoop') && recipes.scoop) return recipes.scoop;
    return recipes.windowsFallback || recipes.winget;
  }
  const distroStr = `${host.linuxDistro?.id || ''} ${host.linuxDistro?.idLike || ''}`;
  if ((pms.has('apt') || /\b(debian|ubuntu)\b/.test(distroStr)) && recipes.apt) return recipes.apt;
  if ((pms.has('dnf') || /\b(fedora|rhel|centos)\b/.test(distroStr)) && recipes.dnf) return recipes.dnf;
  if ((pms.has('pacman') || /\barch\b/.test(distroStr)) && recipes.pacman) return recipes.pacman;
  if (pms.has('brew') && recipes.brew) return recipes.brew;
  return recipes.linuxFallback || recipes.apt;
}

export function runDoctorChecks({
  cwd = process.cwd(),
  env = process.env,
  platform = process.platform,
  arch = process.arch,
  nodeVersion = process.versions.node,
  requiredFeatures = new Set(),
  fix = false,
  traceProcessorPath = null,
  execProbe = defaultExecProbe,
  exists = (p) => fs.existsSync(p),
  readFile = (p) => fs.readFileSync(p, 'utf8'),
} = {}) {
  const resolvedCwd = path.resolve(cwd);
  const host = detectHostProfile({ platform, arch, env, readFile, exists });
  const requireAll = requiredFeatures.has('all');
  const needTrace = requireAll || requiredFeatures.has('trace');
  const needHooks = requireAll || requiredFeatures.has('hooks');
  const needCapture = requireAll || requiredFeatures.has('capture');

  const checks = [];
  const fixesApplied = [];

  // 1. Node >= 20 & hook /bin/sh visibility
  {
    const major = Number(String(nodeVersion).split('.')[0] || 0);
    const cacheDir = resolveUserCacheDir(env, platform);
    const unsupportedStamp = cacheDir ? path.join(cacheDir, 'node-unsupported') : '';
    const hadUnsupportedStamp = Boolean(unsupportedStamp && exists(unsupportedStamp));

    let shNodeWarning = null;
    if (platform !== 'win32' && exists('/bin/sh')) {
      const shRes = execProbe('/bin/sh', ['-c', 'command -v node >/dev/null 2>&1 && node -p "parseInt(process.versions.node, 10)"'], { env, cwd: resolvedCwd });
      const shMajor = Number((shRes.stdout || '').trim());
      if (shRes.status !== 0 || !Number.isFinite(shMajor) || shMajor < 20) {
        shNodeWarning = 'Default `/bin/sh` PATH does not expose Node >= 20; GUI editor hooks rely on launcher fallback paths or `ANDROID_UX_NODE`.';
      }
    }

    if (fix && major >= 20 && hadUnsupportedStamp && !shNodeWarning) {
      try {
        fs.unlinkSync(unsupportedStamp);
        fixesApplied.push('Removed stale `node-unsupported` hook cache notice.');
      } catch {
        // Ignore cleanup failure.
      }
    }

    if (major < 20) {
      checks.push(createDiagnostic({
        code: 'AUX-ENV-002',
        severity: 'error',
        status: 'fail',
        summary: `Node.js v${nodeVersion} is unsupported (requires Node >= 20).`,
        impact: 'All `android-ux` CLI subcommands and hooks require Node >= 20.',
        remediation: pickPkgInstallCommand(host, {
          brew: 'brew install node',
          winget: 'winget install OpenJS.NodeJS.LTS',
          scoop: 'scoop install nodejs-lts',
          apt: 'Install Node >= 20 via fnm/nvm or NodeSource, or set ANDROID_UX_NODE=/abs/path/to/node',
          dnf: 'sudo dnf install nodejs',
          pacman: 'sudo pacman -S nodejs',
        }),
        extra: { id: 'node-runtime', required: true },
      }));
    } else if (shNodeWarning || hadUnsupportedStamp) {
      checks.push(createDiagnostic({
        code: 'AUX-ENV-003',
        severity: 'warning',
        status: 'warn',
        summary: `Node.js v${nodeVersion} active, with GUI hook PATH advisory.`,
        evidence: shNodeWarning || `Found prior hook fallback stamp at ${unsupportedStamp}.`,
        impact: 'CLI commands work; GUI IDE hooks without shell PATH inheritance should set `ANDROID_UX_NODE` if Node lives in a custom path.',
        remediation: `Set ANDROID_UX_NODE="${process.execPath}" in your IDE/hook environment (or run \`npx android-ux doctor --fix\` once resolved).`,
        extra: { id: 'node-runtime', required: needHooks },
      }));
    } else {
      checks.push({
        id: 'node-runtime',
        code: 'AUX-ENV-000',
        severity: 'info',
        status: 'pass',
        domain: 'core',
        required: true,
        summary: `Node.js v${nodeVersion} (${host.platform}/${host.arch}) satisfies >= 20.`,
      });
    }
  }

  // 2. Official `android` CLI (rejecting deprecated 2016 SDK `tools/android`)
  {
    const androidInstallCmd = host.platform === 'darwin'
      ? `curl -fsSL https://dl.google.com/android/cli/latest/darwin_${host.normalizedArch}/install.sh | bash`
      : host.platform === 'win32'
        ? 'curl -fsSL https://dl.google.com/android/cli/latest/windows_x86_64/install.cmd -o "%TEMP%\\android-cli-install.cmd" && "%TEMP%\\android-cli-install.cmd"'
        : `curl -fsSL https://dl.google.com/android/cli/latest/linux_${host.normalizedArch}/install.sh | bash`;

    const androidBin = findBinaryOnPath('android', env, platform, exists);
    if (!androidBin) {
      checks.push(createDiagnostic({
        code: 'AUX-ANDROID-001',
        severity: needCapture ? 'error' : 'info',
        status: needCapture ? 'fail' : 'info',
        summary: 'Modern `android` CLI is not installed on PATH.',
        searched: '$PATH (`android`)',
        impact: '`detect`, `context`, `ignores`, `hooks`, and `trace` still work offline. Live emulator/layout workflows require `android` CLI.',
        remediation: androidInstallCmd,
        extra: { id: 'android-cli', required: needCapture },
      }));
    } else {
      const verRes = execProbe(androidBin, ['--version'], { env, cwd: resolvedCwd });
      const combined = `${verRes.stdout}\n${verRes.stderr}`;
      if (/The android command is no longer available/i.test(combined) || /android\.bat/i.test(combined) && /deprecated/i.test(combined)) {
        checks.push(createDiagnostic({
          code: 'AUX-ANDROID-002',
          severity: needCapture ? 'error' : 'warning',
          status: needCapture ? 'fail' : 'warn',
          summary: `\`android\` on PATH points to deprecated legacy SDK \`tools/android\` (${androidBin}).`,
          evidence: combined.trim().split('\n')[0] || androidBin,
          impact: '`detect`, `context`, and `trace` still work, but `android` CLI device/SDK commands will fail.',
          remediation: [
            'Remove legacy `<SDK>/tools` from PATH (keep `<SDK>/platform-tools` and `<SDK>/cmdline-tools/latest/bin`), then install the modern `android` CLI:',
            `  ${androidInstallCmd}`,
          ],
          extra: { id: 'android-cli', required: needCapture },
        }));
      } else if (verRes.error || verRes.status !== 0) {
        checks.push(createDiagnostic({
          code: 'AUX-ANDROID-003',
          severity: needCapture ? 'error' : 'warning',
          status: needCapture ? 'fail' : 'warn',
          summary: `\`android --version\` failed (${androidBin}).`,
          evidence: (verRes.stderr || verRes.stdout || verRes.error?.message || `exit ${verRes.status}`).trim().slice(0, 200),
          impact: '`detect`, `context`, and `trace` still work offline.',
          remediation: androidInstallCmd,
          extra: { id: 'android-cli', required: needCapture },
        }));
      } else {
        const verLine = (verRes.stdout || verRes.stderr).trim().split('\n')[0] || 'installed';
        checks.push({
          id: 'android-cli',
          code: 'AUX-ANDROID-000',
          severity: 'info',
          status: 'pass',
          domain: 'core',
          required: needCapture,
          summary: `Modern \`android\` CLI detected (${verLine}).`,
        });
      }
    }
  }

  // 3. Android SDK (`ANDROID_HOME`) & `adb`
  {
    const home = resolveHomeDir(env, platform);
    const defaultSdkCandidates = platform === 'darwin'
      ? [home && path.join(home, 'Library', 'Android', 'sdk')].filter(Boolean)
      : platform === 'win32'
        ? [env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, 'Android', 'Sdk')].filter(Boolean)
        : [home && path.join(home, 'Android', 'Sdk')].filter(Boolean);

    const androidHome = env.ANDROID_HOME ? String(env.ANDROID_HOME).trim() : '';
    const androidSdkRoot = env.ANDROID_SDK_ROOT ? String(env.ANDROID_SDK_ROOT).trim() : '';
    const conflictingEnv = Boolean(androidHome && androidSdkRoot && path.resolve(androidHome) !== path.resolve(androidSdkRoot));

    const discoveredSdk = [androidHome, androidSdkRoot, ...defaultSdkCandidates]
      .filter(Boolean)
      .find((dir) => exists(dir));

    const adbBin = findBinaryOnPath('adb', env, platform, exists) ||
      (discoveredSdk
        ? [path.join(discoveredSdk, 'platform-tools', platform === 'win32' ? 'adb.exe' : 'adb')].find((p) => exists(p))
        : null);

    if (!adbBin) {
      const sdkRemediation = discoveredSdk
        ? `export ANDROID_HOME="${discoveredSdk}" && export PATH="$ANDROID_HOME/platform-tools:$PATH"`
        : pickPkgInstallCommand(host, {
            brew: 'brew install --cask android-platform-tools',
            winget: 'winget install Google.PlatformTools',
            scoop: 'scoop install adb',
            apt: 'sudo apt install adb',
            dnf: 'sudo dnf install android-tools',
            pacman: 'sudo pacman -S android-tools',
          });
      checks.push(createDiagnostic({
        code: 'AUX-ADB-001',
        severity: needCapture ? 'error' : 'info',
        status: needCapture ? 'fail' : 'info',
        summary: '`adb` (Android SDK Platform-Tools) is not installed or not on PATH.',
        searched: ['$PATH (`adb`)', '$ANDROID_HOME/platform-tools', ...defaultSdkCandidates],
        impact: '`detect`, `context`, `ignores`, `hooks`, and offline `trace` still work.',
        remediation: host.packageManagers.includes('android')
          ? `android sdk install platform-tools  # or: ${sdkRemediation}`
          : sdkRemediation,
        extra: { id: 'android-sdk-adb', required: needCapture },
      }));
    } else {
      const devRes = execProbe(adbBin, ['devices', '-l'], { env, cwd: resolvedCwd });
      const lines = (devRes.stdout || '')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('List of devices') && !l.startsWith('*'));
      const connected = lines.filter((l) => /\sdevice(\s|$)/.test(l));
      const unauthorized = lines.filter((l) => /\sunauthorized(\s|$)/.test(l));
      const offline = lines.filter((l) => /\soffline(\s|$)/.test(l));
      const noPerm = lines.filter((l) => /no permissions/i.test(l));

      if (conflictingEnv) {
        checks.push(createDiagnostic({
          code: 'AUX-ADB-002',
          severity: 'warning',
          status: 'warn',
          summary: '`ANDROID_HOME` and deprecated `ANDROID_SDK_ROOT` point to different directories.',
          evidence: `ANDROID_HOME="${androidHome}" vs ANDROID_SDK_ROOT="${androidSdkRoot}"`,
          impact: 'Gradle and CLI tools may resolve inconsistent SDK installations.',
          remediation: 'Unset deprecated `ANDROID_SDK_ROOT` and keep `ANDROID_HOME` as the single source of truth.',
          extra: { id: 'android-sdk-adb', required: false },
        }));
      } else if (unauthorized.length > 0 || offline.length > 0 || noPerm.length > 0) {
        const stateNote = noPerm.length > 0
          ? 'USB device lacks Linux udev permissions'
          : unauthorized.length > 0
            ? 'Device is `unauthorized` (accept USB debugging RSA prompt on device)'
            : 'Device is `offline`';
        checks.push(createDiagnostic({
          code: 'AUX-ADB-003',
          severity: needCapture && connected.length === 0 ? 'error' : 'warning',
          status: needCapture && connected.length === 0 ? 'fail' : 'warn',
          summary: `\`adb\` found (${adbBin}), but device state needs attention: ${stateNote}.`,
          evidence: lines.join('; '),
          impact: 'Offline static checks and trace analysis work; live device capture requires an authorized online device.',
          remediation: noPerm.length > 0
            ? 'Configure `/etc/udev/rules.d/51-android.rules` and reconnect USB, or run `adb kill-server && adb start-server`.'
            : 'Unlock the device and accept the USB debugging prompt, or run `adb kill-server && adb start-server`.',
          extra: { id: 'android-sdk-adb', required: needCapture && connected.length === 0 },
        }));
      } else {
        const multiDeviceNote = connected.length > 1 && !env.ANDROID_SERIAL
          ? ` (${connected.length} devices online; set ANDROID_SERIAL when targeting a specific device)`
          : ` (${connected.length} online device${connected.length === 1 ? '' : 's'})`;
        checks.push({
          id: 'android-sdk-adb',
          code: 'AUX-ADB-000',
          severity: 'info',
          status: 'pass',
          domain: 'core',
          required: needCapture,
          summary: `Android SDK / \`adb\` available at ${adbBin}${multiDeviceNote}.`,
        });
      }
    }
  }

  // 4. Perfetto `trace_processor_shell` (`v58+`)
  {
    const tpResolution = resolveTraceProcessor({ explicitPath: traceProcessorPath, env, platform });
    const tpBin = tpResolution.binaryPath;
    const tpWrapper = tpResolution.wrapperPath;
    const tpRemediation = host.platform === 'win32'
      ? [
          'Download `trace_processor_shell-windows-amd64.exe` from https://github.com/google/perfetto/releases/latest',
          'and place it on PATH as `trace_processor_shell.exe` (or pass `--trace-processor C:\\path\\to\\trace_processor_shell.exe`).',
        ]
      : [
          'Download standalone native `trace_processor_shell` from https://github.com/google/perfetto/releases/latest (or run Perfetto\'s `get.perfetto.dev/trace_processor --version` once online to populate `~/.local/share/perfetto/prebuilts/`).',
        ];

    if (!tpBin || !exists(tpBin)) {
      if (tpWrapper) {
        checks.push(createDiagnostic({
          code: 'AUX-TRACE-003',
          severity: needTrace ? 'error' : 'warning',
          status: needTrace ? 'fail' : 'warn',
          summary: `Perfetto Python wrapper detected at ${tpWrapper}, with no cached native binary in ~/.local/share/perfetto/prebuilts/.`,
          searched: ['--trace-processor', '~/.local/share/perfetto/prebuilts/', '$PATH (`trace_processor_shell`, `trace_processor`)'],
          impact: '`doctor` and `trace` do not execute the Python wrapper directly so they stay 100% offline.',
          remediation: [
            `Run \`"${tpWrapper}" --version\` once while online to cache the native binary under ~/.local/share/perfetto/prebuilts/,`,
            'or install a standalone native `trace_processor_shell` binary from https://github.com/google/perfetto/releases/latest.',
          ],
          docPath: 'references/perfetto-workflow.md',
          extra: { id: 'perfetto-trace-processor', required: needTrace },
        }));
      } else {
        checks.push(createDiagnostic({
          code: 'AUX-TRACE-001',
          severity: needTrace ? 'error' : 'info',
          status: needTrace ? 'fail' : 'info',
          summary: 'Perfetto `trace_processor_shell` is not installed or not on PATH.',
          searched: ['--trace-processor', '~/.local/share/perfetto/prebuilts/', '$PATH (`trace_processor_shell`, `trace_processor`)'],
          impact: needTrace
            ? '`npx android-ux trace` cannot query Perfetto traces without `trace_processor_shell`.'
            : '`detect`, `context`, `ignores`, and `hooks` still work. Install `trace_processor_shell` when analyzing `.perfetto-trace` files.',
          remediation: tpRemediation,
          docPath: 'references/perfetto-workflow.md',
          extra: { id: 'perfetto-trace-processor', required: needTrace },
        }));
      }
    } else {
      const verRes = execProbe(tpBin, ['--version'], { env, cwd: resolvedCwd });
      const verText = `${verRes.stdout}\n${verRes.stderr}`.trim();
      const verMatch = verText.match(/\bv?(\d+)\.\d+/i);
      const majorVer = verMatch ? Number(verMatch[1]) : null;
      if (majorVer !== null && majorVer < 58) {
        checks.push(createDiagnostic({
          code: 'AUX-TRACE-002',
          severity: 'warning',
          status: 'warn',
          summary: `Perfetto trace processor at ${tpBin} is v${majorVer} (< v58 recommended for Android 16/17).`,
          evidence: verText.split('\n')[0],
          impact: 'Older Perfetto versions may fail to parse newer Android 16/17 FrameTimeline packets.',
          remediation: tpRemediation,
          docPath: 'references/perfetto-workflow.md',
          extra: { id: 'perfetto-trace-processor', required: false },
        }));
      } else {
        checks.push({
          id: 'perfetto-trace-processor',
          code: 'AUX-TRACE-000',
          severity: 'info',
          status: 'pass',
          domain: 'core',
          required: needTrace,
          summary: `Perfetto trace processor ready at ${tpBin}${verMatch ? ` (v${verMatch[0].replace(/^v/i, '')})` : ''}.`,
        });
      }
    }
  }

  // 5. ImageMagick (`magick` first; Linux IM6 `compare`/`montage` fallback; NEVER bare `convert` on Windows)
  {
    let imFound = null;
    const magickBin = findBinaryOnPath('magick', env, platform, exists);
    if (magickBin) {
      const res = execProbe(magickBin, ['-version'], { env, cwd: resolvedCwd });
      if (/ImageMagick/i.test(`${res.stdout}\n${res.stderr}`)) {
        imFound = `${magickBin} (IM7)`;
      }
    }
    if (!imFound && platform !== 'win32') {
      const compareBin = findBinaryOnPath('compare', env, platform, exists);
      const montageBin = findBinaryOnPath('montage', env, platform, exists);
      if (compareBin && montageBin) {
        const res = execProbe(compareBin, ['-version'], { env, cwd: resolvedCwd });
        if (/ImageMagick/i.test(`${res.stdout}\n${res.stderr}`)) {
          imFound = `${compareBin} + ${montageBin} (IM6)`;
        }
      }
    }

    if (!imFound) {
      checks.push(createDiagnostic({
        code: 'AUX-MEDIA-001',
        severity: needCapture ? 'error' : 'info',
        status: needCapture ? 'fail' : 'info',
        summary: 'ImageMagick (`magick`) is not installed (optional; used for visual diff & filmstrips).',
        searched: platform === 'win32'
          ? ['$PATH (`magick.exe`, WinGet Links, Scoop shims — skipping Windows `System32\\convert.exe`)']
          : ['$PATH (`magick`, `compare` + `montage`)'],
        impact: 'All static checks (`detect`), `context`, `hooks`, and Perfetto `trace` work without ImageMagick.',
        remediation: pickPkgInstallCommand(host, {
          brew: 'brew install imagemagick',
          winget: 'winget install ImageMagick.ImageMagick',
          scoop: 'scoop install imagemagick',
          apt: 'sudo apt install imagemagick',
          dnf: 'sudo dnf install ImageMagick',
          pacman: 'sudo pacman -S imagemagick',
        }),
        extra: { id: 'imagemagick', required: needCapture },
      }));
    } else {
      checks.push({
        id: 'imagemagick',
        code: 'AUX-MEDIA-000',
        severity: 'info',
        status: 'pass',
        domain: 'core',
        required: needCapture,
        summary: `ImageMagick available (${imFound}).`,
      });
    }
  }

  // 6. `ffmpeg` + `ffprobe` (independent checks with `-nostdin`)
  {
    const ffmpegBin = findBinaryOnPath('ffmpeg', env, platform, exists);
    const ffprobeBin = findBinaryOnPath('ffprobe', env, platform, exists);
    const ffmpegOk = Boolean(ffmpegBin && execProbe(ffmpegBin, ['-nostdin', '-version'], { env, cwd: resolvedCwd }).status === 0);
    const ffprobeOk = Boolean(ffprobeBin && execProbe(ffprobeBin, ['-nostdin', '-version'], { env, cwd: resolvedCwd }).status === 0);

    if (!ffmpegOk || !ffprobeOk) {
      const missingParts = [!ffmpegOk && 'ffmpeg', !ffprobeOk && 'ffprobe'].filter(Boolean).join(', ');
      checks.push(createDiagnostic({
        code: 'AUX-MEDIA-002',
        severity: needCapture ? 'error' : 'info',
        status: needCapture ? 'fail' : 'info',
        summary: `FFmpeg tools missing (${missingParts}) (optional; used for screenrecord frame extraction).`,
        searched: '$PATH (`ffmpeg`, `ffprobe`)',
        impact: 'All static checks (`detect`), `context`, `hooks`, and Perfetto `trace` work without FFmpeg.',
        remediation: pickPkgInstallCommand(host, {
          brew: 'brew install ffmpeg',
          winget: 'winget install Gyan.FFmpeg',
          scoop: 'scoop install ffmpeg',
          apt: 'sudo apt install ffmpeg',
          dnf: 'sudo dnf install ffmpeg-free  # (or full ffmpeg via RPM Fusion)',
          pacman: 'sudo pacman -S ffmpeg',
        }),
        extra: { id: 'ffmpeg', required: needCapture },
      }));
    } else {
      checks.push({
        id: 'ffmpeg',
        code: 'AUX-MEDIA-003',
        severity: 'info',
        status: 'pass',
        domain: 'core',
        required: needCapture,
        summary: `\`ffmpeg\` and \`ffprobe\` available (${ffmpegBin}).`,
      });
    }
  }

  // 7. `.android-ux/config*.json` & Waiver Staleness Audit
  {
    const cfgBefore = readProjectConfig(resolvedCwd);
    if (cfgBefore.meta.sharedMalformed || cfgBefore.meta.localMalformed) {
      const badPath = cfgBefore.meta.sharedMalformed ? cfgBefore.meta.sharedPath : cfgBefore.meta.localPath;
      checks.push(createDiagnostic({
        code: 'AUX-CONFIG-001',
        severity: 'error',
        status: 'fail',
        file: normalizePosixPath(path.relative(resolvedCwd, badPath)),
        summary: `Malformed JSON in ${normalizePosixPath(path.relative(resolvedCwd, badPath))}.`,
        impact: 'Project waivers and hook preferences in this file cannot be applied until valid JSON is restored.',
        remediation: `Fix JSON syntax in ${normalizePosixPath(path.relative(resolvedCwd, badPath))}.`,
        extra: { id: 'repo-config-waivers', required: true },
      }));
    } else {
      if (fix && cfgBefore.waivers.length > 0) {
        const pruneRes = pruneStaleWaivers(resolvedCwd, { includeShared: false });
        if (pruneRes.pruned.length > 0) {
          fixesApplied.push(`Pruned ${pruneRes.pruned.length} stale/expired local waiver(s) from .android-ux/config.local.json.`);
        }
      }

      const cfgAfter = readProjectConfig(resolvedCwd);
      if (cfgAfter.waivers.length > 0) {
        const scan = runStaticScan({ targets: [resolvedCwd], cwd: resolvedCwd });
        const staleItems = scan.waiverAudit.filter((a) => a.issues.length > 0);
        if (staleItems.length > 0) {
          const hasSharedStale = staleItems.some((a) => a.source === 'shared');
          checks.push(createDiagnostic({
            code: 'AUX-CONFIG-002',
            severity: 'warning',
            status: 'warn',
            summary: `${staleItems.length} stale waiver(s) detected in .android-ux/config*.json.`,
            evidence: staleItems
              .map((a) => `${a.waiver.rule} (${a.issues.join(', ')})`)
              .join('; '),
            impact: 'Stale waivers accumulate config noise after underlying code is refactored or rules change.',
            remediation: hasSharedStale
              ? 'Run `npx android-ux ignores prune --yes` to prune proven-unused/expired waivers across both personal and shared config.'
              : 'Run `npx android-ux ignores prune` (or `npx android-ux doctor --fix`) to clean up proven-unused and expired local waivers.',
            extra: { id: 'repo-config-waivers', required: false },
          }));
        } else {
          checks.push({
            id: 'repo-config-waivers',
            code: 'AUX-CONFIG-000',
            severity: 'info',
            status: 'pass',
            domain: 'core',
            required: false,
            summary: `${cfgAfter.waivers.length} configured waiver(s) verified fresh.`,
          });
        }
      } else {
        checks.push({
          id: 'repo-config-waivers',
          code: 'AUX-CONFIG-000',
          severity: 'info',
          status: 'pass',
          domain: 'core',
          required: false,
          summary: 'Zero-footprint config state (no stale waivers).',
        });
      }
    }
  }

  // 8. `MOTION.md` structure, git commit drift (`>=25` UI `.kt` commits), & symbol drift
  {
    const motionMdPath = path.join(resolvedCwd, 'MOTION.md');
    if (exists(motionMdPath)) {
      let content = '';
      try {
        content = readFile(motionMdPath);
      } catch {
        content = '';
      }
      const parsed = parseMotionMd(content, motionMdPath);
      const driftNotes = [];

      // Git commit drift since MOTION.md was last touched
      if (exists(path.join(resolvedCwd, '.git'))) {
        const lastTouch = execProbe('git', ['log', '-1', '--format=%H', '--', 'MOTION.md'], { env, cwd: resolvedCwd });
        const sha = (lastTouch.stdout || '').trim();
        if (lastTouch.status === 0 && /^[0-9a-f]{7,40}$/i.test(sha)) {
          const ktCommits = execProbe('git', ['rev-list', '--count', `${sha}..HEAD`, '--', '*.kt'], { env, cwd: resolvedCwd });
          const commitCount = Number((ktCommits.stdout || '').trim());
          if (ktCommits.status === 0 && Number.isFinite(commitCount) && commitCount >= 25) {
            driftNotes.push(`${commitCount} commits modified .kt files since MOTION.md was last updated`);
          }
        }
      }

      // Referenced symbol drift across repo `.kt` files
      const referencedSymbols = new Set();
      for (const spec of parsed.specs) {
        for (const id of extractCandidateProjectSymbols(spec.binding)) referencedSymbols.add(id);
      }
      for (const exc of parsed.exceptions) {
        for (const id of extractCandidateProjectSymbols(exc.symbol)) referencedSymbols.add(id);
      }

      if (referencedSymbols.size > 0) {
        const walked = walkScannableFiles(resolvedCwd, { cwd: resolvedCwd });
        const ktPaths = walked.files.filter((f) => f.toLowerCase().endsWith('.kt'));
        if (ktPaths.length > 0) {
          const allKtContent = ktPaths
            .map((p) => {
              try {
                return readFile(p);
              } catch {
                return '';
              }
            })
            .join('\n');
          const missingSymbols = [...referencedSymbols].filter((sym) => !allKtContent.includes(sym));
          if (missingSymbols.length > 0) {
            driftNotes.push(`referenced symbol(s) not found in .kt sources: ${missingSymbols.join(', ')}`);
          }
        }
      }

      if (parsed.lintFindings.length > 0 || driftNotes.length > 0) {
        const issues = [
          ...parsed.lintFindings.map((f) => `${f.rule}: ${f.evidence}`),
          ...driftNotes.map((d) => `motion-md-drift: ${d}`),
        ];
        checks.push(createDiagnostic({
          code: 'AUX-CONTRACT-001',
          severity: 'warning',
          status: 'warn',
          file: 'MOTION.md',
          summary: `MOTION.md has ${issues.length} structural or drift warning(s).`,
          evidence: issues.join(' | '),
          impact: 'Outdated or malformed MOTION.md specs can mislead motion reviews and builds.',
          remediation: 'Run `/improve-android-motion` (or `npx android-ux detect MOTION.md`) to refresh MOTION.md.',
          extra: { id: 'motion-md-health', required: false },
        }));
      } else {
        checks.push({
          id: 'motion-md-health',
          code: 'AUX-CONTRACT-000',
          severity: 'info',
          status: 'pass',
          domain: 'motion',
          required: false,
          summary: `MOTION.md valid (${parsed.lineCount} lines, ${parsed.specs.length} spec(s)).`,
        });
      }
    }
  }

  // 9. Harness hook manifest health
  {
    const hookIssues = inspectAndOptionallyFixHookManifests(resolvedCwd, { fix, exists, readFile, fixesApplied });
    if (hookIssues.length > 0) {
      checks.push(createDiagnostic({
        code: 'AUX-HOOK-001',
        severity: needHooks ? 'error' : 'warning',
        status: needHooks ? 'fail' : 'warn',
        summary: `${hookIssues.length} broken or malformed hook manifest entry(ies) detected.`,
        evidence: hookIssues.join('; '),
        impact: 'Broken hook paths either no-op silently or fail harness startup validation.',
        remediation: 'Run `npx android-ux hooks on` or `npx android-ux doctor --fix` to repair or remove stale android-ux hook entries.',
        extra: { id: 'hook-manifests', required: needHooks },
      }));
    } else {
      checks.push({
        id: 'hook-manifests',
        code: 'AUX-HOOK-000',
        severity: 'info',
        status: 'pass',
        domain: 'core',
        required: needHooks,
        summary: 'Hook manifests healthy.',
      });
    }
  }

  const failedRequired = checks.filter((c) => c.status === 'fail');
  return {
    host,
    checks,
    fixesApplied,
    healthy: failedRequired.length === 0,
    exitCode: failedRequired.length > 0 ? 1 : 0,
  };
}

function extractCandidateProjectSymbols(text) {
  if (!text) return [];
  const results = [];
  const identMatches = String(text).matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g);
  for (const m of identMatches) {
    const id = m[1];
    if (id.length < 4) continue;
    if (FRAMEWORK_MOTION_IDENTIFIERS.has(id)) continue;
    // Focus on PascalCase or Motion/Screen/Nav/Host/Spec-named project symbols
    if (/^[A-Z]/.test(id) || /(Motion|Spec|Host|Nav|Pager|Carousel|Banner|Sheet|Card)/.test(id)) {
      results.push(id);
    }
  }
  return results;
}

function inspectAndOptionallyFixHookManifests(cwd, { fix, exists, readFile, fixesApplied }) {
  const candidates = [
    { rel: 'hooks.json', editable: false },
    { rel: 'hooks/hooks.json', editable: false },
    { rel: '.claude/settings.local.json', editable: true },
    { rel: '.claude/settings.json', editable: true },
    { rel: '.cursor/hooks.json', editable: true },
    { rel: '.codex/hooks.json', editable: true },
    { rel: '.github/hooks/android-ux.json', editable: true },
    { rel: '.gemini/hooks.json', editable: true },
    { rel: '_agents/hooks.json', editable: true },
  ];

  const issues = [];
  for (const item of candidates) {
    const full = path.join(cwd, item.rel);
    if (!exists(full)) continue;
    let parsed;
    try {
      parsed = JSON.parse(readFile(full));
    } catch {
      issues.push(`${item.rel}: invalid JSON`);
      continue;
    }

    const cmdStrings = collectEnabledHookCommands(parsed);
    const brokenCmds = [];
    for (const cmd of cmdStrings) {
      const info = extractLocalHookLauncherInfo(cmd, cwd, full);
      if (!info.invokesHook) continue;
      if (info.localPath && !exists(info.localPath)) {
        brokenCmds.push(info.localPath);
      }
    }

    if (brokenCmds.length > 0) {
      if (fix && item.editable) {
        const cleaned = removeBrokenAndroidUxHooks(parsed, cwd, full, exists);
        try {
          if (cleaned === null) {
            fs.unlinkSync(full);
          } else {
            fs.writeFileSync(full, `${JSON.stringify(cleaned, null, 2)}\n`, 'utf8');
          }
          fixesApplied.push(`Cleaned broken android-ux hook entry from ${item.rel}.`);
          continue;
        } catch {
          // Fall through and report issue if unwritable.
        }
      }
      issues.push(`${item.rel}: hook-script-missing (${brokenCmds.map((p) => normalizePosixPath(path.relative(cwd, p))).join(', ')})`);
    }
  }
  return issues;
}

function removeBrokenAndroidUxHooks(parsed, repoRoot, manifestPath, exists) {
  if (!parsed || typeof parsed !== 'object') return parsed;
  const isBrokenObj = (h) => {
    const cmd = h?.command || h?.bash;
    if (typeof cmd !== 'string') return false;
    const info = extractLocalHookLauncherInfo(cmd, repoRoot, manifestPath);
    return Boolean(info.invokesHook && info.localPath && !exists(info.localPath));
  };

  const clone = JSON.parse(JSON.stringify(parsed));
  if (clone['android-ux']) {
    delete clone['android-ux'];
  }
  if (clone.hooks && typeof clone.hooks === 'object') {
    for (const [evt, list] of Object.entries(clone.hooks)) {
      if (!Array.isArray(list)) continue;
      clone.hooks[evt] = list
        .map((entry) => {
          if (Array.isArray(entry?.hooks)) {
            const kept = entry.hooks.filter((h) => !isBrokenObj(h));
            return kept.length > 0 ? { ...entry, hooks: kept } : null;
          }
          return isBrokenObj(entry) ? null : entry;
        })
        .filter(Boolean);
      if (clone.hooks[evt].length === 0) delete clone.hooks[evt];
    }
    if (Object.keys(clone.hooks).length === 0 && Object.keys(clone).every((k) => k === 'hooks' || k === 'version')) {
      return null;
    }
  }
  return clone;
}

export async function runDoctorCommand(rawArgs, io = defaultIo()) {
  const args = [...rawArgs];
  if (args[0] === 'doctor') args.shift();

  let json = false;
  let fix = false;
  let showHelp = false;
  let traceProcessorPath = null;
  const requiredFeatures = new Set();

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--help' || a === '-h') {
      showHelp = true;
    } else if (a === '--json') {
      json = true;
    } else if (a === '--fix') {
      fix = true;
    } else if (a === '--for' || a.startsWith('--for=')) {
      const val = a.includes('=') ? a.slice('--for='.length) : args[++i];
      if (!val || val.startsWith('--')) {
        io.stderr.write('Error: --for requires a feature name (all, detect, trace, hooks, capture)\n');
        return 1;
      }
      for (const part of val.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) {
        if (!VALID_FEATURES.has(part)) {
          io.stderr.write(`Error: unknown --for feature "${part}". Valid: all, detect, trace, hooks, capture\n`);
          return 1;
        }
        requiredFeatures.add(part);
      }
    } else if (a === '--trace-processor' || a.startsWith('--trace-processor=')) {
      traceProcessorPath = a.includes('=') ? a.slice('--trace-processor='.length) : args[++i];
    } else {
      io.stderr.write(`Error: unknown doctor option "${a}". Run android-ux doctor --help.\n`);
      return 1;
    }
  }

  if (showHelp) {
    io.stdout.write(DOCTOR_USAGE);
    return 0;
  }

  const report = runDoctorChecks({
    cwd: io.cwd,
    env: io.env,
    platform: io.platform || process.platform,
    arch: io.arch || process.arch,
    requiredFeatures,
    fix,
    traceProcessorPath,
    execProbe: io.execProbe || defaultExecProbe,
    exists: io.exists || ((p) => fs.existsSync(p)),
    readFile: io.readFile || ((p) => fs.readFileSync(p, 'utf8')),
  });

  if (json) {
    const payload = createJsonEnvelope('doctor', {
      healthy: report.healthy,
      host: report.host,
      requiredFeatures: [...requiredFeatures],
      fixesApplied: report.fixesApplied,
      checks: report.checks,
    });
    io.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return report.exitCode;
  }

  const out = [];
  out.push(`android-ux doctor (${report.host.platform}/${report.host.arch})`);
  if (report.fixesApplied.length > 0) {
    for (const msg of report.fixesApplied) {
      out.push(`  [FIXED] ${msg}`);
    }
  }
  out.push('');

  for (const check of report.checks) {
    if (check.status === 'pass') {
      out.push(`[PASS] ${check.summary}`);
    } else if (check.status === 'info') {
      out.push(`[INFO ${check.code}] ${check.summary}`);
      if (check.impact) out.push(`  Note: ${check.impact}`);
      if (check.remediation) {
        const remLines = Array.isArray(check.remediation) ? check.remediation : String(check.remediation).split('\n');
        out.push(`  Install: ${remLines[0]}`);
        for (let k = 1; k < remLines.length; k += 1) out.push(`           ${remLines[k]}`);
      }
    } else {
      out.push(formatDiagnosticText(check));
    }
  }

  io.stdout.write(`${out.join('\n')}\n`);
  return report.exitCode;
}

function defaultIo() {
  return {
    cwd: process.cwd(),
    env: process.env,
    stdout: process.stdout,
    stderr: process.stderr,
  };
}
