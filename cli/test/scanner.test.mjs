import assert from 'node:assert/strict';
import test from 'node:test';
import {
  scanKotlinSource,
  analyzeLottieJson,
  parseMotionMd,
  runMotionDomainChecks,
} from '../src/index.mjs';

test('Kotlin scanner: nested block comments, raw strings, multi-dollar strings, char literals, backticked idents, and generics', () => {
  const src = `package demo.scanner

import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable

/* Outer block comment
   /* Inner nested block comment with fake call tween(999) and "unterminated quote */
   Still inside outer block comment: animateDpAsState(0.dp)
*/
@Composable
fun \`screen with spaces\`() {
    val rawDoc = """
        Inside raw string: Modifier.offset(x = slide) and tween(500)
        Interpolation: \${ computeSafeLabel("inner /* not comment */", '\\'') }
    """.trimIndent()
    val multiDollar = \$\$"""Literal $notInterp and \$\${ safeHelper('"', '\\\\') }"""
    val genericSpec = remember<List<Int>> { listOf(1, 2, 3) }
    RealWidget(spec = tween(250))
}
`;

  const parsed = scanKotlinSource(src, 'Demo.kt');
  assert.equal(parsed.lexError, null);
  assert.deepEqual(parsed.imports, [
    'androidx.compose.animation.core.tween',
    'androidx.compose.runtime.Composable',
  ]);

  const funDecl = parsed.declarations.find((d) => d.kind === 'fun');
  assert.equal(funDecl.name, 'screen with spaces');
  assert.equal(funDecl.isComposable, true);

  const callNames = parsed.calls.map((c) => c.name);
  assert.equal(callNames.includes('animateDpAsState'), false, 'Nested comment call must be ignored');
  assert.equal(callNames.includes('computeSafeLabel'), true, 'Template ${...} call must be scanned');
  assert.equal(callNames.includes('safeHelper'), true, 'Multi-dollar $${...} call must be scanned');
  assert.equal(callNames.includes('remember'), true, 'Generic call must be scanned');

  const tweenCalls = parsed.calls.filter((c) => c.name === 'tween');
  assert.equal(tweenCalls.length, 1, 'Only real tween(250) outside comments/strings must be scanned');
  assert.equal(tweenCalls[0].startLine, 18);
});

test('Kotlin scanner: CRLF 1-based line spans, inline waivers (with mandatory reason), and unclosed comment abstention', () => {
  const crlfSrc = [
    'package demo',
    'import androidx.compose.animation.core.tween',
    'import androidx.compose.runtime.Composable',
    '',
    '@Composable',
    'fun First() {',
    '    // android-ux-disable-next-line T-002: legacy animation awaiting token migration',
    '    Widget(tween(150))',
    '    // android-ux-disable-next-line T-002',
    '    Widget(tween(300))',
    '}',
  ].join('\r\n');

  const kf = scanKotlinSource(crlfSrc, 'Crlf.kt');
  assert.equal(kf.lexError, null);
  assert.equal(kf.inlineIgnores.length, 1, 'Directive without reason must be ignored');
  assert.equal(kf.inlineIgnores[0].commentLine, 7);

  const domainRes = runMotionDomainChecks({
    kotlinFiles: [kf],
    inlineIgnoresEnabled: true,
  });
  assert.equal(domainRes.findings.length, 1, 'Line 8 suppressed, line 10 (no reason) still reported');
  assert.deepEqual(domainRes.findings[0].lines, [10, 10]);
  assert.equal(domainRes.suppressed.length, 1);

  // Unclosed block comment -> syntax abstention (`lexError` populated, 0 findings)
  const broken = scanKotlinSource('@Composable fun Broken() { /* unclosed tween(200) ', 'Broken.kt');
  assert.ok(broken.lexError);
  const brokenRes = runMotionDomainChecks({ kotlinFiles: [broken] });
  assert.deepEqual(brokenRes.findings, []);
});

test('Lottie JSON scanner: strict signature rejects non-Lottie JSON; trims \\r markers; demotes time-remapped assets to candidate', () => {
  const pkgJson = analyzeLottieJson(JSON.stringify({ name: 'demo', version: '1.0.0', layers: [] }), 'package.json');
  assert.equal(pkgJson.isLottie, false);

  const withMarkerCr = analyzeLottieJson(
    JSON.stringify({
      v: '5.7.4',
      fr: 60,
      ip: 0,
      op: 120,
      layers: [{ ty: 4, ip: 0, op: 120, ks: { o: { a: 0, k: 100 } } }],
      markers: [{ cm: 'reduced_motion\r', tm: 60, dr: 0 }],
    }),
    'celebration.json'
  );
  assert.equal(withMarkerCr.isLottie, true);
  assert.equal(withMarkerCr.hasReducedMotionMarker, true);

  // Layer with non-zero start time (`st: 30`) and fade from 0 at `op` -> uncertain final frame (not proven blank)
  const timeShifted = analyzeLottieJson(
    JSON.stringify({
      v: '5.7.4',
      fr: 60,
      ip: 0,
      op: 120,
      layers: [
        {
          ty: 4,
          ip: 0,
          op: 120,
          st: 30,
          ks: {
            o: {
              a: 1,
              k: [
                { t: 0, s: [0] },
                { t: 90, s: [100] },
              ],
            },
          },
        },
      ],
    }),
    'shifted.json'
  );
  assert.equal(timeShifted.isLottie, true);
  assert.equal(timeShifted.hasComplexFeatures, true, 'st != 0 marks asset as complex so rules.mjs demotes O-002 to candidate');
});

