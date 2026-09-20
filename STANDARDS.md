# Android motion standards

The rule set every skill in this repository packages. If a rule is not here, no skill may
enforce it.

> [!NOTE]
> **Status: format test.** Fifteen rules written to prove the schema works and that the
> domain has depth. The gate is 30 with at least half classed `taste`. If that is not
> reachable in focused work, the honest conclusion is that Android's judgment layer over
> Material 3 is thin, and this project shrinks to a correctness floor plus MOTION.md
> conformance — still useful, different pitch.

## Admission criteria

A rule is admitted only if all five hold:

1. **Not a restatement.** It is absent from m3.material.io and developer.android.com, or it
   contradicts what a reader would infer from them.
2. **Exact.** It names values, symbols or APIs. No adjectives.
3. **Checkable.** A violating snippet and a compliant neighbour can be written in ≤40 lines.
   A rule with no fixture is not a rule, it is an opinion.
4. **Pinned.** Every factual claim names the symbol or source it rests on, so staleness is
   detectable.
5. **Classed.** Either `floor` or `taste`.

## Rule classes

`floor` — mechanical correctness. Wrong regardless of the codebase's conventions, and fires
identically whether MOTION.md is absent, current or stale.

`taste` — judgment. What a considered interface does, where the docs are silent. These are
the reason this repository exists; the floor is table stakes carried so the craft layer is
usable on its own.

Graded and reported **separately**. A healthy taste delta is the product signal; averaging
the two hides a collection that has degenerated into a linter.

---

## Floor

### F-001 — Frame-rate values are read in layout or draw, never composition

**Rule.** A value that changes every frame must be read inside a lambda-form modifier.
`Modifier.offset(x = animatedDp)`, `Modifier.alpha(v)` and `Modifier.graphicsLayer(scaleX = v)`
read during composition and recompose the subtree every frame.

**Why not obvious.** The value-form overloads are the ones in most samples and read as the
"normal" API. Nothing in the signature suggests a phase difference.

**Violating**

```kotlin
val offsetX by animateDpAsState(if (expanded) 120.dp else 0.dp)
Row(Modifier.offset(x = offsetX)) { Content() }
```

**Compliant**

```kotlin
val offsetX by animateDpAsState(if (expanded) 120.dp else 0.dp)
Row(Modifier.offset { IntOffset(offsetX.roundToPx(), 0) }) { Content() }
```

