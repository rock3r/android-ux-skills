import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { executeHookPayload, runCli } from '../src/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

test('hook protocol: fail-open exit 0, loop guards, multi-harness envelopes, git HEAD preimage diffing, 6-edit cap, and non-blocking Stop', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aux-hook-'));
  try {
    const cacheRoot = path.join(tmpDir, 'xdg-cache');
    const repoDir = path.join(tmpDir, 'repo');
    fs.mkdirSync(repoDir, { recursive: true });

    const env = {
      ...process.env,
      XDG_CACHE_HOME: cacheRoot,
    };

    // 1. Empty / malformed stdin and loop guards always return exitCode 0 & `{}`
    assert.deepEqual(executeHookPayload('', { cwd: repoDir, env }), {
      exitCode: 0,
      payload: {},
      skipped: 'stdin-empty',
    });
    assert.deepEqual(executeHookPayload('{broken-json', { cwd: repoDir, env }), {
      exitCode: 0,
      payload: {},
      skipped: 'stdin-malformed',
    });
    assert.deepEqual(
      executeHookPayload(JSON.stringify({ hook_event_name: 'PostToolUse' }), {
        cwd: repoDir,
        env: { ...env, ANDROID_UX_HOOK_DEPTH: '1' },
      }),
      { exitCode: 0, payload: {}, skipped: 'reentrant' }
    );
    assert.deepEqual(
      executeHookPayload(JSON.stringify({ hook_event_name: 'Stop', stop_hook_active: true }), {
        cwd: repoDir,
        env,
      }),
      { exitCode: 0, payload: {}, skipped: 'stop-hook-active' }
    );

    // 2. Initialize a git repo with a pre-existing legacy F-001 violation committed in HEAD
    execFileSync('git', ['init', '-q'], { cwd: repoDir });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoDir });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repoDir });
    execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: repoDir });

    const screenPath = path.join(repoDir, 'Screen.kt');
    const legacyCode = `package app.ui
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.layout.offset
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun LegacyPanel(open: Boolean) {
    val x by animateDpAsState(if (open) 0.dp else 40.dp)
    Box(Modifier.offset(x = x))
}
`;
    fs.writeFileSync(screenPath, legacyCode, 'utf8');
    fs.writeFileSync(
      path.join(repoDir, 'MOTION.md'),
      '# Motion Contract\n\n## Specs\n### Fade\n- **Tag** — `DECIDED`\n- **Intent** — Fast fade.\n- **Binding** — `MaterialTheme.motionScheme.fastEffectsSpec()`\n',
      'utf8'
    );
    execFileSync('git', ['add', 'Screen.kt', 'MOTION.md'], { cwd: repoDir });
    execFileSync('git', ['commit', '-q', '--no-gpg-sign', '--no-verify', '-m', 'init'], { cwd: repoDir });

    // Edit Screen.kt WITHOUT `originalFile` in `tool_response`: `git show HEAD:Screen.kt` fallback
    // must suppress the pre-existing `LegacyPanel` F-001 violation while catching a newly added `T-002`!
    const editedCode = `${legacyCode}
@Composable
fun NewBanner(active: Boolean) {
    val alpha by androidx.compose.animation.core.animateFloatAsState(
        targetValue = if (active) 1f else 0f,
        animationSpec = androidx.compose.animation.core.tween(250)
    )
}
`;
    fs.writeFileSync(screenPath, editedCode, 'utf8');

    const postEvent = {
      hook_event_name: 'PostToolUse',
      session_id: 'sess-1',
      tool_use_id: 'tu-100',
      cwd: repoDir,
      tool_name: 'Edit',
      tool_input: { file_path: screenPath },
      tool_response: {}, // No originalFile -> exercises git HEAD preimage fallback!
    };

    const firstRun = executeHookPayload(JSON.stringify(postEvent), { cwd: repoDir, env, platform: 'linux' });
    assert.equal(firstRun.exitCode, 0);
    assert.equal(firstRun.emitted, true);
    const contextText = firstRun.payload.hookSpecificOutput.additionalContext;
    assert.match(contextText, /\[T-002\]/);
    assert.doesNotMatch(contextText, /\[F-001\]/, 'Pre-existing HEAD violation must be suppressed by git preimage baseline');

    // Duplicate `tool_use_id` across project + user manifests must be suppressed via atomic O_EXCL lock
    const dupRun = executeHookPayload(JSON.stringify(postEvent), { cwd: repoDir, env, platform: 'linux' });
    assert.equal(dupRun.skipped, 'duplicate-event');

    // Cursor, Copilot, and Jetski payload shapes
    const cursorRes = executeHookPayload(
      JSON.stringify({
        conversation_id: 'cur-1',
        workspace_roots: [repoDir],
        tool_name: 'edit_file',
        tool_use_id: 'cur-tu-1',
        file_path: screenPath,
      }),
      { cwd: repoDir, env, platform: 'linux' }
    );
    assert.ok(cursorRes.payload.additional_context);

    const jetskiPost = executeHookPayload(
      JSON.stringify({
        conversationId: 'jet-1',
        workspacePaths: [repoDir],
        stepIdx: 3,
        toolCall: { name: 'edit_file', args: { Path: screenPath } },
      }),
      { cwd: repoDir, env, platform: 'linux' }
    );
    assert.deepEqual(jetskiPost.payload, {});
    const jetskiPre = executeHookPayload(
      JSON.stringify({
        conversationId: 'jet-1',
        workspacePaths: [repoDir],
        invocationNum: 2,
      }),
      { cwd: repoDir, env, platform: 'linux' }
    );
    assert.ok(jetskiPre.payload.injectSteps?.[0]?.ephemeralMessage);

    // 3. `Stop` hook on Codex/Claude MUST emit non-blocking `{ systemMessage }` (`exit 0`), NEVER `decision: "block"`
    fs.writeFileSync(
      screenPath,
      `${editedCode}\n@Composable fun ThirdBad() { Widget(androidx.compose.animation.core.spring<Float>()) }\n`,
      'utf8'
    );
    const stopRes = executeHookPayload(
      JSON.stringify({
        hook_event_name: 'Stop',
        session_id: 'sess-1',
        cwd: repoDir,
      }),
      {
        cwd: repoDir,
        env: { ...env, ANDROID_UX_HOOK_HARNESS: 'codex' },
        platform: 'linux',
      }
    );
    assert.equal(stopRes.exitCode, 0);
    assert.equal(stopRes.payload.decision, undefined, 'Stop hook must NEVER emit decision: "block"');
    assert.match(stopRes.payload.systemMessage, /\[new\]/);

    // 4. 6-edit cap per file: edits 2..6 run, edit 7 emits one-time pause notice, edit 8 stays silent
    for (let i = 2; i <= 6; i += 1) {
      executeHookPayload(
        JSON.stringify({ ...postEvent, tool_use_id: `tu-${100 + i}` }),
        { cwd: repoDir, env, platform: 'linux' }
      );
    }
    const edit7 = executeHookPayload(
      JSON.stringify({ ...postEvent, tool_use_id: 'tu-107' }),
      { cwd: repoDir, env, platform: 'linux' }
    );
    assert.match(edit7.payload.hookSpecificOutput.additionalContext, /paused for Screen\.kt after 6 edits/);
    const edit8 = executeHookPayload(
      JSON.stringify({ ...postEvent, tool_use_id: 'tu-108' }),
      { cwd: repoDir, env, platform: 'linux' }
    );
    assert.deepEqual(edit8.payload, {});
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('install, hooks toggle, npm pack tarball allowlist, and isolated single-skill launcher execution', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aux-pack-'));
  try {
    // 1. `install --harness all` + `hooks off` + `hooks on` preserves neighboring user hooks
    const targetProject = path.join(tmpDir, 'app-project');
    fs.mkdirSync(path.join(targetProject, '.claude'), { recursive: true });
    fs.writeFileSync(
      path.join(targetProject, '.claude', 'settings.local.json'),
      JSON.stringify({
        hooks: {
          PostToolUse: [
            { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo custom-user-hook' }] },
          ],
        },
      }, null, 2),
      'utf8'
    );

    const runInTarget = async (argv) => {
      let stdout = '';
      const code = await runCli(argv, {
        cwd: targetProject,
        env: process.env,
        stdout: { write: (s) => { stdout += s; } },
        stderr: { write: () => {} },
      });
      return { code, stdout };
    };

    assert.equal((await runInTarget(['install', '--harness', 'all', '--json'])).code, 0);
    assert.equal(fs.existsSync(path.join(targetProject, '.cursor', 'hooks.json')), true);
    assert.equal(fs.existsSync(path.join(targetProject, '.codex', 'hooks.json')), true);
    assert.equal(fs.existsSync(path.join(targetProject, '.github', 'hooks', 'android-ux.json')), true);
    assert.equal(fs.existsSync(path.join(targetProject, '.gemini', 'hooks.json')), true);

    const claudeMerged = JSON.parse(fs.readFileSync(path.join(targetProject, '.claude', 'settings.local.json'), 'utf8'));
    assert.equal(
      JSON.stringify(claudeMerged).includes('custom-user-hook'),
      true,
      'Existing user hooks must be preserved during install'
    );

    assert.equal((await runInTarget(['hooks', 'off'])).code, 0);
    assert.equal((await runInTarget(['hooks', 'on'])).code, 0);

    // 2. Isolated single-skill folder execution (simulating `skills add rock3r/android-ux-skills@review-android-motion` without repo root or node_modules)
    const isolatedSkill = path.join(tmpDir, 'isolated-skill');
    fs.cpSync(path.join(REPO_ROOT, 'skills', 'review-android-motion'), isolatedSkill, {
      recursive: true,
      filter: (src) => !src.includes(`${path.sep}evals`),
    });
    const isolatedLauncher = path.join(isolatedSkill, 'scripts', 'android-ux');
    const launcherRes = spawnSync('sh', [isolatedLauncher, 'context', '--json'], {
      cwd: targetProject,
      encoding: 'utf8',
    });
    assert.equal(launcherRes.status, 0, `Isolated skill launcher failed: ${launcherRes.stderr}`);
    const ctxJson = JSON.parse(launcherRes.stdout);
    assert.equal(ctxJson.command, 'context');

    // 3. `npm pack` allowlist & standalone unpacked tarball execution without `node_modules`
    const packDir = path.join(tmpDir, 'pack');
    fs.mkdirSync(packDir, { recursive: true });
    const packProc = process.platform === 'win32'
      ? spawnSync(`npm.cmd pack --json --pack-destination "${packDir}"`, {
          cwd: REPO_ROOT,
          encoding: 'utf8',
          shell: true,
        })
      : spawnSync('npm', ['pack', '--json', '--pack-destination', packDir], {
          cwd: REPO_ROOT,
          encoding: 'utf8',
        });
    assert.equal(packProc.status, 0, `npm pack failed: ${packProc.stderr || packProc.error?.message}`);
    const packInfo = JSON.parse(packProc.stdout)[0];
    const packedPaths = packInfo.files.map((f) => f.path);

    assert.equal(packedPaths.some((p) => p.includes('/evals/')), false, 'Tarball must exclude evals/**');
    assert.equal(packedPaths.some((p) => p.endsWith('skill-source.json')), false, 'Tarball must exclude skill-source.json');
    assert.equal(packedPaths.some((p) => p.startsWith('cli/test/')), false, 'Tarball must exclude cli/test/**');
    assert.equal(packedPaths.includes('cli/bin/android-ux.mjs'), true);
    assert.equal(packedPaths.includes('skills/review-android-motion/scripts/android-ux.mjs'), true);

    const extractDir = path.join(tmpDir, 'extracted');
    fs.mkdirSync(extractDir, { recursive: true });
    execFileSync('tar', ['-xzf', path.posix.join('..', 'pack', packInfo.filename)], { cwd: extractDir });
    const pkgBin = path.join(extractDir, 'package', 'cli', 'bin', 'android-ux.mjs');
    const binRes = spawnSync(process.execPath, [pkgBin, 'detect', '--list-rules', '--quiet'], {
      cwd: targetProject,
      encoding: 'utf8',
    });
    assert.equal(binRes.status, 0);
    assert.match(binRes.stdout, /\bF-001\b/);
    assert.match(binRes.stdout, /\bT-028\b/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('hook & install regressions: line-shift-stable + ordinal fingerprints, self-update safety, single-quote path escaping, and launcher crash fail-open', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aux-hook-reg-'));
  try {
    const env = { ...process.env, XDG_CACHE_HOME: path.join(tmpDir, 'cache') };
    const proj = path.join(tmpDir, 'proj');
    fs.mkdirSync(proj, { recursive: true });
    const file = path.join(proj, 'Anim.kt');

    const preimage = `package demo
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
@Composable fun Screen(on: Boolean) {
    val a by animateFloatAsState(if (on) 1f else 0f)
    Box(Modifier.alpha(a))
}
`;
    // 1a. Shift lines down by adding comments/imports -> pre-existing F-001 must stay suppressed!
    const shifted = `// header line 1
// header line 2
${preimage}`;
    fs.writeFileSync(file, shifted, 'utf8');
    const rShift = executeHookPayload(
      JSON.stringify({
        hook_event_name: 'PostToolUse',
        session_id: 's-ord',
        tool_use_id: 'tu-1',
        cwd: proj,
        tool_name: 'Edit',
        tool_input: { file_path: file },
        tool_response: { originalFile: preimage },
      }),
      { cwd: proj, env, platform: 'linux' }
    );
    assert.equal(rShift.emitted, false, 'Line-number shift on pre-existing violation must not re-emit');

    // 1b. Add a SECOND identical `Box(Modifier.alpha(a))` -> ordinal #2 MUST emit!
    const duplicated = shifted.replace('Box(Modifier.alpha(a))', 'Box(Modifier.alpha(a))\n    Box(Modifier.alpha(a))');
    fs.writeFileSync(file, duplicated, 'utf8');
    const rDup = executeHookPayload(
      JSON.stringify({
        hook_event_name: 'PostToolUse',
        session_id: 's-ord',
        tool_use_id: 'tu-2',
        cwd: proj,
        tool_name: 'Edit',
        tool_input: { file_path: file },
        tool_response: {},
      }),
      { cwd: proj, env, platform: 'linux' }
    );
    assert.equal(rDup.emitted, true, 'Second identical F-001 occurrence in same file must be caught');
    assert.doesNotMatch(
      rDup.payload.hookSpecificOutput.additionalContext,
      /ignores add/,
      'Hook output must never instruct the agent to run ignores add itself'
    );

    // 2. Self-update in place (`sh .claude/skills/animate-compose/scripts/android-ux update`) must not delete itself!
    const selfProj = path.join(tmpDir, 'self-update-proj');
    fs.mkdirSync(path.join(selfProj, '.claude'), { recursive: true });
    await runCli(['install', '--providers', 'claude', '--no-hooks'], {
      cwd: selfProj,
      env: process.env,
      stdout: { write: () => {} },
      stderr: { write: () => {} },
    });
    const installedLauncher = path.join(selfProj, '.claude', 'skills', 'animate-compose', 'scripts', 'android-ux');
    const selfUpd = spawnSync('sh', [installedLauncher, 'update', '--providers', 'claude', '--no-hooks'], {
      cwd: selfProj,
      encoding: 'utf8',
    });
    assert.equal(selfUpd.status, 0, `Self-update failed: ${selfUpd.stderr}`);
    assert.equal(fs.existsSync(installedLauncher), true, 'Launcher must survive in-place self-update');

    // 3. Global path containing `$()` is single-quoted in generated POSIX hook command so sh never expands it
    const weirdHome = path.join(tmpDir, "home-$(echo-pwned)-'quote'");
    fs.mkdirSync(path.join(weirdHome, '.claude', 'skills', 'animate-compose'), { recursive: true });
    await runCli(['hooks', 'on', '--scope', 'global', '--providers', 'claude'], {
      cwd: selfProj,
      env: { ...process.env, HOME: weirdHome },
      platform: 'linux',
      stdout: { write: () => {} },
      stderr: { write: () => {} },
    });
    const globalSettings = JSON.parse(fs.readFileSync(path.join(weirdHome, '.claude', 'settings.json'), 'utf8'));
    const generatedCmd = globalSettings.hooks.PostToolUse[0].hooks[0].command;
    assert.equal(generatedCmd.startsWith("[ ! -f '"), true, `Expected single-quoted POSIX hook command, got: ${generatedCmd}`);

    // 4. Launcher fail-open `{}` on syntactically broken `android-ux.mjs` when invoked with `hook`
    const brokenDir = path.join(tmpDir, 'broken-skill', 'scripts');
    fs.mkdirSync(brokenDir, { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, 'cli', 'launcher', 'android-ux'), path.join(brokenDir, 'android-ux'));
    fs.writeFileSync(path.join(brokenDir, 'android-ux.mjs'), 'syntax error {{{{', 'utf8');
    const crashHook = spawnSync('sh', [path.join(brokenDir, 'android-ux'), 'hook'], {
      input: '{}',
      encoding: 'utf8',
    });
    assert.equal(crashHook.status, 0, 'Launcher must exit 0 on hook even if bundle fails to parse');
    assert.equal(crashHook.stdout.trim(), '{}', 'Launcher must emit valid {} JSON on hook crash');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
