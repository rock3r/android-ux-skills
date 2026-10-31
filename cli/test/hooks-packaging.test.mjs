import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
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

test('PR review regressions: malformed manifest preservation (hooks install/uninstall + install) and third-party skill isolation on standalone update', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aux-pr-reg-'));
  try {
    // 1. Truncated/malformed `.claude/settings.local.json` MUST NOT be overwritten by `hooks install`, `hooks uninstall`, or `install`
    const corruptProj = path.join(tmpDir, 'corrupt-proj');
    const claudeDir = path.join(corruptProj, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    const manifestPath = path.join(claudeDir, 'settings.local.json');
    const truncatedJson = '{\n  "permissions": { "allow": ["Bash(git status)"] },\n  "env": { "FOO": "bar"';
    fs.writeFileSync(manifestPath, truncatedJson, 'utf8');

    const runCmd = async (argv, cwd = corruptProj) => {
      let stdout = '';
      let stderr = '';
      const code = await runCli(argv, {
        cwd,
        env: process.env,
        stdout: { write: (s) => { stdout += s; } },
        stderr: { write: (s) => { stderr += s; } },
      });
      return { code, stdout, stderr };
    };

    const installHookRes = await runCmd(['hooks', 'install', '--providers', 'claude']);
    assert.equal(installHookRes.code, 1, 'hooks install must fail with exit 1 on malformed manifest');
    assert.match(installHookRes.stderr, /Refusing to overwrite malformed JSON manifest/);
    assert.equal(fs.readFileSync(manifestPath, 'utf8'), truncatedJson, 'Truncated manifest bytes must remain untouched on hooks install');

    const uninstallHookRes = await runCmd(['hooks', 'uninstall', '--providers', 'claude']);
    assert.equal(uninstallHookRes.code, 1, 'hooks uninstall must fail with exit 1 on malformed manifest');
    assert.match(uninstallHookRes.stderr, /Refusing to overwrite malformed JSON manifest/);
    assert.equal(fs.readFileSync(manifestPath, 'utf8'), truncatedJson, 'Truncated manifest bytes must remain untouched on hooks uninstall');

    const fullInstallRes = await runCmd(['install', '--providers', 'claude']);
    assert.equal(fullInstallRes.code, 1, 'install must fail with exit 1 on malformed manifest');
    assert.equal(fs.readFileSync(manifestPath, 'utf8'), truncatedJson, 'Truncated manifest bytes must remain untouched on install');

    // Non-object JSON (`[]`) must also be rejected without overwriting
    const arrayJson = '["do-not-clobber"]\n';
    fs.writeFileSync(manifestPath, arrayJson, 'utf8');
    const arrayRes = await runCmd(['hooks', 'install', '--providers', 'claude']);
    assert.equal(arrayRes.code, 1);
    assert.equal(fs.readFileSync(manifestPath, 'utf8'), arrayJson);

    // Valid `.claude/settings.local.json`: `hooks install` + `hooks uninstall` preserves permissions, env, and custom hooks
    const validSettings = {
      permissions: { allow: ['Bash(git status)'] },
      env: { KEEP_ME: '1' },
      hooks: {
        PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo keep-user-hook' }] }],
      },
    };
    fs.writeFileSync(manifestPath, `${JSON.stringify(validSettings, null, 2)}\n`, 'utf8');
    assert.equal((await runCmd(['hooks', 'install', '--providers', 'claude'])).code, 0);
    assert.match(fs.readFileSync(manifestPath, 'utf8'), /android-ux/);
    assert.equal((await runCmd(['hooks', 'uninstall', '--providers', 'claude'])).code, 0);
    const afterUninstall = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.deepEqual(afterUninstall, validSettings, 'hooks uninstall must restore unrelated permissions, env, and custom hooks intact');

    // 2. Standalone installed bundle `update --providers cursor --no-hooks` MUST NOT copy or clobber sibling third-party skills!
    const sharedProj = path.join(tmpDir, 'shared-skills-proj');
    fs.mkdirSync(path.join(sharedProj, '.claude'), { recursive: true });
    fs.mkdirSync(path.join(sharedProj, '.cursor'), { recursive: true });
    assert.equal((await runCmd(['install', '--providers', 'claude', '--no-hooks'], sharedProj)).code, 0);

    // Add a third-party skill in `.claude/skills/third-party-skill` AND a customized version in `.cursor/skills/third-party-skill`
    const claudeThirdParty = path.join(sharedProj, '.claude', 'skills', 'third-party-skill');
    const cursorThirdParty = path.join(sharedProj, '.cursor', 'skills', 'third-party-skill');
    const claudeUnlistedOnly = path.join(sharedProj, '.claude', 'skills', 'claude-only-custom');
    fs.mkdirSync(claudeThirdParty, { recursive: true });
    fs.mkdirSync(cursorThirdParty, { recursive: true });
    fs.mkdirSync(claudeUnlistedOnly, { recursive: true });
    fs.writeFileSync(path.join(claudeThirdParty, 'SKILL.md'), '---\nname: third-party-skill\n---\nCLAUDE VERSION\n', 'utf8');
    fs.writeFileSync(path.join(cursorThirdParty, 'SKILL.md'), '---\nname: third-party-skill\n---\nCURSOR CUSTOMIZED VERSION\n', 'utf8');
    fs.writeFileSync(path.join(claudeUnlistedOnly, 'SKILL.md'), '---\nname: claude-only-custom\n---\nPRIVATE\n', 'utf8');

    const claudeLauncher = path.join(sharedProj, '.claude', 'skills', 'animate-compose', 'scripts', 'android-ux');
    const crossUpdate = spawnSync('sh', [claudeLauncher, 'update', '--providers', 'cursor', '--no-hooks'], {
      cwd: sharedProj,
      encoding: 'utf8',
    });
    assert.equal(crossUpdate.status, 0, `Standalone cross-provider update failed: ${crossUpdate.stderr}`);
    assert.equal(
      fs.existsSync(path.join(sharedProj, '.cursor', 'skills', 'animate-compose', 'SKILL.md')),
      true,
      'Android UX skills must be installed into .cursor/skills'
    );
    assert.equal(
      fs.readFileSync(path.join(cursorThirdParty, 'SKILL.md'), 'utf8'),
      '---\nname: third-party-skill\n---\nCURSOR CUSTOMIZED VERSION\n',
      'Customized Cursor third-party skill must NOT be overwritten by Claude sibling skill'
    );
    assert.equal(
      fs.existsSync(path.join(sharedProj, '.cursor', 'skills', 'claude-only-custom')),
      false,
      'Unrelated sibling skills in .claude/skills must NOT be copied into .cursor/skills'
    );

    // 3. Single-skill standalone install (only `review-android-motion` present, no `animate-compose`):
    //    `install --providers claude` and `hooks install` MUST wire hooks to the actually installed skill launcher!
    const singleSourceSkills = path.join(tmpDir, 'single-source-skills');
    const singleReviewSrc = path.join(singleSourceSkills, 'review-android-motion');
    fs.cpSync(path.join(REPO_ROOT, 'skills', 'review-android-motion'), singleReviewSrc, {
      recursive: true,
      filter: (src) => !src.includes(`${path.sep}evals`),
    });
    const singleTargetProj = path.join(tmpDir, 'single-skill-proj');
    fs.mkdirSync(singleTargetProj, { recursive: true });

    const singleInstall = spawnSync(
      'sh',
      [path.join(singleReviewSrc, 'scripts', 'android-ux'), 'install', '--providers', 'claude'],
      { cwd: singleTargetProj, encoding: 'utf8' }
    );
    assert.equal(singleInstall.status, 0, `Single-skill install failed: ${singleInstall.stderr}`);

    const expectedLauncherRel = '.claude/skills/review-android-motion/scripts/android-ux';
    const expectedLauncherAbs = path.join(singleTargetProj, '.claude', 'skills', 'review-android-motion', 'scripts', 'android-ux');
    assert.equal(fs.existsSync(expectedLauncherAbs), true, 'Installed review-android-motion launcher must exist on disk');
    assert.equal(
      fs.existsSync(path.join(singleTargetProj, '.claude', 'skills', 'animate-compose')),
      false,
      'animate-compose must not exist in single-skill target'
    );

    const singleManifest = JSON.parse(
      fs.readFileSync(path.join(singleTargetProj, '.claude', 'settings.local.json'), 'utf8')
    );
    const wiredCmd = singleManifest.hooks.PostToolUse[0].hooks[0].command;
    assert.match(wiredCmd, /review-android-motion\/scripts\/android-ux/, `Hook command must target review-android-motion, got: ${wiredCmd}`);
    assert.doesNotMatch(wiredCmd, /animate-compose/, 'Hook command must not point to missing animate-compose');

    const statusOut = await runCmd(['hooks', 'status', '--json'], singleTargetProj);
    assert.equal(JSON.parse(statusOut.stdout).active, true, 'hooks status must report active=true on single-skill install');

    // `hooks uninstall` + `hooks install` (without `--providers`) must also auto-detect `review-android-motion`
    assert.equal((await runCmd(['hooks', 'uninstall'], singleTargetProj)).code, 0);
    assert.equal((await runCmd(['hooks', 'install'], singleTargetProj)).code, 0);
    const rewiredManifest = JSON.parse(
      fs.readFileSync(path.join(singleTargetProj, '.claude', 'settings.local.json'), 'utf8')
    );
    assert.match(rewiredManifest.hooks.PostToolUse[0].hooks[0].command, /review-android-motion\/scripts\/android-ux/);

    // 4. Copilot `.github/hooks/android-ux.json`: `hooks install`, `install`, and `hooks uninstall`
    //    must preserve pre-existing custom `sessionStart` and `postToolUse` entries (and top-level fields),
    //    and reject malformed non-object `hooks` fields without overwriting!
    const copilotProj = path.join(tmpDir, 'copilot-merge-proj');
    const copilotManifestPath = path.join(copilotProj, '.github', 'hooks', 'android-ux.json');
    fs.mkdirSync(path.dirname(copilotManifestPath), { recursive: true });

    const malformedHooksField = '{\n  "version": 1,\n  "hooks": ["bad-array"]\n}\n';
    fs.writeFileSync(copilotManifestPath, malformedHooksField, 'utf8');
    const badCopilotInstall = await runCmd(['hooks', 'install', '--providers', 'copilot'], copilotProj);
    assert.equal(badCopilotInstall.code, 1, 'hooks install must refuse non-object hooks field');
    assert.match(badCopilotInstall.stderr, /"hooks" field must be a JSON object/);
    assert.equal(fs.readFileSync(copilotManifestPath, 'utf8'), malformedHooksField);

    const existingCopilotManifest = {
      version: 1,
      customNote: 'keep-me',
      hooks: {
        sessionStart: [
          { type: 'command', bash: 'echo custom-session-start', timeoutSec: 5 },
        ],
        postToolUse: [
          { type: 'command', matcher: 'bash', bash: 'echo custom-post-tool', timeoutSec: 5 },
        ],
      },
    };
    fs.writeFileSync(copilotManifestPath, `${JSON.stringify(existingCopilotManifest, null, 2)}\n`, 'utf8');

    assert.equal((await runCmd(['hooks', 'install', '--providers', 'copilot'], copilotProj)).code, 0);
    const afterHooksInstall = JSON.parse(fs.readFileSync(copilotManifestPath, 'utf8'));
    assert.equal(afterHooksInstall.customNote, 'keep-me');
    assert.deepEqual(
      afterHooksInstall.hooks.sessionStart,
      existingCopilotManifest.hooks.sessionStart,
      'hooks install --providers copilot must preserve custom sessionStart hooks'
    );
    assert.equal(
      afterHooksInstall.hooks.postToolUse.length,
      2,
      `Expected custom + android-ux postToolUse entries, got: ${JSON.stringify(afterHooksInstall.hooks.postToolUse)}`
    );
    assert.deepEqual(afterHooksInstall.hooks.postToolUse[0], existingCopilotManifest.hooks.postToolUse[0]);
    assert.match(afterHooksInstall.hooks.postToolUse[1].bash, /android-ux.*hook/);

    // Full `install --providers copilot` must idempotently replace only the android-ux entry and activate hooks status
    assert.equal((await runCmd(['install', '--providers', 'copilot'], copilotProj)).code, 0);
    const afterFullInstall = JSON.parse(fs.readFileSync(copilotManifestPath, 'utf8'));
    assert.deepEqual(afterFullInstall.hooks.sessionStart, existingCopilotManifest.hooks.sessionStart);
    assert.equal(afterFullInstall.hooks.postToolUse.length, 2, 'Idempotent install must not duplicate android-ux hook');
    assert.deepEqual(afterFullInstall.hooks.postToolUse[0], existingCopilotManifest.hooks.postToolUse[0]);
    const copilotStatusActive = JSON.parse((await runCmd(['hooks', 'status', '--json'], copilotProj)).stdout);
    assert.equal(copilotStatusActive.active, true, 'hooks status must detect active Copilot hook manifest');

    // `hooks uninstall --providers copilot` must keep the file on disk and retain both custom entries!
    assert.equal((await runCmd(['hooks', 'uninstall', '--providers', 'copilot'], copilotProj)).code, 0);
    assert.equal(fs.existsSync(copilotManifestPath), true, 'Copilot manifest with custom hooks must NOT be deleted on uninstall');
    const afterCopilotUninstall = JSON.parse(fs.readFileSync(copilotManifestPath, 'utf8'));
    assert.deepEqual(
      afterCopilotUninstall,
      existingCopilotManifest,
      'hooks uninstall --providers copilot must restore custom sessionStart, postToolUse, and top-level keys intact'
    );
    const copilotStatusInactive = JSON.parse((await runCmd(['hooks', 'status', '--json'], copilotProj)).stdout);
    assert.equal(copilotStatusInactive.active, false, 'hooks status must report inactive after uninstalling android-ux entry');

    // 5. User hooks whose path happens to contain `android-ux` (e.g. `bash /home/me/android-ux-skills/scripts/check-skills.sh`)
    //    must NEVER be deleted by `hooks install` or `hooks uninstall` across claude, codex, cursor, and copilot!
    const customHookCmd = 'bash /home/me/android-ux-skills/scripts/check-skills.sh';
    const narrowProj = path.join(tmpDir, 'narrow-ownership-proj');
    const claudeNarrowPath = path.join(narrowProj, '.claude', 'settings.local.json');
    const codexNarrowPath = path.join(narrowProj, '.codex', 'hooks.json');
    const cursorNarrowPath = path.join(narrowProj, '.cursor', 'hooks.json');
    const copilotNarrowPath = path.join(narrowProj, '.github', 'hooks', 'android-ux.json');

    fs.mkdirSync(path.dirname(claudeNarrowPath), { recursive: true });
    fs.mkdirSync(path.dirname(codexNarrowPath), { recursive: true });
    fs.mkdirSync(path.dirname(cursorNarrowPath), { recursive: true });
    fs.mkdirSync(path.dirname(copilotNarrowPath), { recursive: true });

    const seedClaudeOrCodex = {
      hooks: {
        PostToolUse: [
          {
            matcher: 'Edit|Write',
            hooks: [{ type: 'command', command: customHookCmd, timeout: 10 }],
          },
        ],
      },
    };
    const seedCursor = {
      version: 1,
      hooks: {
        postToolUse: [{ command: customHookCmd, matcher: '^Write$', timeout: 10 }],
      },
    };
    const seedCopilot = {
      version: 1,
      hooks: {
        postToolUse: [{ type: 'command', matcher: 'edit', bash: customHookCmd, timeoutSec: 10 }],
      },
    };

    fs.writeFileSync(claudeNarrowPath, `${JSON.stringify(seedClaudeOrCodex, null, 2)}\n`, 'utf8');
    fs.writeFileSync(codexNarrowPath, `${JSON.stringify(seedClaudeOrCodex, null, 2)}\n`, 'utf8');
    fs.writeFileSync(cursorNarrowPath, `${JSON.stringify(seedCursor, null, 2)}\n`, 'utf8');
    fs.writeFileSync(copilotNarrowPath, `${JSON.stringify(seedCopilot, null, 2)}\n`, 'utf8');

    assert.equal(
      (await runCmd(['hooks', 'install', '--providers', 'claude,codex,cursor,copilot'], narrowProj)).code,
      0
    );
    for (const mp of [claudeNarrowPath, codexNarrowPath, cursorNarrowPath, copilotNarrowPath]) {
      assert.equal(
        fs.readFileSync(mp, 'utf8').includes(customHookCmd),
        true,
        `hooks install must preserve user hook containing "android-ux" in path (${mp})`
      );
    }

    assert.equal(
      (await runCmd(['hooks', 'uninstall', '--providers', 'claude,codex,cursor,copilot'], narrowProj)).code,
      0
    );
    assert.deepEqual(JSON.parse(fs.readFileSync(claudeNarrowPath, 'utf8')), seedClaudeOrCodex);
    assert.deepEqual(JSON.parse(fs.readFileSync(codexNarrowPath, 'utf8')), seedClaudeOrCodex);
    assert.deepEqual(JSON.parse(fs.readFileSync(cursorNarrowPath, 'utf8')), seedCursor);
    assert.deepEqual(JSON.parse(fs.readFileSync(copilotNarrowPath, 'utf8')), seedCopilot);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('multi-root workspaces: Jetski workspacePaths/workspaceUris and Cursor workspace_roots resolve owning root config, session cache, and boundary prefixes', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aux-multiroot-'));
  try {
    const env = { ...process.env, XDG_CACHE_HOME: path.join(tmpDir, 'cache') };
    const rootA = path.join(tmpDir, 'repo');
    const rootB = path.join(tmpDir, 'repo-two');
    const outsideSibling = path.join(tmpDir, 'repo-three');
    fs.mkdirSync(rootA, { recursive: true });
    fs.mkdirSync(rootB, { recursive: true });
    fs.mkdirSync(outsideSibling, { recursive: true });

    // Disable hooks in rootA (`roots[0]`), keep enabled in rootB (`roots[1]`)!
    fs.mkdirSync(path.join(rootA, '.android-ux'), { recursive: true });
    fs.writeFileSync(
      path.join(rootA, '.android-ux', 'config.json'),
      JSON.stringify({ hook: { enabled: false } }, null, 2),
      'utf8'
    );

    const badKotlin = `package multi
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
@Composable fun Feature(active: Boolean) {
    val a by animateFloatAsState(if (active) 1f else 0f)
    Box(Modifier.alpha(a))
}
`;
    const fileInA = path.join(rootA, 'FeatureA.kt');
    const fileInB = path.join(rootB, 'FeatureB.kt');
    const fileInOutside = path.join(outsideSibling, 'Outside.kt');
    fs.writeFileSync(fileInA, badKotlin, 'utf8');
    fs.writeFileSync(fileInB, badKotlin, 'utf8');
    fs.writeFileSync(fileInOutside, badKotlin, 'utf8');

    // 0. Sanity: editing `fileInA` inside disabled `rootA` is skipped as `config-disabled`
    const disabledRootARes = executeHookPayload(
      JSON.stringify({
        conversationId: 'mr-0',
        workspacePaths: [rootA, rootB],
        stepIdx: 1,
        toolCall: { name: 'edit_file', args: { Path: fileInA } },
      }),
      { cwd: rootA, env, platform: 'linux' }
    );
    assert.equal(disabledRootARes.skipped, 'config-disabled');

    // 1. Prefix-collision check: `/repo-three/Outside.kt` must NOT match `/repo` (`[rootA]`)
    const prefixCollisionRes = executeHookPayload(
      JSON.stringify({
        conversationId: 'mr-1',
        workspacePaths: [rootA],
        stepIdx: 1,
        toolCall: { name: 'edit_file', args: { Path: fileInOutside } },
      }),
      { cwd: rootA, env, platform: 'linux' }
    );
    assert.equal(prefixCollisionRes.skipped, 'config-disabled');

    // Also when rootA is enabled, `/repo-two/FeatureB.kt` must not match `[rootA]` via naive startsWith('/repo')
    const rootC = path.join(tmpDir, 'app');
    const rootCSibling = path.join(tmpDir, 'app-extra');
    fs.mkdirSync(rootC, { recursive: true });
    fs.mkdirSync(rootCSibling, { recursive: true });
    const siblingFile = path.join(rootCSibling, 'Sib.kt');
    fs.writeFileSync(siblingFile, badKotlin, 'utf8');
    const sibRes = executeHookPayload(
      JSON.stringify({
        conversationId: 'mr-sib',
        workspacePaths: [rootC],
        stepIdx: 1,
        toolCall: { name: 'edit_file', args: { Path: siblingFile } },
      }),
      { cwd: rootC, env, platform: 'linux' }
    );
    assert.equal(sibRes.skipped, 'no-scannable-file', 'Sibling directory sharing string prefix must not match root');

    // 2. Multi-root Jetski `workspacePaths: [rootA, rootB]`: editing `fileInB` uses `rootB` (enabled), NOT `rootA` (disabled)!
    const jetPost = executeHookPayload(
      JSON.stringify({
        conversationId: 'mr-jet',
        workspacePaths: [rootA, rootB],
        stepIdx: 2,
        toolCall: { name: 'edit_file', args: { Path: fileInB } },
      }),
      { cwd: rootA, env, platform: 'linux' }
    );
    assert.equal(jetPost.skipped, undefined, 'Edit in roots[1] must not be skipped as no-scannable-file or config-disabled');
    assert.deepEqual(jetPost.payload, {});

    const jetPre = executeHookPayload(
      JSON.stringify({
        conversationId: 'mr-jet',
        workspacePaths: [rootA, rootB],
        invocationNum: 2,
      }),
      { cwd: rootA, env, platform: 'linux' }
    );
    assert.equal(jetPre.emitted, true, 'PreInvocation must flush findings queued under roots[1]');
    assert.match(jetPre.payload.injectSteps[0].ephemeralMessage, /FeatureB\.kt.*\[F-001\]/);

    // 3. Multi-root Jetski `workspaceUris` (`file://` URIs) also resolves `roots[1]`
    const file2InB = path.join(rootB, 'SecondB.kt');
    fs.writeFileSync(file2InB, badKotlin, 'utf8');
    executeHookPayload(
      JSON.stringify({
        conversationId: 'mr-uri',
        workspaceUris: [pathToFileURL(rootA).href, pathToFileURL(rootB).href],
        stepIdx: 5,
        toolCall: { name: 'write_file', args: { Path: file2InB } },
      }),
      { cwd: rootA, env, platform: 'linux' }
    );
    const jetUriPre = executeHookPayload(
      JSON.stringify({
        conversationId: 'mr-uri',
        workspaceUris: [pathToFileURL(rootA).href, pathToFileURL(rootB).href],
        invocationNum: 2,
      }),
      { cwd: rootA, env, platform: 'linux' }
    );
    assert.equal(jetUriPre.emitted, true);
    assert.match(jetUriPre.payload.injectSteps[0].ephemeralMessage, /SecondB\.kt.*\[F-001\]/);

    // 4. Multi-root Cursor `workspace_roots: [rootA, rootB]` resolves `roots[1]` immediately
    const cursorMulti = executeHookPayload(
      JSON.stringify({
        conversation_id: 'mr-cur',
        workspace_roots: [rootA, rootB],
        tool_name: 'edit_file',
        tool_use_id: 'cur-mr-1',
        file_path: fileInB,
      }),
      { cwd: rootA, env, platform: 'linux' }
    );
    assert.equal(cursorMulti.emitted, true, 'Cursor multi-root edit in workspace_roots[1] must emit findings');
    assert.match(cursorMulti.payload.additional_context, /FeatureB\.kt.*\[F-001\]/);

    // 5. Object-valued `toolArgs: { patch: "*** Begin Patch..." }` (Copilot) and string `tool_input` (Codex) extract patched files
    const patchBody = `*** Begin Patch\n*** Update File: FeatureB.kt\n@@\n*** End Patch\n`;
    const copilotObjPatch = executeHookPayload(
      JSON.stringify({
        hookEventName: 'postToolUse',
        sessionId: 'cop-obj-patch',
        toolName: 'apply_patch',
        toolUseId: 'cop-tu-1',
        cwd: rootB,
        toolArgs: { patch: patchBody },
      }),
      { cwd: rootB, env, platform: 'linux' }
    );
    assert.equal(copilotObjPatch.emitted, true, 'Object-valued toolArgs.patch must extract target file');
    assert.match(copilotObjPatch.payload.additionalContext, /FeatureB\.kt.*\[F-001\]/);

    const codexStrPatch = executeHookPayload(
      JSON.stringify({
        hook_event_name: 'PostToolUse',
        session_id: 'codex-str-patch',
        tool_name: 'apply_patch',
        tool_use_id: 'cdx-tu-1',
        cwd: rootB,
        tool_input: patchBody,
      }),
      { cwd: rootB, env: { ...env, ANDROID_UX_HOOK_HARNESS: 'codex' }, platform: 'linux' }
    );
    assert.equal(codexStrPatch.emitted, true, 'String-valued tool_input apply_patch must extract target file');
    assert.match(codexStrPatch.payload.hookSpecificOutput.additionalContext, /FeatureB\.kt.*\[F-001\]/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
