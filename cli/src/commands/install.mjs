import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJsonEnvelope } from '../diagnostics.mjs';
import { normalizePosixPath } from '../config.mjs';
import {
  SUPPORTED_PROVIDERS,
  resolveProviderPaths,
  installProviderHookManifest,
} from './hooks.mjs';

const INSTALL_USAGE = `Usage:
  android-ux install [options]
  android-ux update [options]

Install or update Android UX skills and non-blocking context hooks into your project
or global harness directories (Claude Code, Codex, Cursor, GitHub Copilot, Antigravity/Jetski).

Options:
  --scope <project|global>  Target project directory (default) or user home directory
  --providers <list>        Comma-separated providers (${SUPPORTED_PROVIDERS.join(', ')})
  --no-hooks                Copy skills without registering harness hook manifests
  --json                    Emit a single JSON document on stdout
  --help, -h                Show this help message
`;

export function locatePackagedSkillsRoot() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, '..', '..', '..', 'skills'), // cli/src/commands/install.mjs -> repo/package root/skills
    path.resolve(here, '..', '..'),                 // skills/<name>/scripts/android-ux.mjs -> skills/
  ];
  for (const dir of candidates) {
    try {
      if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
        const entries = fs.readdirSync(dir);
        if (entries.some((name) => fs.existsSync(path.join(dir, name, 'SKILL.md')))) {
          return dir;
        }
      }
    } catch {
      // Ignore unreadable candidate.
    }
  }
  return null;
}

function detectDefaultProviders(cwd, scope) {
  if (scope === 'global') {
    return ['claude'];
  }
  const found = [];
  if (fs.existsSync(path.join(cwd, '.claude'))) found.push('claude');
  if (fs.existsSync(path.join(cwd, '.codex'))) found.push('codex');
  if (fs.existsSync(path.join(cwd, '.cursor'))) found.push('cursor');
  if (fs.existsSync(path.join(cwd, '.github', 'skills')) || fs.existsSync(path.join(cwd, '.github', 'hooks'))) {
    found.push('copilot');
  }
  if (fs.existsSync(path.join(cwd, '.gemini')) || fs.existsSync(path.join(cwd, '_agents'))) {
    found.push('jetski');
  }
  return found.length > 0 ? found : ['claude'];
}

function copySkillBundleClean(srcSkillDir, destSkillDir) {
  const srcReal = fs.realpathSync(srcSkillDir);
  if (fs.existsSync(destSkillDir)) {
    const destReal = fs.realpathSync(destSkillDir);
    if (srcReal === destReal) {
      // Self-update in place (e.g., running installed `.claude/skills/.../scripts/android-ux update`): safe no-op.
      return;
    }
    if (destReal.startsWith(`${srcReal}${path.sep}`) || srcReal.startsWith(`${destReal}${path.sep}`)) {
      throw new Error(`Refusing overlapping skill bundle copy between "${srcSkillDir}" and "${destSkillDir}".`);
    }
  }

  fs.mkdirSync(path.dirname(destSkillDir), { recursive: true });
  const stagingDir = `${destSkillDir}.staging-${process.pid}-${Date.now()}`;
  try {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    copyFilteredDir(srcReal, stagingDir);
    const posixLauncher = path.join(stagingDir, 'scripts', 'android-ux');
    if (fs.existsSync(posixLauncher)) {
      try {
        fs.chmodSync(posixLauncher, 0o755);
      } catch {
        // Ignore Windows chmod no-op.
      }
    }
    fs.rmSync(destSkillDir, { recursive: true, force: true });
    fs.renameSync(stagingDir, destSkillDir);
  } catch (err) {
    try {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    } catch {
      // Ignore staging cleanup error.
    }
    throw err;
  }
}

