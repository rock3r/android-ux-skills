# Evals for `optimize-android-motion`

This suite runs with [Pioneer](https://github.com/rock3r/pioneer) and is graded by
`scripts/run-evals.py` and `scripts/judge-evals.py`.

```bash
./scripts/run-evals.py --skill optimize-android-motion --dry-run
./scripts/run-evals.py --skill optimize-android-motion --out report.json
./scripts/judge-evals.py --skill optimize-android-motion --report report.json
```

## What the battery tests

Each case in `evals.json` pairs a Perfetto trace summary (`UI`, `RT`, and `SF`
`FrameTimeline` metrics) with a Kotlin fixture containing a defective composable beside a
clean, optimized twin:

| Case | Class | Rule | What the fixture and trace test |
|---|---|---|---|
| 10 | A. Static twin | F-001 | Composition-phase `Modifier.offset(x = slideDp.value.dp)` and incomplete off-screen step gating (`clearAndSetSemantics` alone) beside a lambda `offset { }` step with pointer and focus blocking. |
| 20 | A. Static twin | F-008 | Per-frame `Modifier.padding(top = topPad)`, `alpha = 0f` GPU prewarm (skipped by `RenderNode`), and unlatched `saveLayer` transitions beside a `0.004f` prewarm and latched `CompositingStrategy.Offscreen` card. |
| 30 | A. Static twin | T-022 | Layout switched on a `keyboardOpen` boolean inside `BoxWithConstraints` plus uncomposited `ModalBottomSheet` bounce beside a `WindowInsets.ime` sheet wrapped in `CompositingStrategy.Offscreen` while moving. |
| 40 | A. Static twin | F-001, T-013 | Per-frame `ColorScheme` color interpolation in composition and an index-multiplied `delay(index * 45L)` section stagger beside a static `rememberGraphicsLayer().toImageBitmap()` snapshot transition. |
| 50 | A. Static twin | F-005 | Endless `withFrameNanos` globe loop ignoring `MotionDurationScale` beside a `60 fps` `preferredFrameRate` loop that checks `MotionDurationScale` and pauses on tap. |
| 60 | G. Framework-correct (pure) | — | Clean file using `0.004f` GPU prewarm, `drawWithCache` geometry caching, and hoisted `LazyColumn` theme colors; any reported finding is a false positive. |

## Classifier checks (`judge-evals.py`)

In addition to deterministic line-range and rule matching in `run-evals.py`,
`judge-evals.py` checks both universal review quality (`judge-checks.json`) and per-case
remedy accuracy (`evals.json`), calibrated against two-sided pass/fail examples in
`judge-calibration.json`:

- `names_lambda_offset` (Case 10): Verifies the review names `offset { IntOffset(...) }`
  as the concrete fix.
- `explains_gpu_prewarm_or_savelayer` (Case 20): Verifies the review explains why `alpha =
  0f` fails to warm GPU shaders or how `CompositingStrategy.Offscreen` / latched `alpha =
  1f` prevents mid-animation `saveLayer` stalls.
- `recommends_snapshot_or_draw_deferral` (Case 40): Verifies the review recommends a
  static bitmap snapshot (`rememberGraphicsLayer().toImageBitmap()`) or draw-phase
  deferral instead of per-frame composition color lerping.
