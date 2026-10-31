import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runStaticScan, runCli } from '../src/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

const BATTERIES = [
  {
    skill: 'review-android-motion',
    file: 'skills/review-android-motion/evals/evals.json',
  },
  {
    skill: 'review-android-motion',
    file: 'skills/review-android-motion/evals/evals.established-language.json',
  },
  {
    skill: 'review-android-motion',
    file: 'skills/review-android-motion/evals/evals.phantom-language.json',
  },
  {
    skill: 'review-android-motion',
    file: 'skills/review-android-motion/evals/evals.stale-exception.json',
  },
  {
    skill: 'optimize-android-motion',
    file: 'skills/optimize-android-motion/evals/evals.json',
  },
];

// Rules whose non-conditional, non-semantic instances are mechanically proven by `detect`.
const PROVEN_DETECTOR_RULES = new Set([
  'F-001',
  'F-003',
  'F-006',
  'T-001',
  'T-002',
  'T-021',
]);

function spansOverlap(pathA, startA, endA, pathB, startB, endB) {
  return (
    path.basename(pathA) === path.basename(pathB) &&
    startA <= endB &&
    startB <= endA
  );
}

function itemOverlapsTarget(item, target) {
  const [iStart, iEnd] = item.lines || [1, 1];
  if (spansOverlap(item.file, iStart, iEnd, target.path, target.lines[0], target.lines[1])) {
    return true;
  }
  if (Array.isArray(item.alsoAt)) {
    for (const alt of item.alsoAt) {
      const [aStart, aEnd] = alt.lines || [1, 1];
      if (spansOverlap(alt.file, aStart, aEnd, target.path, target.lines[0], target.lines[1])) {
        return true;
      }
    }
  }
  if (Array.isArray(target.also_at)) {
    for (const alt of target.also_at) {
      if (spansOverlap(item.file, iStart, iEnd, alt.path, alt.lines[0], alt.lines[1])) {
        return true;
      }
    }
  }
  return false;
}