function copyFilteredDir(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.name === 'evals' || entry.name === 'skill-source.json' || entry.name.startsWith('.')) {
      continue;
    }
    const srcPath = path.join(srcDir, entry.name);
    const dstPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyFilteredDir(srcPath, dstPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

export async function runInstallCommand(rawArgs, io = defaultIo()) {
  const args = [...rawArgs];
  const verb = (args[0] === 'install' || args[0] === 'update') ? args.shift() : 'install';

  let scope = 'project';
  let withHooks = true;
  let json = false;
  const requestedProviders = [];

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--help' || a === '-h') {
      io.stdout.write(INSTALL_USAGE);
      return 0;
    }
    if (a === '--json') {
      json = true;
    } else if (a === '--no-hooks') {
      withHooks = false;
    } else if (a === '-y' || a === '--yes' || a === '--force') {
      // Accepted for non-interactive CLI compatibility.
    } else if (a === '--scope' || a.startsWith('--scope=')) {
      const v = a.includes('=') ? a.slice('--scope='.length) : args[++i];
      if (!['project', 'global'].includes(v)) {
        io.stderr.write('Error: --scope must be project or global\n');
        return 1;
      }
      scope = v;
    } else if (a === '--providers' || a.startsWith('--providers=') || a === '--harness' || a.startsWith('--harness=')) {
      const v = a.includes('=') ? a.slice(a.indexOf('=') + 1) : args[++i];
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
      io.stderr.write(`Error: unknown ${verb} option "${a}". Run android-ux ${verb} --help.\n`);
      return 1;
    }
  }

  const skillsRoot = locatePackagedSkillsRoot();
  if (!skillsRoot) {
    io.stderr.write('Error: could not locate packaged skills/ directory to install.\n');
    return 1;
  }

  const skillNames = fs.readdirSync(skillsRoot)
    .filter((name) => {
      const full = path.join(skillsRoot, name, 'SKILL.md');
      return fs.existsSync(full) && fs.statSync(full).isFile();
    })
    .sort();

    let providers = requestedProviders;
    if (providers.length === 0) {
      if (verb === 'update') {
        providers = SUPPORTED_PROVIDERS.filter((prov) => {
          const info = resolveProviderPaths(prov, { cwd: io.cwd, scope, env: io.env, platform: io.platform || process.platform });
          return info && skillNames.some((s) => fs.existsSync(path.join(info.skillsDir, s)));
        });
        if (providers.length === 0) {
          providers = detectDefaultProviders(io.cwd, scope);
        }
      } else {
        providers = detectDefaultProviders(io.cwd, scope);
      }
    }

    const installed = [];
    try {
      for (const prov of providers) {
        const info = resolveProviderPaths(prov, {
          cwd: io.cwd,
          scope,
          env: io.env,
          platform: io.platform || process.platform,
        });
        if (!info) continue;

        for (const skillName of skillNames) {
          const srcDir = path.join(skillsRoot, skillName);
          const dstDir = path.join(info.skillsDir, skillName);
          copySkillBundleClean(srcDir, dstDir);
        }

        let hookWired = false;
        if (withHooks) {
          hookWired = installProviderHookManifest(info);
        }

        installed.push({
          provider: prov,
          skillsDir: scope === 'project'
            ? normalizePosixPath(path.relative(io.cwd, info.skillsDir))
            : normalizePosixPath(info.skillsDir),
          skillsCount: skillNames.length,
          hookManifest: hookWired
            ? (scope === 'project'
                ? normalizePosixPath(path.relative(io.cwd, info.manifestPath))
                : normalizePosixPath(info.manifestPath))
            : null,
        });
      }
    } catch (err) {
      io.stderr.write(`Error: ${err?.message || String(err)}\n`);
      return 1;
    }

  if (json) {
    io.stdout.write(`${JSON.stringify(createJsonEnvelope(verb, {
      scope,
      skills: skillNames,
      installed,
    }), null, 2)}\n`);
    return 0;
  }

  for (const item of installed) {
    const hookNote = item.hookManifest ? ` + hooks (${item.hookManifest})` : ' (hooks skipped)';
    io.stdout.write(`${verb === 'update' ? 'Updated' : 'Installed'} ${item.skillsCount} skill(s) for ${item.provider} -> ${item.skillsDir}${hookNote}\n`);
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
