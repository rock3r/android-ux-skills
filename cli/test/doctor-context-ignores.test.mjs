import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  runDoctorChecks,
  gatherProjectContext,
  runStaticScan,
  runCli,
} from '../src/index.mjs';
import { findBinaryOnPath } from '../src/commands/doctor.mjs';

test('doctor: OS/pkg-manager matrix, legacy 2016 tools/android rejection, Windows convert.exe avoidance, and offline Python wrapper safety', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aux-doc-'));
  try {
    // 1. Windows host with winget, System32/convert.exe (must NOT be mistaken for ImageMagick), and legacy android.bat
    const winFakeFiles = new Set([
      'C:\\Windows\\System32\\convert.exe',
      'C:\\Android\\tools\\android.bat',
      'C:\\Users\\dev\\AppData\\Local\\Microsoft\\WinGet\\Links\\winget.exe',
    ]);
    const probedBinaries = [];
    const winRes = runDoctorChecks({
      cwd: tmpDir,
      platform: 'win32',
      arch: 'x64',
      nodeVersion: '22.12.0',
      env: {
        PATH: 'C:\\Windows\\System32;C:\\Android\\tools',
        USERPROFILE: 'C:\\Users\\dev',
        LOCALAPPDATA: 'C:\\Users\\dev\\AppData\\Local',
      },
      exists: (p) => winFakeFiles.has(p),
      execProbe: (cmd, args) => {
        probedBinaries.push(`${cmd} ${args.join(' ')}`);
        if (cmd.endsWith('android.bat')) {
          return {
            status: 1,
            stdout: 'The android command is no longer available. For manual SDK management, please use Android Studio.',
            stderr: '',
          };
        }
        return { status: 1, stdout: '', stderr: '' };
      },
    });

    assert.equal(winRes.exitCode, 0, 'Optional missing tools exit 0 when --for is omitted');
    assert.equal(
      probedBinaries.some((c) => /convert\.exe/i.test(c)),
      false,
      'Doctor must NEVER invoke Windows System32\\convert.exe'
    );
    const androidCheck = winRes.checks.find((c) => c.id === 'android-cli');
    assert.equal(androidCheck.code, 'AUX-ANDROID-002');
    const imCheck = winRes.checks.find((c) => c.id === 'imagemagick');
    assert.equal(imCheck.code, 'AUX-MEDIA-001');
    assert.match(String(imCheck.remediation), /winget install ImageMagick\.ImageMagick/);

    // 2. Perfetto Python wrapper on multi-directory PATH: `doctor` must split PATH cleanly and NOT run `--version` on it (stays 100% offline!)
    const emptyFirstDir = path.join(tmpDir, 'empty-first');
    const binDir = path.join(tmpDir, 'bin');
    const emptyHome = path.join(tmpDir, 'home');
    fs.mkdirSync(path.join(emptyFirstDir, 'adb'), { recursive: true }); // directory named `adb` must NOT be treated as a binary!
    fs.mkdirSync(binDir, { recursive: true });
    fs.mkdirSync(emptyHome, { recursive: true });
    const pyWrapper = path.join(binDir, 'trace_processor');
    fs.writeFileSync(pyWrapper, '#!/usr/bin/env python3\nraise SystemExit("NO_NETWORK")\n', { mode: 0o755 });
    const realAdb = path.join(binDir, process.platform === 'win32' ? 'adb.exe' : 'adb');
    fs.writeFileSync(realAdb, 'stub', { mode: 0o755 });

    const multiRealPath = [emptyFirstDir, binDir].join(path.delimiter);
    assert.equal(
      findBinaryOnPath('adb', { PATH: multiRealPath }, process.platform),
      realAdb,
      'findBinaryOnPath must skip directories named adb and discover executable in later PATH entry'
    );
    assert.equal(
      findBinaryOnPath('adb', { PATH: '/opt/empty:/opt/android/platform-tools:/usr/bin' }, 'linux', (p) => p === '/opt/android/platform-tools/adb'),
      '/opt/android/platform-tools/adb',
      'POSIX multi-directory PATH with leading slashes must split cleanly at colons'
    );
    assert.equal(
      findBinaryOnPath('adb', { PATH: 'C:\\Empty;D:\\Android\\Sdk\\platform-tools;C:\\Windows\\System32' }, 'win32', (p) => p === 'D:\\Android\\Sdk\\platform-tools\\adb.exe'),
      'D:\\Android\\Sdk\\platform-tools\\adb.exe',
      'Windows multi-directory PATH with drive letters must split cleanly at semicolons'
    );

    const hostProbes = [];
    const traceReqRes = runDoctorChecks({
      cwd: tmpDir,
      platform: process.platform,
      arch: 'arm64',
      nodeVersion: '22.12.0',
      requiredFeatures: new Set(['trace']),
      env: { PATH: multiRealPath, HOME: emptyHome, USERPROFILE: emptyHome },
      execProbe: (cmd, args) => {
        hostProbes.push(`${cmd} ${args.join(' ')}`);
        return { status: 0, stdout: '22', stderr: '' };
      },
    });
    assert.equal(
      hostProbes.some((p) => p.includes('trace_processor')),
      false,
      'Doctor must never execute Python Perfetto wrapper'
    );
    assert.equal(traceReqRes.exitCode, 1, '--for trace must exit 1 when native trace_processor_shell is unavailable');
    const tpCheck = traceReqRes.checks.find((c) => c.id === 'perfetto-trace-processor');
    assert.equal(tpCheck.code, 'AUX-TRACE-003');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('context: epistemic unknown on bare Kotlin directory, confirmed on Gradle Material3, and zero .android-ux/ footprint', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aux-ctx-'));
  try {
    // Bare Kotlin file (like an eval fixture) -> Material 3 & Navigation facts MUST be `unknown`, never `notFoundInScannedSources`
    fs.writeFileSync(path.join(tmpDir, 'Screen.kt'), 'package demo\nfun Screen() {}\n', 'utf8');
    const bareCtx = gatherProjectContext({ cwd: tmpDir, includeSignals: true });
    assert.equal(bareCtx.facts.material3, 'unknown');
    assert.equal(bareCtx.facts.navigationCompose, 'unknown');
    assert.equal(bareCtx.nextRequiredAction, 'MANUAL_DETECTOR_REQUIRED');
    assert.equal(fs.existsSync(path.join(tmpDir, '.android-ux')), false, 'context must never create .android-ux/');

    // Add build.gradle.kts with material3 1.4.0 -> `confirmed`
    fs.writeFileSync(
      path.join(tmpDir, 'build.gradle.kts'),
      'dependencies {\n  implementation("androidx.compose.material3:material3:1.4.0")\n}\n',
      'utf8'
    );
    const gradleCtx = gatherProjectContext({ cwd: tmpDir });
    assert.equal(gradleCtx.facts.material3, 'confirmed');
    assert.equal(gradleCtx.facts.navigationCompose, 'notFoundInScannedSources');
    assert.equal(fs.existsSync(path.join(tmpDir, '.android-ux')), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('ignores: floor/obligation guard, linked git worktree <commondir>/info/exclude, and local-only default prune vs --yes', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aux-ign-'));
  try {
    // Simulate a linked git worktree: `.git` is a file pointing to `gitdir`, which has `commondir`
    const commonGit = path.join(tmpDir, 'common-git');
    const worktreeGit = path.join(commonGit, 'worktrees', 'wt1');
    const repoDir = path.join(tmpDir, 'wt');
    fs.mkdirSync(worktreeGit, { recursive: true });
    fs.mkdirSync(repoDir, { recursive: true });
    fs.writeFileSync(path.join(worktreeGit, 'commondir'), '../..\n', 'utf8');
    fs.writeFileSync(path.join(repoDir, '.git'), `gitdir: ${worktreeGit}\n`, 'utf8');
    fs.writeFileSync(path.join(repoDir, '.gitignore'), 'build/\n', 'utf8');
    fs.writeFileSync(path.join(repoDir, 'Legacy.kt'), 'package app\nfun Legacy() {}\n', 'utf8');

    const run = async (argv) => {
      let stdout = '';
      let stderr = '';
      const code = await runCli(argv, {
        cwd: repoDir,
        env: process.env,
        stdout: { write: (s) => { stdout += s; } },
        stderr: { write: (s) => { stderr += s; } },
      });
      return { code, stdout, stderr };
    };

    // 1. Floor rule `F-001` rejected as design `--kind waiver` or without `--file`
    const badFloor = await run(['ignores', 'add', 'F-001', '--reason', 'Want to skip']);
    assert.equal(badFloor.code, 1);
    const badWildcard = await run(['ignores', 'add', 'F-001', '--kind', 'false-positive', '--file', '**/*', '--reason', 'Too broad']);
    assert.equal(badWildcard.code, 1);

    // 2. Narrow `false-positive` on `F-001` in `--local` writes `<commondir>/info/exclude` and never touches `.gitignore`
    const okLocal = await run([
      'ignores', 'add', 'F-001',
      '--kind', 'false-positive',
      '--file', 'Legacy.kt',
      '--local',
      '--reason', 'Custom non-Compose offset helper',
    ]);
    assert.equal(okLocal.code, 0);
    assert.equal(fs.readFileSync(path.join(repoDir, '.gitignore'), 'utf8'), 'build/\n');
    const excludeText = fs.readFileSync(path.join(commonGit, 'info', 'exclude'), 'utf8');
    assert.match(excludeText, /\.android-ux\/config\.local\.json/);

    // 3. Add a stale shared taste waiver (`T-002` on `Legacy.kt`, which has no `T-002` finding -> `proven-unused`)
    // and a review-only taste waiver (`T-009` -> `unknown`, must NEVER be pruned!)
    assert.equal((await run(['ignores', 'add', 'T-002', '--file', 'Legacy.kt', '--shared', '--reason', 'Old screen'])).code, 0);
    assert.equal((await run(['ignores', 'add', 'T-009', '--file', 'Legacy.kt', '--shared', '--reason', 'Rare admin action'])).code, 0);

    // Default `ignores prune` prunes `local` stale waiver (`F-001`) while skipping `shared` (`T-002`)
    const pruneDefault = await run(['ignores', 'prune', '--json']);
    assert.equal(pruneDefault.code, 0);
    const pd = JSON.parse(pruneDefault.stdout);
    assert.equal(pd.prunedCount, 1);
    assert.equal(pd.pruned[0].rule, 'F-001');
    assert.equal(pd.skippedSharedCount, 1);
    assert.equal(pd.skippedShared[0].rule, 'T-002');

    // `ignores prune --yes` prunes `T-002` (`proven-unused`) while keeping `T-009` (`unknown` review-only rule!)
    const pruneYes = await run(['ignores', 'prune', '--yes', '--json']);
    assert.equal(pruneYes.code, 0);
    const py = JSON.parse(pruneYes.stdout);
    assert.equal(py.prunedCount, 1);
    assert.equal(py.pruned[0].rule, 'T-002');
    assert.equal(py.keptCount, 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('config/context/detect/ignores regressions: root build/ skip, non-glob F-* waivers, used/excluded prune safety, and strict JSON hook check', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aux-cfg-reg-'));
  try {
    // 1. `detect .` skips root-level `build/` and `node_modules/`
    fs.mkdirSync(path.join(tmpDir, 'build', 'generated'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'build', 'generated', 'Gen.kt'),
      `package gen
import androidx.compose.runtime.*
@Composable fun Gen() { LaunchedEffect(Unit) { withFrameNanos { } } }
`,
      'utf8'
    );
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'App.kt'),
      `package app
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
@Composable fun App() { Widget(tween(250)) }
`,
      'utf8'
    );
    fs.mkdirSync(path.join(tmpDir, 'src', 'excluded'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'excluded', 'Ignored.kt'),
      `package app
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
@Composable fun Ignored() { Widget(tween(250)) }
`,
      'utf8'
    );

    const run = async (argv) => {
      let stdout = '';
      let stderr = '';
      const code = await runCli(argv, {
        cwd: tmpDir,
        env: process.env,
        stdout: { write: (s) => { stdout += s; } },
        stderr: { write: (s) => { stderr += s; } },
      });
      return { code, stdout, stderr };
    };

    const detDot = await run(['detect', '.', '--json']);
    const detJson = JSON.parse(detDot.stdout);
    assert.equal(detJson.findings.some((f) => f.rule === 'F-005'), false, 'Root build/ directory must be skipped on detect .');

    // 2. Glob rejected on floor/obligation `--kind false-positive`
    const badGlobFloor = await run(['ignores', 'add', 'F-005', '--kind', 'false-positive', '--file', 'src/*.kt', '--reason', 'No globs']);
    assert.equal(badGlobFloor.code, 1);

    // 3. Active `used` waiver + waiver targeting `ignoreFiles`-excluded file must NEVER be pruned!
    assert.equal((await run(['ignores', 'add', 'T-002', '--file', 'src/App.kt', '--shared', '--reason', 'Active used waiver'])).code, 0);
    assert.equal((await run(['ignores', 'add', 'T-002', '--file', 'src/excluded/Ignored.kt', '--shared', '--reason', 'Excluded file waiver'])).code, 0);
    const cfgPath = path.join(tmpDir, '.android-ux', 'config.json');
    const cfgObj = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    cfgObj.ignoreFiles = ['src/excluded/**'];
    fs.writeFileSync(cfgPath, `${JSON.stringify(cfgObj, null, 2)}\n`, 'utf8');

    const pruneRes = await run(['ignores', 'prune', '--yes', '--json']);
    const pj = JSON.parse(pruneRes.stdout);
    assert.equal(pj.prunedCount, 0, 'Neither active used waivers nor ignoreFiles-excluded waivers may be pruned');
    assert.equal(pj.keptCount, 2);

    // 4. Unrelated `"android-ux"` mention in `.claude/settings.json` must NOT suppress `MANUAL_DETECTOR_REQUIRED`
    fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.claude', 'settings.json'),
      JSON.stringify({ env: { NOTE: 'mentioning android-ux without any hook entry' } }),
      'utf8'
    );
    const ctxRes = await run(['context', '--json']);
    const ctxObj = JSON.parse(ctxRes.stdout);
    assert.equal(ctxObj.hooks.active, false);
    assert.equal(ctxObj.directives.includes('MANUAL_DETECTOR_REQUIRED'), true);

    // 5. Oversized (> 4 MiB) skipped Lottie `.json` asset MUST report waiver usageStatus='unknown'
    //    (NEVER 'proven-unused') and `ignores prune` MUST preserve the waiver untouched!
    const rawDir = path.join(tmpDir, 'src', 'main', 'res', 'raw');
    fs.mkdirSync(rawDir, { recursive: true });
    const hugeLottiePath = path.join(rawDir, 'huge_hero.json');
    const padStr = 'x'.repeat(4 * 1024 * 1024 + 512);
    fs.writeFileSync(
      hugeLottiePath,
      JSON.stringify({
        v: '5.7.4',
        fr: 60,
        ip: 0,
        op: 60,
        nm: padStr,
        layers: [{ ty: 4, ip: 0, op: 30, ks: { o: { a: 0, k: 100 } } }],
      }),
      'utf8'
    );
    assert.equal(
      (
        await run([
          'ignores',
          'add',
          'O-002',
          '--kind',
          'false-positive',
          '--file',
          'src/main/res/raw/huge_hero.json',
          '--local',
          '--reason',
          'Oversized hero Lottie asset verified manually',
        ])
      ).code,
      0
    );

    const scanHuge = runStaticScan({ targets: [tmpDir], cwd: tmpDir });
    const hugeWaiverAudit = scanHuge.waiverAudit.find((a) => a.waiver.rule === 'O-002');
    assert.ok(hugeWaiverAudit, 'Expected O-002 waiver in waiverAudit');
    assert.equal(
      hugeWaiverAudit.usageStatus,
      'unknown',
      `Skipped >4 MiB Lottie asset waiver must have usageStatus='unknown', got: ${JSON.stringify(hugeWaiverAudit)}`
    );

    const detHuge = JSON.parse((await run(['detect', '.', '--report-unused-ignores', '--json'])).stdout);
    assert.equal(
      (detHuge.diagnostics || []).some((d) => String(d.summary || '').includes('O-002')),
      false,
      `detect --report-unused-ignores must not flag O-002 waiver on skipped >4 MiB Lottie asset, got: ${JSON.stringify(detHuge.diagnostics)}`
    );

    const listHuge = JSON.parse((await run(['ignores', 'list', '--json'])).stdout);
    const listedO002 = listHuge.waivers.find((w) => w.rule === 'O-002');
    assert.equal(listedO002.usageStatus, 'unknown');

    const pruneWithHuge = JSON.parse((await run(['ignores', 'prune', '--yes', '--json'])).stdout);
    assert.equal(
      pruneWithHuge.pruned.some((p) => p.rule === 'O-002'),
      false,
      `ignores prune must preserve O-002 waiver on skipped >4 MiB Lottie asset, got: ${JSON.stringify(pruneWithHuge)}`
    );
    assert.equal(pruneWithHuge.keptCount, 3, 'All 3 waivers (used T-002, excluded T-002, skipped >4 MiB O-002) must be kept');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