function stageEvalFiles(skillDir, relFiles) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aux-eval-case-'));
  for (const rel of relFiles) {
    const src = path.join(skillDir, rel);
    // Strip `evals/files/cXX/` prefix just like `scripts/run-evals.py` stages files for actors
    const stripped = rel.replace(/^evals\/files\/[^/]+\//, '');
    const dest = path.join(tmpDir, stripped);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
  return tmpDir;
}

for (const bat of BATTERIES) {
  const batPath = path.join(REPO_ROOT, bat.file);
  const skillDir = path.join(REPO_ROOT, 'skills', bat.skill);
  const data = JSON.parse(fs.readFileSync(batPath, 'utf8'));

  test(`battery ${bat.skill}/${data.battery}: zero false-positive findings and accurate spans across ${data.evals.length} cases`, () => {
    for (const ev of data.evals) {
      const workspace = stageEvalFiles(skillDir, ev.files || []);
      try {
        const res = runStaticScan({ targets: [workspace], cwd: workspace });
        const expected = ev.expect || [];
        const negatives = ev.negatives || [];
        const label = `[${bat.skill}/${data.battery} c${ev.id}: ${ev.title}]`;

        // 1. Match actual proven `findings[]` against `expect[]` using `run-evals.py` rules
        const matchedFindingIdx = new Set();
        const matchedExpectIdx = new Set();

        expected.forEach((exp, eIdx) => {
          const fIdx = res.findings.findIndex((f, idx) => {
            if (matchedFindingIdx.has(idx)) return false;
            return f.rule === exp.rule.toUpperCase() && itemOverlapsTarget(f, exp);
          });
          if (fIdx !== -1) {
            matchedFindingIdx.add(fIdx);
            matchedExpectIdx.add(eIdx);
            const hit = res.findings[fIdx];
            if (exp.class) {
              assert.equal(
                hit.class,
                exp.class,
                `${label} wrong class on ${hit.rule}: expected ${exp.class}, got ${hit.class}`
              );
            }
            if (exp.severity) {
              assert.equal(
                hit.severity,
                exp.severity,
                `${label} wrong severity on ${hit.rule}: expected ${exp.severity}, got ${hit.severity}`
              );
            }
            // Must never blanket a declared-clean `negatives` span
            for (const neg of negatives) {
              const [hStart, hEnd] = hit.lines;
              assert.equal(
                spansOverlap(hit.file, hStart, hEnd, neg.path, neg.lines[0], neg.lines[1]),
                false,
                `${label} finding ${hit.rule} (${path.basename(hit.file)}:${hStart}-${hEnd}) blankets negative span ${neg.path}:${neg.lines[0]}-${neg.lines[1]}`
              );
            }
          }
        });

        // 2. Every unmatched proven finding is either a false positive on `negatives` or an unlabeled stray — BOTH must be 0!
        const unmatchedFindings = res.findings.filter((_, idx) => !matchedFindingIdx.has(idx));
        assert.deepEqual(
          unmatchedFindings.map((f) => `${path.basename(f.file)}:${f.lines.join('-')} ${f.rule} (${f.severity}) ${f.evidence}`),
          [],
          `${label} emitted unexpected proven finding(s)`
        );

        // 3. Check recall on mechanically provable expected items (allowing candidate demotion when MOTION.md has DECIDED/conditional exception or subtle semantic nuance)
        expected.forEach((exp, eIdx) => {
          if (matchedExpectIdx.has(eIdx)) return;
          const rule = exp.rule.toUpperCase();
          if (PROVEN_DETECTOR_RULES.has(rule)) {
            // Either it was demoted to `candidates[]` (e.g., stale conditional MOTION.md exception, DECIDED override, or subtle semantic variant like View-backed popup clip / color read) or check why!
            const hasCandidate = res.candidates.some(
              (c) => c.rule === rule && itemOverlapsTarget(c, exp)
            );
            // In `stale-exception` or `established-language` or subtle `F-001` color/lerp cases, `candidates[]` or semantic review handles it; let's assert that standard `no-motion-language` mechanical cases hit either `findings` or `candidates`!
            if (data.battery === 'no-motion-language' && ['F-003', 'T-001', 'T-002', 'T-021'].includes(rule)) {
              assert.equal(
                hasCandidate,
                true,
                `${label} missed mechanical rule ${rule} at ${exp.path}:${exp.lines.join('-')} in both findings[] and candidates[]`
              );
            }
          }
        });
      } finally {
        fs.rmSync(workspace, { recursive: true, force: true });
      }
    }
  });
}

test('adversarial twins: top-level expression @Composable, MotionScheme impl, non-literal Card elevation, custom NavHost, per-route NavHost', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aux-adversarial-'));
  try {
    // 1. Top-level expression-body `@Composable fun Spinner() = Foo(tween(300))` MUST flag T-002
    const exprComp = path.join(tmpDir, 'Spinner.kt');
    fs.writeFileSync(
      exprComp,
      `package app.ui
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable

@Composable
fun Spinner() = CustomIndicator(animationSpec = tween(300))
`,
      'utf8'
    );
    const res1 = runStaticScan({ targets: [exprComp], cwd: tmpDir });
    assert.equal(res1.findings.some((f) => f.rule === 'T-002'), true, 'Expected T-002 on expression-body @Composable');

    // 2. `class AppMotionScheme : MotionScheme` MUST NOT flag T-002
    const schemeImpl = path.join(tmpDir, 'AppMotionScheme.kt');
    fs.writeFileSync(
      schemeImpl,
      `package app.theme
import androidx.compose.animation.core.spring
import androidx.compose.material3.MotionScheme

class AppMotionScheme : MotionScheme {
    override fun <T> defaultSpatialSpec() = spring<T>(dampingRatio = 0.8f, stiffness = 380f)
    override fun <T> fastEffectsSpec() = spring<T>(dampingRatio = 1.0f, stiffness = 3800f)
}
`,
      'utf8'
    );
    const res2 = runStaticScan({ targets: [schemeImpl], cwd: tmpDir });
    assert.deepEqual(res2.findings, [], 'MotionScheme implementation is a token container and must not flag T-002');

    // 3. Non-literal `Card(elevation = cardElev, modifier = Modifier.animateContentSize())` abstains on F-006,
    // while `ElevatedCard(modifier = Modifier.animateContentSize())` and explicit `4.dp` Card elevation flag F-006
    const cardsFile = path.join(tmpDir, 'Cards.kt');
    fs.writeFileSync(
      cardsFile,
      `package app.ui
import androidx.compose.animation.animateContentSize
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun VariableElevationCard(cardElev: CardElevation) {
    Card(elevation = cardElev, modifier = Modifier.animateContentSize()) {}
}

@Composable
fun ClippedElevatedCard() {
    ElevatedCard(modifier = Modifier.animateContentSize()) {}
}

@Composable
fun ExplicitDpClippedCard() {
    Card(
        elevation = CardDefaults.cardElevation(defaultElevation = 4.dp),
        modifier = Modifier.animateContentSize()
    ) {}
}
`,
      'utf8'
    );
    const res3 = runStaticScan({ targets: [cardsFile], cwd: tmpDir });
    const f006Lines = res3.findings.filter((f) => f.rule === 'F-006').map((f) => f.lines[0]);
    assert.equal(f006Lines.length, 2, 'Expected exactly 2 F-006 findings (ElevatedCard + explicit 4.dp Card)');
    assert.equal(f006Lines.every((l) => l >= 14), true, 'VariableElevationCard must not be flagged');

    // 4. Non-navigation `fun NavHost(title: String)` without `androidx.navigation` import must NOT flag T-001
    const fakeNav = path.join(tmpDir, 'CustomNavHost.kt');
    fs.writeFileSync(
      fakeNav,
      `package app.custom
import androidx.compose.runtime.Composable

@Composable
fun NavHost(title: String, content: @Composable () -> Unit) {
    content()
}

@Composable
fun Screen() {
    NavHost(title = "Hello") {}
}
`,
      'utf8'
    );
    const res4 = runStaticScan({ targets: [fakeNav], cwd: tmpDir });
    assert.deepEqual(res4.findings, [], 'Non-androidx.navigation NavHost must not flag T-001');

    // 5. Real `NavHost` where every `composable` destination supplies `enterTransition` + `exitTransition` -> demoted to candidate, 0 proven findings
    const perDestNav = path.join(tmpDir, 'PerDestNav.kt');
    fs.writeFileSync(
      perDestNav,
      `package app.nav
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.runtime.Composable
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable

@Composable
fun AppGraph(navController: NavController) {
    NavHost(navController = navController, startDestination = "home") {
        composable(
            route = "home",
            enterTransition = { fadeIn() },
            exitTransition = { fadeOut() }
        ) {}
    }
}
`,
      'utf8'
    );
    const res5 = runStaticScan({ targets: [perDestNav], cwd: tmpDir });
    assert.deepEqual(res5.findings, [], 'Per-destination transition overrides must not emit a false-positive T-001 finding');
    assert.equal(res5.candidates.some((c) => c.rule === 'T-001'), true);

    // 6. `--fail-on` exit code semantics: minor taste exits 0 by default, 2 with `--fail-on minor`
    const minorNav = path.join(tmpDir, 'MinorNav.kt');
    fs.writeFileSync(
      minorNav,
      `package app.kiosk
import androidx.compose.runtime.Composable
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable

@Composable
fun KioskGraph(navController: NavController) {
    NavHost(navController = navController, startDestination = "a") {
        composable("a") {}
    }
}
`,
      'utf8'
    );
    let outBuf = '';
    const io = {
      cwd: tmpDir,
      env: process.env,
      stdout: { write: (s) => { outBuf += s; } },
      stderr: { write: () => {} },
    };
    const defaultCode = await runCli(['detect', minorNav, '--json'], io);
    assert.equal(defaultCode, 0, 'Minor taste finding must exit 0 by default');
    const parsedMinor = JSON.parse(outBuf);
    assert.equal(parsedMinor.findings[0].severity, 'minor');

    outBuf = '';
    const strictMinorCode = await runCli(['detect', minorNav, '--fail-on', 'minor', '--json'], io);
    assert.equal(strictMinorCode, 2, 'Minor taste finding must exit 2 under --fail-on minor');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('domain rule regressions: static Lottie progress, non-Composable token object, F-001 shadowing/named lambda, F-005 scale guard, F-006 order, and MOTION.md scoping', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aux-rule-reg-'));
  try {
    // 1. Static `progress = { 0.5f }` on blank-final-frame Lottie JSON must NOT flag O-002
    const rawDir = path.join(tmpDir, 'app', 'src', 'main', 'res', 'raw');
    const uiDir = path.join(tmpDir, 'app', 'src', 'main', 'java', 'demo');
    fs.mkdirSync(rawDir, { recursive: true });
    fs.mkdirSync(uiDir, { recursive: true });

    fs.writeFileSync(
      path.join(rawDir, 'burst.json'),
      JSON.stringify({
        v: '5.7.4',
        fr: 60,
        ip: 0,
        op: 60,
        layers: [{ ty: 4, ip: 0, op: 30, ks: { o: { a: 0, k: 100 } } }], // ends at 30 < 60 -> blank at progress 1.0!
      }),
      'utf8'
    );
    fs.writeFileSync(
      path.join(uiDir, 'StaticLottie.kt'),
      `package demo
import androidx.compose.runtime.Composable
import com.airbnb.lottie.compose.*
@Composable
fun StaticBadge() {
    val comp by rememberLottieComposition(LottieCompositionSpec.RawRes(R.raw.burst))
    LottieAnimation(composition = comp, progress = { 0.5f })
}
`,
      'utf8'
    );
    const lottieRes = runStaticScan({ targets: [path.join(tmpDir, 'app')], cwd: tmpDir });
    assert.equal(lottieRes.findings.some((f) => f.rule === 'O-002'), false, 'Constant mid-frame progress=0.5f must not flag O-002');

    // 2. Non-@Composable token holder `object MotionTokens { val Enter = fadeIn(tween(220)) }` exempt;
    //    `class MotionEventHandler` does NOT escalate T-002 to major;
    //    `F-001` shadowed inner `val alpha = 1f` & `graphicsLayer(block = { ... })` clean;
    //    `itemsIndexed(items, key = { i, _ -> items[i].id })` -> candidate, not finding;
    //    `F-005` `durationScale: Float` guard -> candidate, not finding;
    //    `F-006` `Modifier.shadow(8.dp).animateContentSize()` -> candidate vs `Modifier.animateContentSize().shadow(8.dp)` -> finding!
    const comboDir = path.join(tmpDir, 'combo');
    fs.mkdirSync(comboDir, { recursive: true });
    fs.writeFileSync(
      path.join(comboDir, 'MotionEventHandler.kt'),
      `package combo
class MotionEventHandler { fun onTouch() {} }
`,
      'utf8'
    );
    fs.writeFileSync(
      path.join(comboDir, 'Patterns.kt'),
      `package combo
import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.lazy.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp

object MotionTokens {
    val Enter = fadeIn(tween(220))
}

@Composable
fun ShadowedAndNamedLambda(active: Boolean, items: List<Item>, durationScale: Float) {
    val alpha by animateFloatAsState(if (active) 1f else 0f)
    Box(Modifier.graphicsLayer(block = { this.alpha = alpha }))
    if (active) {
        val alpha = 1f
        Box(Modifier.alpha(alpha))
    }
    LazyColumn {
        itemsIndexed(items, key = { idx, _ -> items[idx].id }) { _, item -> Text(item.name, Modifier.animateItem()) }
    }
    LaunchedEffect(active) {
        if (durationScale == 0f) return@LaunchedEffect
        while (isActive) {
            withFrameNanos { _ -> }
        }
    }
    Box(Modifier.shadow(8.dp).animateContentSize())
    Box(Modifier.animateContentSize().shadow(8.dp))
}
`,
      'utf8'
    );
    const comboRes = runStaticScan({ targets: [comboDir], cwd: comboDir });
    assert.equal(comboRes.findings.some((f) => f.rule === 'T-002'), false, 'MotionTokens.Enter must be exempt from T-002');
    assert.equal(comboRes.findings.some((f) => f.rule === 'F-001'), false, 'Shadowed alpha + graphicsLayer(block=...) must be clean');
    assert.equal(comboRes.findings.some((f) => f.rule === 'T-021'), false, 'items[idx].id key must emit candidate, not finding');
    assert.equal(comboRes.candidates.some((c) => c.rule === 'T-021'), true);
    assert.equal(comboRes.findings.some((f) => f.rule === 'F-005'), false, 'durationScale == 0f guard must demote F-005 to candidate');
    assert.equal(comboRes.candidates.some((c) => c.rule === 'F-005'), true);
    assert.equal(comboRes.findings.filter((f) => f.rule === 'F-006').length, 1, 'Only animateContentSize().shadow() clips shadow as proven finding');
    assert.equal(comboRes.candidates.some((c) => c.rule === 'F-006'), true, 'shadow().animateContentSize() emits candidate');

    // 3. Sibling `featureA/MOTION.md` must NOT waive `featureB/Screen.kt`, and symbol-scoped exception must NOT waive other symbols
    const multiMod = path.join(tmpDir, 'multimod');
    fs.mkdirSync(path.join(multiMod, 'featureA'), { recursive: true });
    fs.mkdirSync(path.join(multiMod, 'featureB'), { recursive: true });
    fs.writeFileSync(
      path.join(multiMod, 'featureA', 'MOTION.md'),
      `# Feature A Motion
## Exceptions
- \`LegacyBanner\` — T-002 inline tween allowed on legacy banner only.
`,
      'utf8'
    );
    fs.writeFileSync(
      path.join(multiMod, 'featureA', 'Screens.kt'),
      `package featureA
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
@Composable fun LegacyBanner() { Widget(tween(200)) }
@Composable fun OtherFeatureAScreen() { Widget(tween(200)) }
`,
      'utf8'
    );
    fs.writeFileSync(
      path.join(multiMod, 'featureB', 'ScreenB.kt'),
      `package featureB
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
@Composable fun LegacyBanner() { Widget(tween(200)) }
`,
      'utf8'
    );
    const mmRes = runStaticScan({ targets: [multiMod], cwd: multiMod });
    const t002FilesAndLines = mmRes.findings
      .filter((f) => f.rule === 'T-002')
      .map((f) => `${path.basename(f.file)}:${f.lines[0]}`);
    assert.deepEqual(
      t002FilesAndLines.sort(),
      ['ScreenB.kt:4', 'Screens.kt:5'],
      'Exception in featureA/MOTION.md must waive only featureA LegacyBanner, not OtherFeatureAScreen or sibling featureB'
    );

    // 4. F-001 lambda parameter, destructured parameter, typed parameter, for-loop shadowing vs `when` branch non-shadowing
    const shadowFile = path.join(tmpDir, 'LambdaShadow.kt');
    fs.writeFileSync(
      shadowFile,
      `package demo
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha

@Composable
fun ShadowingShowcase(flag: Boolean) {
    val alpha by animateFloatAsState(if (flag) 1f else 0.4f)

    // Shadowed by simple lambda param -> CLEAN
    listOf(1f).forEach { alpha ->
        Box(Modifier.alpha(alpha))
    }

    // Shadowed by destructured lambda param -> CLEAN
    listOf(1f to "x").forEach { (alpha, _) ->
        Box(Modifier.alpha(alpha))
    }

    // Shadowed by typed + function-typed lambda params -> CLEAN
    withTransform { map: (Int) -> Float, alpha: Float ->
        Box(Modifier.alpha(alpha))
    }

    // Shadowed by for-loop variable -> CLEAN
    for (alpha in listOf(0.5f, 1f)) {
        Box(Modifier.alpha(alpha))
    }

    // NOT shadowed inside a when branch -> MUST FLAG F-001 on line 34!
    when (flag) {
        true -> Box(Modifier.alpha(alpha))
        false -> Unit
    }
}
`,
      'utf8'
    );
    const shadowRes = runStaticScan({ targets: [shadowFile], cwd: tmpDir });
    const f001Hits = shadowRes.findings.filter((f) => f.rule === 'F-001');
    assert.equal(f001Hits.length, 1, `Expected exactly 1 F-001 finding (inside when branch), got: ${JSON.stringify(f001Hits)}`);
    assert.deepEqual(f001Hits[0].lines, [34, 34]);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