**Pinned.** developer.android.com "Jetpack Compose phases" — the lambda "is invoked during
the layout phase (specifically, during the layout phase's placement step)".
Depth: `chrisbanes/skills` → `compose-performance`.

---

### F-002 — A value the finger controls is an `Animatable`

**Rule.** Gesture-driven values use `Animatable` with velocity handed to `animateDecay` or a
velocity-seeded spring. `animate*AsState` on such a value discards velocity, so motion
visibly restarts at the moment of release.

**Violating**

```kotlin
var dragged by remember { mutableStateOf(0f) }
val x by animateFloatAsState(dragged)          // velocity lost on release
```

**Compliant**

```kotlin
val x = remember { Animatable(0f) }
// onDragStopped:
x.animateDecay(velocity, exponentialDecay())
```

**Pinned.** `androidx.compose.animation.core.Animatable`, `animateDecay`.

---

### F-003 — `animateItem()` requires a stable key

**Rule.** Lazy item animation silently does nothing useful without a stable, `Bundle`-compatible
`key`. It fails by producing wrong animations, not by erroring.

**Violating**

```kotlin
LazyColumn { items(rows) { row -> Row(Modifier.animateItem()) { … } } }
```

**Compliant**

```kotlin
LazyColumn { items(rows, key = { it.id }) { row -> Row(Modifier.animateItem()) { … } } }
```

**Pinned.** developer.android.com: "It is important to provide a key to each item to ensure
`animateItem()` works as expected."

---

### F-004 — No shared elements across a View-backed container

**Rule.** `sharedElement` / `sharedBounds` do not work across `AndroidView`, and that
includes anything wrapping it — `Dialog`, `ModalBottomSheet`. Restructure so the shared
element lives outside the View-backed container, or drop the continuity.

**Pinned.** developer.android.com, shared element transitions: "No interoperability between
Views and Compose is supported. This includes any composable that wraps `AndroidView`, such
as a `Dialog` or `ModalBottomSheet`." Stable since Compose Animation `1.10.0-alpha05`.

---

### F-005 — Hand-driven motion reads the duration scale itself

**Rule.** Compose applies `MotionDurationScale` to its own animation APIs. Motion driven by
`withFrameNanos`, a gesture loop, video, WebView, or `LottieAnimatable.animate()` bypasses it
and keeps moving when the user has asked for no animation. Such code reads
`ANIMATOR_DURATION_SCALE` and branches.

**Pinned.** `androidx.compose.ui.MotionDurationScale`, honoured since Compose Animation
`1.2.0-alpha05`; `Settings.Global.ANIMATOR_DURATION_SCALE` ("Setting to 0.0f will cause
animations to end immediately"). Read with a `SettingNotFoundException` fallback — the key
can be undefined.

---

## Taste

### T-001 — The `NavHost` default transition is always a finding

**Rule.** Navigation Compose and Navigation 3 default to `fadeIn/fadeOut(tween(700))`. A
700ms cross-fade on every destination change is never a considered choice; it is the default
nobody replaced. Destination motion is chosen deliberately or the default is removed.

**Why it survives review.** It looks intentional because it is smooth and consistent. Nothing
flags it, and it is invisible in a screenshot.

**Pinned.** Navigation Compose / Navigation3 default enter/exit transitions.

---

### T-002 — No bare `tween()`

**Rule.** Every spec resolves to `MaterialTheme.motionScheme`, or to the codebase's token per
MOTION.md. A literal `tween(300)` is admissible only inside the token definition itself.

**Why.** This is the rule that makes every other timing rule enforceable — once specs live at
symbols, consistency is checkable and a retune is one edit.

**Violating**

```kotlin
animateFloatAsState(target, animationSpec = tween(300))
```

**Compliant**

```kotlin
animateFloatAsState(target, animationSpec = MaterialTheme.motionScheme.defaultEffectsSpec())
```

**Pinned.** `MotionScheme` is **not** experimental — the opt-in was removed in androidx
`8ada756` ("Graduate MotionScheme from experimental"), shipped `1.5.0-alpha15`. It is
nonetheless only on the 1.5 line; stable is `1.4.0`, and there is no beta as of
`1.5.0-alpha28`. API stability and artifact maturity are independent here.

---

### T-003 — Switching schemes to change a fade changes nothing

**Rule.** Effects springs are byte-identical between Standard and Expressive — `1.0/3800`,
`1.0/1600`, `1.0/800`. Only *spatial* springs differ. A change of `MotionScheme` motivated by
how a fade or colour transition feels is a no-op; the intended change is a different spec
within the same scheme.

**Pinned.** `ExpressiveMotionTokens.kt` and `StandardMotionTokens.kt`; `MotionScheme.kt`
comments the shared values as "Common effects damping and stiffness values for both Standard
and Expressive".

---

### T-004 — Expressive spatial springs stay off dense data

**Rule.** Expressive fast spatial is `dampingRatio 0.6 / stiffness 800` — visibly bouncy. On
dense data surfaces (tables, transaction lists, dashboards) bounce reads as instability.
Standard spatial (`0.9/1400`, `0.9/700`, `0.9/300`) there; Expressive elsewhere.

**Why it is ours.** Google's guidance is "Expressive for most situations, Standard for
utilitarian products" — a disposition, not a decision rule, and it offers nothing for an app
that is expressive in one area and dense in another. Scheme is chosen per surface, not per app.

**Pinned.** Token values as T-003.

---

### T-005 — Meaning-carrying motion ships a hand-built degraded path

**Rule.** Android's "Remove animations" accessibility toggle **zeroes** the animation scales.
It does not reduce or simplify; it annihilates. A shared-element transition becomes a
teleport, a positional reveal becomes a jump cut. Any animation carrying meaning — spatial
relationship, causality, continuity — ships an explicit degraded path: a cross-fade in place
of a slide, a static frame in place of a Lottie.

**Why it is ours.** There is no `prefers-reduced-motion` equivalent to branch on and no
semantic API like iOS's `isReduceMotionEnabled`. The platform gives an intensity value, so
graceful degradation has to be written by hand. Nothing in Material's guidance covers it.

**Pinned.** Settings → Accessibility → Colour and motion → "Remove animations"
(`g.co/android/animations`), which writes `0.0f` to `WINDOW_ANIMATION_SCALE`,
`TRANSITION_ANIMATION_SCALE` and `ANIMATOR_DURATION_SCALE`.

---

### T-006 — Every Lottie carries a `reduced motion` marker

**Rule.** With animations disabled, lottie-compose seeks to the **last** frame (or the first
when speed is negative) unless the composition contains a marker named `reduced motion`. A
file whose outro clears the canvas therefore renders nothing. Every shipped Lottie defines
that marker at a frame that reads as a complete, meaningful still.

**Why it is ours.** The failure is invisible in development — it only appears with the
accessibility toggle on, and the fallback is a silent seek rather than an error.

**Pinned.** `LottieDrawable` marker lookup (`reduced motion` / `reduced_motion` /
`reduced-motion` / `reducedmotion`), else `setFrame(speed < 0 ? minFrame : maxFrame)`.

---

### T-007 — Peers do not slide

**Rule.** Top-level destinations reached from a navigation bar, rail or drawer are peers, not
a sequence. Directional motion between them asserts a spatial order that does not exist and
contradicts itself the moment the user jumps two tabs. Peers cross-fade; hierarchy slides.

**Pinned.** M3 "Top level" transition pattern (formerly "fade through"); MDC-Android
`MaterialFadeThrough` versus `MaterialSharedAxis`.

---

### T-008 — Back is seekable or it is broken

**Rule.** From Android 16 / targetSdk 36, predictive back system animations are on by default
and `onBackPressed` is no longer called. A back transition that only plays on commit cannot
follow the user's finger, so the gesture preview and the transition disagree. Back animations
are driven by progress — `PredictiveBackHandler` with `SeekableTransitionState` — not fired
on completion.

**Pinned.** developer.android.com: for apps targeting Android 16+ on an Android 16+ device,
"`onBackPressed` is not called and `KeyEvent.KEYCODE_BACK` is not dispatched anymore".
`androidx.activity.compose.PredictiveBackHandler`;
`androidx.compose.animation.core.SeekableTransitionState`.

---

### T-009 — Frequency sets the ceiling

**Rule.** Motion cost scales with how often the user sees it.

| Frequency | Ceiling |
|---|---|
| 100+ per day (list press, toggles) | None, or imperceptible — ≤150ms |
| Tens per day (sheets, menus) | Standard spec from the scheme |
| Occasional (navigation, mode change) | Standard spec; continuity matters most |
| Rare or first-run | Delight permitted |

An icon toggle a user hits forty times a session is not a place for a spring with visible
settle. Replacing the ripple with a custom press treatment is a product-wide decision, never
a per-component one.

**Why it is ours.** No Android or Material source states a frequency gate. It is the single
most load-bearing judgment in motion work and it is entirely undocumented.

---

### T-010 — Exits are faster than entrances

**Rule.** An element leaving should not hold attention. Asymmetric timing is correct by
default: exit at roughly half the entrance duration.

**Why it is ours in spite of looking like Material.** Material encodes the asymmetry in its
*legacy* token pairings — emphasized-decelerate 400ms in, emphasized-accelerate 200ms out —
but the spring-based Expressive system exposes no such pairing, so a codebase that has moved
to `MotionScheme` loses the asymmetry silently unless it is restated as a rule.

---

## Progress

15 of 30. Floor 5, taste 10.

Taste already outnumbers floor two to one, which is the ratio the collection needs to stay
worth installing.

Candidates queued, each to be written or rejected against the admission criteria:
`animateContentSize` clipping its child's shadow (issuetracker 225932760) and its misuse on
lazy items during scroll; item enter animations firing on first composition; an
`Animatable` reset by `LaunchedEffect(Unit)` on configuration change; a `tween` pane
transition mixed with a spring content transition on one screen; `shrinkVertically` reflowing
content below it; haptics placed at commit points rather than drag start; `scaleIn` dialogs
being off-language where M3 expands on an axis; porting the Compose `EasingEmphasized` tuple
to another platform; measuring feel in a debug build.
