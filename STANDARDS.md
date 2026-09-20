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

1. **Decides something the source leaves open.** Rules may derive from Material guidance or
   from established craft — most should. What they may not do is restate a *fact* that
   already has a home: token values, component specs and theming conformance belong to
   [`hamen/material-3-skill`](https://github.com/hamen/material-3-skill), and a rule that
   only repeats one is rejected and routed there. A rule earns its place by turning a
   principle into a decision: naming the surface, the threshold, the default, or the case
   where the principle inverts.
2. **Exact.** It names values, symbols or APIs. No adjectives.
3. **Checkable.** A violating snippet and a compliant neighbour can be written in ≤40 lines.
   A rule with no fixture is not a rule, it is an opinion.
4. **Pinned.** Every factual claim names the symbol or source it rests on, so staleness is
   detectable.
5. **Classed.** Either `floor` or `taste`.
6. **Marked overridable or not.** `taste` rules default to `Overridable: yes` — a codebase
   may diverge via an explicit `DECIDED` entry in MOTION.md. `floor` rules and
   accessibility obligations are `Overridable: no` and hold regardless.
7. **States its claim before its mechanism** (`taste` rules only). Every taste rule opens
   with a one-line **Claim**: the perceptual assertion the rule rests on. API names and code
   follow as the mechanism.

   This is not simplification — readers here know Android. It is separation of the two things
   a taste rule asserts: *this is how it should feel* and *this is how you get it*. Those
   fail independently, and a rule that cannot state the first without naming the second is
   usually a `floor` rule wearing the wrong label.

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

### F-006 — `animateContentSize` clips its child, shadows included

**Rule.** `Modifier.animateContentSize()` always clips the child to its animated bounds. A
container with elevation, a drop shadow, a ripple that extends past the edge, or a nested
`AnimatedVisibility` will have them cut. `SizeTransform(clip = false)` on an inner animation
cannot override an outer `animateContentSize`.

**Why not obvious.** It is the API whose name matches the intent, the clipping is
undocumented, and the artefact looks like a rendering bug rather than a modifier choice.

**Violating**

```kotlin
Card(Modifier.shadow(8.dp).animateContentSize()) { Body() }   // shadow is cut
```

**Compliant**

```kotlin
Box(Modifier.shadow(8.dp)) {
    Card(Modifier.animateContentSize()) { Body() }            // clip stays inside the shadow
}
```

**Pinned.** [issuetracker 225932760](https://issuetracker.google.com/issues/225932760), open.
Confirmed by Doris Liu (Compose animation) that the clip also consumes ripples and nested
`AnimatedVisibility`.

---

### F-007 — Motion state that survives rotation must be saveable

**Rule.** `remember` survives recomposition, not Activity recreation. An `Animatable` holding
a user-visible position — a dismissed sheet offset, a drag position, a step in a sequence —
is reconstructed at its initial value on rotation, and the UI snaps. Such state is hoisted
into `rememberSaveable` or re-derived from saved state; it is not left in a bare `remember`.

**Why not obvious.** It never reproduces in development, because nobody rotates while
mid-drag.

**Violating**

```kotlin
val offset = remember { Animatable(0f) }      // resets to 0f on rotation
LaunchedEffect(Unit) { offset.animateTo(target) }
```

**Compliant**

```kotlin
var persisted by rememberSaveable { mutableFloatStateOf(0f) }
val offset = remember { Animatable(persisted) }
LaunchedEffect(offset) { snapshotFlow { offset.value }.collect { persisted = it } }
```

**Pinned.** developer.android.com: on a configuration change "the system recreates the
activity… Compose recreates the UI"; `remember` does not survive it, `rememberSaveable` does.

---

### F-008 — Layout properties have no cheap animated form

**Rule.** `Modifier.padding` has no lambda overload, so animated padding is read during
composition and remeasures on every frame. The same holds for animated `size`, `width` and
`height`. Where the intent is positional motion, use `offset { }` or `graphicsLayer`; where a
real size change is required, accept the cost knowingly and keep the subtree small.

**Violating**

```kotlin
val pad by animateDpAsState(if (selected) 24.dp else 8.dp)
Row(Modifier.padding(pad)) { WideSubtree() }        // remeasures the subtree each frame
```

**Compliant**

```kotlin
val shift by animateDpAsState(if (selected) 16.dp else 0.dp)
Row(Modifier.offset { IntOffset(0, shift.roundToPx()) }) { WideSubtree() }
```

**Pinned.** Absence of a lambda overload on `Modifier.padding` in current
`androidx.compose.foundation.layout`.

---

### F-009 — Feel is not assessed in a debug build

**Rule.** No claim about smoothness, jank or perceived speed is made from a debug build.
Compose in debug runs the whole UI stack unoptimized and without a baseline profile, and
Android Studio deployments do not apply one. Assessment happens on a release build with R8
enabled, on physical hardware.

**Why it is a floor rule.** It invalidates evidence rather than producing a bad frame. A
timing judgement made in debug is not merely imprecise, it is unrelated to what ships.

**Pinned.** developer.android.com: "You can only reliably measure the performance of a Lazy
layout when running in release mode and with R8 optimization enabled." Baseline profiles
improve first-run execution by roughly 30%.

---

### F-010 — `sharedElement` demands identical content; otherwise `sharedBounds`

**Rule.** `sharedElement` expects the same content on both sides. Where the content differs
visually — different composable, changed text style, italic-to-bold, a colour change — use
`sharedBounds`. Using `sharedElement` across differing content produces a cross-fade artefact
that reads as a rendering fault.

**Pinned.** developer.android.com: "`sharedBounds()` is for content that is visually
different but should share the same area between states, whereas `sharedElement()` expects
the content to be the same", and for `Text`, "`sharedBounds()` is preferred to support font
changes".

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

**Overridable: no.** A product may choose its own transitions; it may not choose to strand
users who have asked for no animation.

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

**Sources disagree; here is where the default landed.** Emil's gate would suppress motion on
the highest-frequency controls outright. M3 specifies press feedback there, and M3
Expressive argues expression *aids* usability, reporting faster target identification and a
closing age-related gap. The default keeps the state layer: the gate governs what is added
*on top of* it, not whether the platform's own feedback survives. Emil's restraint applies
above the state layer, where M3 says nothing.

This is a default, not a verdict. A team whose standard defines its own press language has
already settled it, and the gate then measures against theirs.

---

### T-010 — Exits are faster than entrances

**Rule.** An element leaving should not hold attention. Asymmetric timing is correct by
default: exit at roughly half the entrance duration.

**Why it is ours in spite of looking like Material.** Material encodes the asymmetry in its
*legacy* token pairings — emphasized-decelerate 400ms in, emphasized-accelerate 200ms out —
but the spring-based Expressive system exposes no such pairing, so a codebase that has moved
to `MotionScheme` loses the asymmetry silently unless it is restated as a rule.

---

## Provenance

Taste is mostly inherited, not invented. Originating an Android taste canon from scratch is
a later luxury; what each rule must add now is the decision its source leaves open.

**Material is two separate things, and only one of them is taste.** Its *specs* — token
values, component anatomy, elevation levels, type scale — are not taste and are not ours:
they have a home in [`hamen/material-3-skill`](https://github.com/hamen/material-3-skill)
and a rule that restates one is rejected. Its *taste guidance* — which transition pattern
suits which relationship, motion used sparingly, expression in service of usability — is
what we integrate, as the default for a product that has not chosen otherwise.

### Whose standard we serve

**The product's own — whatever that is.** These skills help a team hold to the motion
language *they* chose, and help them choose one when they haven't. They do not argue an app
toward Material.

"Their own" covers every case equally: M3 adopted wholesale, M3 extended with product
tokens, a wholly custom design system, or a corporate design language the Android app
inherits. A team that chose M3 has a standard that happens to be Material — which is not the
same as us applying Material to them, and the difference shows the moment they want to
depart from it. A custom system is a destination, not a deviation requiring defence.

Two different jobs follow, and they should not be confused:

- **A standard exists** → our job is fidelity to it. Not improvement, not modernization, not
  M3 conformance. Inconsistency with their standard is the finding; disagreement with our
  taste is not.
- **No standard exists** → our job is to help them decide, then hold them to it. The
  pragmatic M3 Expressive default below is a *proposal a human ratifies*, never something
  applied silently. An agent that picks a motion language on a team's behalf and starts
  enforcing it has invented a standard, not served one.

### Resolution is per decision, not per codebase

The question is never "is this an M3 app or a custom one". It is, for **this specific
decision**, has the team said anything? Resolve each decision independently down this
ladder, stopping at the first rung that speaks:

0. **The product's standard**, as `DECIDED` in MOTION.md or in a design system it points to.
1. **Pragmatic M3 Expressive** — Android's own language, in the form that survives contact
   with a real app rather than the maximal expression of the spec.
2. **Craft** — [Emil Kowalski's animation work](https://github.com/emilkowalski/skills)
   (MIT) and community practice — covering what M3 leaves silent: frequency, when not to
   animate, interruption, degradation.
3. **Original**, only where all of the above are silent.

Because resolution happens per decision, the same codebase draws from different rungs for
different questions. That is the intended behaviour, not a compromise:

| Shape | How it resolves |
|---|---|
| No standard at all | M3E throughout, proposed for ratification rather than assumed |
| Customised M3E, to any degree | Their customisations govern what they touched; **everything they did not customise still resolves to M3E** |
| Wholly custom system with its own semantics | Their system governs what it covers; where it is silent, M3E fills the gap |

The degree of customisation changes nothing about the mechanism. A product that overrode two
duration tokens and one that replaced interaction feedback, shape language and every
transition pattern resolve identically: whatever they specified, theirs; whatever they did
not, M3E. There is no *threshold* of customisation at which resolution changes, so the
ladder never tries to grade how custom an app is.

**One signal does matter, but to the fallback rather than to resolution.** An app with no
`androidx.compose.material3` dependency at all — components built directly on Compose
Foundation and UI, as [Jewel](https://github.com/JetBrains/jewel) does for the IntelliJ
design language — has not customised Material, it has declined it. Defaulting such a product
to M3E motion imports a voice it deliberately avoided.

This does not move any decision to a different rung. It lowers confidence in rung 1, so the
skill asks once whether M3E is the wanted fallback instead of assuming it, and records the
answer in MOTION.md. Rare in practice — most products described as having a custom design
system still sit on `material3` underneath with heavy theming — but when it is true, it is
unambiguous and cheap to detect.

**Gaps are the normal case, not a defect.** Most design systems specify colour, type and
spacing, and say nothing about motion — a product can have a thoroughly defined visual
language and no motion language whatsoever. That is not a finding. It is the condition the
fallback exists for.

**The fallback is itself overridable.** A team may write in MOTION.md that unspecified areas
should not resolve to M3E — ask instead, or fall back to something else. Noting it there is
enough; no further justification is wanted.

**The skill says which rung it used.** When a decision resolves below rung 0, that is stated
rather than presented as house style. A product with a strong brand voice may find an M3E
default reads as foreign even where its written system is silent, and the only way that gets
corrected is if the fallback is visible. Silently importing Android's voice into a custom
design system is the failure mode this guards against.

### Two things this ordering does not mean

**An accident is not a standard.** Only `DECIDED` sits at level 0. `tween(300)` recurring
across thirty files is a copy-paste nobody examined, not a considered departure — treating
it as one would canonize the accident, which is the failure the provenance tags exist to
prevent. `OBSERVED` patterns are reported as inconsistency, never enforced as doctrine.

**A standard is not a licence to harm users.** `floor` rules and anything marked
`Overridable: no` hold regardless of MOTION.md. A team may decide its own motion language;
it may not decide that frame-rate state read during composition is fine, or that users who
asked for no animation can be stranded. That carve-out is about correctness and harm, not
about Material.

Where a MOTION.md entry contradicts M3 without saying so, the skill mentions it **once** —
the team may simply not know — and then conforms to their standard. It does not re-litigate
the point on every review.

Inherited rules transfer as *principles*, never as values. Emil's numbers are CSS
cubic-béziers and his platform has `prefers-reduced-motion`; both have to be re-grounded in
Compose symbols and Android behaviour, and T-005 shows a case where the principle survives
but inverts completely.

This table rolls up into each skill's `skill-source.json` attribution, which is required
wherever upstream material is used.

| Rule | Derived from | What we add |
|---|---|---|
| F-001 | d.android.com phases | Applies the phase rule specifically to animated reads |
| F-002 | Compose `Animatable` docs | Makes it a blocking rule, not an option |
| F-003 | d.android.com lazy lists | Reclassifies a footnote as a silent-failure rule |
| F-004 | d.android.com shared elements | Names the wrapping composables that inherit the limit |
| F-005 | `MotionDurationScale` | Enumerates what bypasses it |
| T-001 | Original | Navigation defaults as an always-finding |
| T-002 | Emil — "extend the codebase's tokens" | Re-grounded on `MotionScheme` and MOTION.md |
| T-003 | Original (token reading) | Corrects an inference the docs invite |
| T-004 | M3 Expressive-vs-Standard | Turns a disposition into a per-surface rule |
| T-005 | Emil — reduced motion | Android has no semantic flag; annihilation, not degradation |
| T-006 | Original (Lottie behaviour) | Makes the marker a shipping requirement |
| T-007 | M3 "Top level" pattern | States why, and what breaks when peers slide |
| T-008 | d.android.com predictive back | Recasts a platform change as a motion rule |
| T-009 | Emil — frequency gate | Transfers wholesale; undocumented on Android |
| T-010 | Emil + M3 legacy pairings | Notes the spring system silently drops the asymmetry |

Ten of fifteen derive from an existing source. That is the intended ratio for now.

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