test('MOTION.md parser: AUX-MD-* contract codes and --draft --base existing DECIDED preservation', () => {
  const baseMd = `# Motion Contract

## Specs
### Peer tab switch [DECIDED]
- **Intent** — Calm cross-fade between bottom tabs.
- **Binding** — \`AppTokens.tabCrossFade\`
`;

  const updatedDraft = `${baseMd}
### Detail card expand [OBSERVED]
- **Intent** — Spatial expand from card bounds.
- **Binding** — \`MaterialTheme.motionScheme.defaultSpatialSpec()\`
`;

  const okParsed = parseMotionMd(updatedDraft, 'MOTION.md', { draft: true, baseContent: baseMd });
  assert.deepEqual(
    okParsed.lintFindings,
    [],
    'Pre-existing DECIDED spec in --base must be preserved without AUX-MD-DRAFT-DECIDED error'
  );

  const newlyMintedDecided = `${updatedDraft}
### Unratified new spec [DECIDED]
- **Intent** — Agent-invented rule.
- **Binding** — \`MaterialTheme.motionScheme.fastEffectsSpec()\`
`;
  const badParsed = parseMotionMd(newlyMintedDecided, 'MOTION.md', { draft: true, baseContent: baseMd });
  assert.equal(badParsed.lintFindings.length, 1);
  assert.equal(badParsed.lintFindings[0].rule, 'AUX-MD-DRAFT-DECIDED');
});

test('scanner & MOTION.md review regressions: raw-string templates, non-overridable file-wide waiver guard, HTML comments/fences/tables, and --base content check', () => {
  // 1. Raw string literal value + multi-line raw string with ${...} template endLine
  const rawSrc = `package demo
import androidx.compose.runtime.Composable
@Composable
fun RawDemo(x: Int) {
    val asset = """celebrate.json"""
    val msg = """
        line1 \${x + 1}
        line2
    """
}
`;
  const kfRaw = scanKotlinSource(rawSrc, 'RawDemo.kt');
  const rawStrLiterals = kfRaw.tokens.filter((t) => t.type === 'StringLiteral');
  assert.equal(rawStrLiterals[0].value, 'celebrate.json');
  assert.equal(rawStrLiterals[1].endLine, 9);

  // 2. KDoc `/** ... */` ignored; file-wide `// android-ux-disable F-001: ...` rejected while `T-002` allowed
  const waiverSrc = `// android-ux-disable F-001: attempt to waive floor across whole file
// android-ux-disable T-002: intentional taste waiver in prototype file
package demo
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha

/** android-ux-disable-next-line F-001: KDoc comment must not act as directive */
@Composable
fun WaiverTarget(active: Boolean) {
    val a by animateFloatAsState(if (active) 1f else 0f, animationSpec = tween(200))
    Box(Modifier.alpha(a))
}
`;
  const kfWaiver = scanKotlinSource(waiverSrc, 'WaiverTarget.kt');
  const resWaiver = runMotionDomainChecks({ kotlinFiles: [kfWaiver], inlineIgnoresEnabled: true });
  assert.equal(resWaiver.findings.some((f) => f.rule === 'F-001'), true, 'File-wide directive must NOT suppress F-001');
  assert.equal(resWaiver.findings.some((f) => f.rule === 'T-002'), false, 'File-wide directive CAN suppress overridable T-002');

  // 3. MOTION.md HTML comments, fenced blocks, table tags, and modified DECIDED binding under --draft --base
  const trickyBase = `# Motion Contract
<!--
### Commented spec [DECIDED]
- **Intent** — Hidden.
- **Binding** — \`Hidden.spec\`
-->
## Frequency map
| Surface | Tier | Status |
| --- | --- | --- |
| Home tab | Frequent | [DECIDED] |

## Specs
### Peer tab switch [DECIDED]
- **Intent** — Calm cross-fade.
- **Binding** — \`AppTokens.tabCrossFade\`

\`\`\`markdown
### Example in code fence [INVALID_TAG]
\`\`\`
`;
  const parsedTricky = parseMotionMd(trickyBase, 'MOTION.md');
  assert.deepEqual(parsedTricky.lintFindings, [], 'Fenced code and HTML comments must not trigger tag errors');
  assert.equal(parsedTricky.specs.length, 1, 'Table row [DECIDED] and HTML comment must not create phantom specs');
  assert.equal(parsedTricky.counts.DECIDED, 2, '1 table tag + 1 spec heading = 2 DECIDED tags (no double count)');

  const tamperedDecided = trickyBase.replace('`AppTokens.tabCrossFade`', '`AppTokens.hijackedSpec`');
  const parsedTampered = parseMotionMd(tamperedDecided, 'MOTION.md', { draft: true, baseContent: trickyBase });
  assert.equal(
    parsedTampered.lintFindings.some((f) => f.rule === 'AUX-MD-DRAFT-DECIDED'),
    true,
    'Altering a DECIDED spec binding in --draft mode must be flagged even when label matches --base'
  );
});
