# Android motion standards

The rule set every skill in this repository packages. If a rule is not here, no skill may
enforce it.

> [!NOTE]
> **Status: revision 02.** 32 rules — 10 `floor`, 2 `obligation`, 20 `taste`.
>
> Revision 01 applied three independent machine reviews (taste, structural, fact-check),
> which cut three rules, found two internal contradictions, and caught three rules that
> fired on correct code. [`REVISION-01.md`](REVISION-01.md) records what changed and why.
>
> Revision 02 applied the first human review: 26 keep, 1 revise, 5 discuss, 0 remove.
> Nothing was cut; the outcome was clarification rather than reversal.
>
> A designer's review of the taste claims is still outstanding, and is a different question
> from the engineering review these rules have had.

## Admission criteria

A rule is admitted only if all six hold:

1. **Decides something the source leaves open.** Rules may derive from Material guidance
   or established craft — most should. They may not restate a *fact* that already has a
   home: token values, component specs and theming conformance belong to
   [`hamen/material-3-skill`](https://github.com/hamen/material-3-skill). A rule earns its
   place by naming the surface, the threshold, the default, or where the principle
   inverts.
2. **Exact.** Values, symbols, APIs. No adjectives.
3. **Checkable, or marked review-only.** Either a violating snippet and compliant
   neighbour fit in ≤40 lines, or the rule is explicitly marked `Detect: review-only`
   because the evidence is not in the source. A rule that is neither is an opinion.
4. **Pinned to a source that actually says it.** Every factual claim names the symbol,
   file or document it rests on — and that source must contain the claim. A plausible
   attribution to a named person from a secondary source is a fabrication.
5. **Classed.** `floor`, `obligation`, or `taste`.
6. **Re-grounded, not translated.** An inherited rule must have had its claim re-derived
   from how Android behaves. Keeping the source's mechanism and swapping the nouns
   produces a web rule wearing Compose symbols — the most common way a rule in this file
   goes wrong, and invisible to the other five criteria.

Taste rules additionally open with a one-line **Claim**: the perceptual assertion, stated
before the mechanism. *How it should feel* and *how you get it* fail independently.

### Material bindings

Six rules reach for a Material mechanism. Each marks it, and states the universal form:

**Material binding** — the part that assumes Material: a token name, a pattern vocabulary,
a justification from M3's own model.

**Outside Material** — the same claim for a product that does not use Material, with its
own mechanism substituted.

The split exists because the claims survive a change of design language even when the
mechanisms do not. A team with a custom design system still wants "direction promises
order"; they need their own transitions mapped to it, not the rule removed. Filtering
whole rules would discard the judgment to shed the vocabulary.

A checker may drop bindings (`--no-material`) without dropping claims. Only T-004's claim
is Material-only, and it says so.

## Rule classes

`floor` — mechanical correctness. Wrong regardless of conventions. Never overridable.

`obligation` — accessibility duty. Never overridable, and
**excluded from the taste delta**, because a rule that can never yield should not inflate
the number meant to prove this collection is more than a linter.

`taste` — judgment. Overridable by an explicit `DECIDED` entry in the product's MOTION.md
unless marked otherwise.

Floor and taste are graded and reported **separately, never averaged**.

### Severity is contextual

A finding's severity comes from the codebase, not from the rule. The same violation is a
minor note in a product with no established motion language and a real defect in one that
has tokenized everything else — because there the problem is no longer the value, it is the
inconsistency.

| Situation | Severity |
|---|---|
| Contradicts a `DECIDED` entry in MOTION.md | **Major.** The team settled this |
| Diverges from an `OBSERVED` convention the codebase otherwise holds | **Major.** Reported as inconsistency, not as wrong |
| Violates a `floor` or `obligation` rule | **Major**, regardless of any standard |
| Violates a `taste` rule where no convention exists | **Minor.** Worth raising, not worth blocking |

This is why a review reads MOTION.md before it reads code. Without it every finding
defaults to minor, which is the honest result when nothing has been decided.

---

## Floor

### F-001 — Frame-rate values are read in layout or draw, never composition

**Rule.** A value changing every frame is read inside a lambda-form modifier.
`Modifier.offset(x = animatedDp)`, `Modifier.alpha(v)` and `graphicsLayer(scaleX = v)`
read during composition and recompose the subtree every frame.

Scope: properties that *have* a lambda form. Layout properties that do not are F-008.

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

**Pinned.** developer.android.com "Jetpack Compose phases": the lambda "is invoked during
the layout phase (specifically, during the layout phase's placement step)". Depth:
`chrisbanes/skills` → `compose-performance`.

---

### F-002 — A value the finger controls is an `Animatable`

**Rule.** Gesture-driven values use `Animatable`, with release velocity carried into
`animateDecay` or a velocity-seeded spring. `animate*AsState` discards velocity, so motion
visibly restarts when the finger lifts.

**Pinned.** `androidx.compose.animation.core.Animatable`, `animateDecay`.
**Detect:** heuristic — needs gesture-flow analysis; expect false positives.

---

### F-003 — `animateItem()` requires a stable key

**Rule.** Lazy item animation silently misbehaves without a stable, `Bundle`-compatible
`key`. It fails by producing wrong animations, not by erroring.

See also T-021: a key can be stable and still be wrong.

**Pinned.** developer.android.com: "It is important to provide a key to each item to
ensure `animateItem()` works as expected."

---

### F-004 — No shared elements across a View-backed container

**Rule.** `sharedElement` / `sharedBounds` do not work across `AndroidView`, including
anything wrapping it — `Dialog`, `ModalBottomSheet`. Restructure, or drop the continuity.

**Pinned.** developer.android.com: "No interoperability between Views and Compose is
supported. This includes any composable that wraps `AndroidView`, such as a `Dialog` or
`ModalBottomSheet`." Stable since Compose Animation `1.10.0-alpha05`.

---

### F-005 — Self-timed motion reads the duration scale itself

**Rule.** "Self-timed" means motion whose progress *your own code* advances — a frame
callback, a timer, a media clock. It is not about whether a finger is involved.

**Compose's animation APIs already handle this and need no change.** `animate*AsState`,
`AnimatedVisibility`, `AnimatedContent`, `Transition` and `Animatable` all run on the
Compose animation clock, read `MotionDurationScale`, and finish immediately when the user
has switched animations off. A gesture-driven `Animatable` is Compose-driven and therefore
already covered — a finger does not make motion self-timed.

What is not covered, and must read the scale itself:

| Bypasses the scale | Why |
|---|---|
| `withFrameNanos` loops | Your code owns the clock |
| `LottieAnimatable.animate()` called directly | `ignoreSystemAnimationsDisabled` is declared but never read |
| Video, `WebView`, `SurfaceView` content | Not Compose animations at all |
| `Animatable` driven from a scope lacking `MotionDurationScale` | `WindowRecomposer` injects it into the recomposer and effect contexts only |

Read it and branch — **to a static end state, never to nothing**. What that end state must
convey is O-001.

```kotlin
val resolver = LocalContext.current.contentResolver
val animationsOff = remember(resolver) {
    try {
        Settings.Global.getFloat(resolver, Settings.Global.ANIMATOR_DURATION_SCALE) == 0f
    } catch (_: Settings.SettingNotFoundException) {
        false // the key can be undefined when it has never been set
    }
}
```

**Pinned.** `androidx.compose.ui.MotionDurationScale`, honoured since Compose Animation
`1.2.0-alpha05`. `Settings.Global.ANIMATOR_DURATION_SCALE`: "Setting to 0.0f will cause
animations to end immediately." Read with a `SettingNotFoundException` fallback; the key
can be undefined. `LottieAnimatable.animate()` declares `ignoreSystemAnimationsDisabled`
but never reads it in the implementation, so direct calls bypass the scale regardless.

---

### F-006 — `animateContentSize` clips its child

**Detect: partial.** One narrow form is checkable; the general case is review-only. See
below.

**Rule.** `Modifier.animateContentSize()` applies `clipToBounds`, so elevation, drop
shadows, ripples extending past the edge and nested `AnimatedVisibility` are cut.
`SizeTransform(clip = false)` on an inner animation cannot override an outer
`animateContentSize`.

**Intent cannot be read from source, so the rule does not try.** It splits instead:

**Checkable.** `animateContentSize` on a node that also carries `Modifier.shadow`, a
non-zero `elevation`, or a `Card`/`Surface` with tonal elevation. That combination is a
reliable signal of *unintended* clipping — nobody adds a shadow in order to clip it off.
This is the form a checker may flag.

**Review-only.** Everything else. A clipped reveal can be exactly what was wanted, and only
a human looking at the result can say. An agent that cannot see the rendered output says
what it sees — "this clips; confirm that is intended" — rather than asserting a defect.

**Violating**

```kotlin
Card(Modifier.shadow(8.dp).animateContentSize()) { Body() }   // shadow is cut
```

**Compliant**

```kotlin
Box(Modifier.shadow(8.dp)) {
    Card(Modifier.animateContentSize()) { Body() }
}
```

**Pinned.** `clipToBounds` applied in both overloads, `AnimationModifier.kt:69-78`; the
KDoc does not mention it.
[issuetracker 225932760](https://issuetracker.google.com/issues/225932760), open and
assigned, where the clip is described as by design.

---

### F-007 — Motion state that survives rotation must be saveable

**Rule.** `remember` survives recomposition, not Activity recreation. An `Animatable`
holding a user-visible position is reconstructed at its initial value on rotation, and the
UI snaps.

Scope: **touch-driven position, not time-driven progress.** A sheet offset the user dragged
to, a carousel page they swiped to, a reorder in progress — those are positions the user
placed, and losing them on rotation is losing their work. A time-driven animation that was
merely mid-flight does not qualify: restarting or completing it is fine, because the user
did not put it where it was.

**Pinned.** developer.android.com: on configuration change "the system recreates the
activity… Compose recreates the UI". `rememberSaveable` survives it; `remember` does not.

---

### F-008 — Layout properties have no cheap animated form

**Rule.** `Modifier.padding` has no lambda overload, so animated padding reads during
composition and remeasures every frame. Same for animated `size`, `width`, `height`. Where
the intent is positional, use `offset { }` or `graphicsLayer`. Where a real size change is
required, accept the cost knowingly.

**Pinned.** `Padding.kt:54-144` — four value overloads, no lambda form.

---

### F-009 — Feel is not assessed in a debug build

**Detect: review-only.** No fixture exists and none can: this governs the provenance of
evidence, not the content of source. Admitted under criterion 3's explicit exemption.

**Rule.** No claim about smoothness, jank or perceived speed comes from a debug build.
Compose in debug runs the UI stack unoptimized and without a baseline profile, and Android
Studio deployments do not apply one. Assessment is a release build with R8, on hardware.

**The rule is one-directional.** Debug is strictly slower, so motion that is *smooth in
debug* will be smooth in release — that observation is safe and needs no rerun. What does
not transfer is the failing direction: jank seen in debug says nothing about the shipped
build, and a fix made in response to it may be correcting something that was never there.

**Pinned.** developer.android.com: "You can only reliably measure the performance of a
Lazy layout when running in release mode and with R8 optimization enabled."

---

### F-010 — `sharedElement` demands identical content; otherwise `sharedBounds`

**Detect: review-only.** Deciding whether content is "the same" is semantic.

**Rule.** `sharedElement` expects the same content on both sides. Where it differs
visually — different composable, changed text style, italic to bold, a colour change — use
`sharedBounds`. The wrong choice produces a cross-fade artefact that reads as a fault.

**Pinned.** developer.android.com: "`sharedBounds()` is for content that is visually
different but should share the same area between states, whereas `sharedElement()` expects
the content to be the same"; for `Text`, "`sharedBounds()` is preferred to support font
changes".

---

## Obligation

Accessibility duties. Never overridable. **Excluded from the taste delta.**

### O-001 — Meaning must have a static carrier

**Overridable: no.**

**Claim.** Motion that carries meaning must still carry it when motion is switched off.

**Rule.** Android's "Remove animations" writes `0.0f` to all three animation scales. This
is annihilation, not reduction — a shared-element transition becomes a teleport, a
positional reveal a jump cut. **There is no substitute animation**, because a substitute
is snapped too.

So the requirement is not a lighter animation. It is that
**the destination at rest shows the relationship the motion would have shown**: the moved
item visible in place, the expanded state legible without having seen it expand, the
origin still indicated. If switching animation off loses information, the information was
only ever in the motion.

A Lottie's reduced-motion still frame is the model for the whole class, not a special
case: whatever frame remains must read as a complete, meaningful still (see O-002).

**Why the web model does not transfer.** `prefers-reduced-motion` is a *preference*, and
the documented response is gentler motion. Android exposes a scale, and its accessible
value is zero. `ValueAnimator.areAnimatorsEnabled()` (API 26+) gives a boolean, not a
preference, and is also set by battery saving on some devices.

**Pinned.** AOSP `RemoveAnimationsPreference.kt:118-131` writes `0.0f` to
`WINDOW_ANIMATION_SCALE`, `TRANSITION_ANIMATION_SCALE` and `ANIMATOR_DURATION_SCALE`.
Settings → Accessibility → Colour and motion; deep link `g.co/android/animations`.

---

### O-002 — Every Lottie has a readable disabled frame

**Overridable: no.**

**Claim.** An animation that has been switched off should still leave something worth
looking at. Whatever frame it lands on is what that user sees permanently.

**Two different things share the phrase "reduced motion". They are unrelated.**

- **Remove animations** is the Android accessibility setting — Settings → Accessibility →
  Colour and motion. It writes `0.0f` to the three animation scales. This is the platform
  behaviour, and Android has no setting called "reduced motion".
- **`reduced motion`** is a *marker inside a Lottie composition*: a named frame the
  animation's author places in the `.json`. It is a Lottie library convention, related to
  Android only in that Lottie looks for it when animations are off.

**Rule.** When Remove animations is on, a Lottie lands on its **last** frame — its first if
speed is negative — unless the composition carries that marker, in which case it shows the
marker's start frame instead. A file whose outro clears the canvas therefore renders
nothing.

The requirement is the *outcome*: the frame the user is left with reads as a complete
still. The marker is how you get one when the last frame does not already qualify, and a
file whose final frame is its resting state needs no marker. Asking a designer to add a
marker is usually easier than re-cutting the animation.

**The marker is honoured at draw time, by the view or the composable — not by the
animation state.** In Compose these are two separate mechanisms that happen to compose:
`animateLottieCompositionAsState` divides speed by the system animator scale, so at scale
zero the speed becomes infinite and `LottieAnimatable` snaps straight to the clip's
terminal progress; then, independently, every `LottieAnimation` draw replaces that progress
with the marker's start frame if the composition has one.

The practical consequence: **the marker only helps if you render through `LottieAnimation`.**
Code that reads `LottieAnimationState.progress` and drives its own drawing — a custom
painter, a `graphicsLayer`, an interop `AndroidView` holding something other than
`LottieAnimationView` — sees the snapped endpoint and never the marker. For that code the
readable frame has to come from the composition itself or from a `LottieClipSpec` that ends
somewhere readable.

This is the only place Lottie behaviour under Remove animations is specified. F-005 governs
the scale bypass; O-001 governs what the remaining frame must convey.

**Pinned — the marker.** `LottieDrawable.java:99-112` — the four accepted spellings
(`reduced motion`, `reduced_motion`, `reduced-motion`, `reducedmotion`, matched
case-insensitively); `:899-911` — `getMarkerForAnimationsDisabled()`, the lookup both paths
share; `:1293-1299` — `animationsEnabled()`, and
`SystemReducedMotionOption.java:21-27`, which is where animator scale zero becomes
`REDUCED_MOTION`.

**Pinned — the Compose path.** `LottieAnimation.kt:138-143` — the draw-time override
(`if (!drawable.animationsEnabled(context) && markerForAnimationsDisabled != null)
drawable.progress = markerForAnimationsDisabled.startFrame`), added in `66bc2fb`;
`animateLottieCompositionAsState.kt:59-64` — `speed / Utils.getAnimationScale(...)`, with
the library's own comment that dividing by zero yields `POSITIVE_INFINITY`;
`LottieAnimatable.kt:242-260` — `else if (speed.isInfinite()) updateProgress(endProgress)`;
`:199-205` — `endProgress`, which is `clipSpec`'s max, or min when speed is negative.

---

## Taste

### T-001 — The `NavHost` default transition is a finding

**Claim.** 700ms is longer than Material's own maximum for a screen transition, and a
cross-fade holds both screens at partial opacity while it runs — so on content-dense
screens it is most of a second of two scrollables ghosting through each other, on every
navigation the product has.

**Rule.** The finding is the **spec, not the pattern**. A cross-fade between top-level
destinations is correct (T-011); a 700ms one is not. Destination motion is chosen
deliberately, or the default is replaced.

**Severity is contextual, and usually minor.** In a codebase with no motion language this
is a note: the value is too long, nothing more. In a codebase that resolves its specs to
tokens everywhere else (T-002), it is **major** — not because 700ms is worse there, but
because this one surface silently inherits a third-party default instead of the product's
own language, and that is the kind of gap that spreads.

Precedence with T-002: report as T-001. An untouched default is one defect, not two.

**What this is not.** There is no evidence the value is a deliberate prompt to change it.
It reads as an old default nobody revisited, and the rule should not imply intent.

**Pinned — why 700ms is long.** M3's duration tokens stop at 600ms (`extraLong4`), and its
specified screen transition is 500ms emphasized, with 400ms enter and 200ms exit for the
decelerate/accelerate pair. Navigation's default exceeds Material's own maximum for the job
by 40%. The ghosting half of the claim is ours, not Material's.

**Pinned.** `DefaultNavTransitions.android.kt:35-47`; Navigation 3
`NavDisplay.android.kt:32-48`, `DEFAULT_TRANSITION_DURATION_MILLISECOND = 700`.

---

### T-002 — No bare `tween()` or `spring()` at a call site

**Claim.** Numbers written where they are used read as accident. A product's motion has
one voice or none, and a value nobody can find again is a decision nobody made.

**Rule.** Every spec resolves to `MaterialTheme.motionScheme` or to the product's own
token. Literal `tween(…)` and literal `spring(…)` are admissible only inside a token
definition.

**Material binding.** `MaterialTheme.motionScheme` as the default token source. It exposes
no durations, so keyframes and timed reveals resolve to a codebase token rather than the
scheme — not an exemption from the rule.

**Outside Material.** The product's own token object. The discipline is identical and the
claim unchanged: the rule is about where numbers live, not whose numbers they are.

**Pinned.** `MotionScheme` carries only `@Immutable`; the opt-in was removed in androidx
`8ada756` ("Graduate MotionScheme from experimental"), shipped `1.5.0-alpha15`. It exists
only on the 1.5 line: stable is `1.4.0`, and there is no beta as of `1.5.0-alpha28`. API
stability and artifact maturity are independent.

---

### T-004 — Expressive spatial springs stay off elements read as data

**Claim.** Bounce on a number reads as instability, not personality. A value should look
settled because it is correct, not because it stopped wobbling.

**Rule.** Expressive fast spatial is `dampingRatio 0.6 / stiffness 800` — visibly bouncy.
Keep it off elements whose *position is read as information*: rows, bars, plotted points,
figures. It remains correct on the containers around them — the sheet, the FAB, the card
over the table. The distinction is per element, not per screen.

Effects springs are identical across both schemes (`1.0/3800`, `1.0/1600`, `1.0/800`), so
changing scheme to alter a fade or colour transition does nothing; only spatial differs.

**Material binding.** The whole rule. Expressive-versus-Standard is meaningless without M3
schemes — this is the one rule whose *claim*, not just its mechanism, assumes Material.

**Outside Material.** The generalisation is: whatever your bounciest spatial spec is, keep
it off elements whose position is read as information. Worth stating in MOTION.md as your
own rule rather than inheriting this one.

**Pinned.** `ExpressiveMotionTokens.kt:21-33`, `StandardMotionTokens.kt:19-31` — the three
effects pairs are textually identical in both files. M3 guidance: Expressive "should be
used for most situations, particularly hero moments and key interactions", Standard
"should be used for utilitarian products".

---

### T-008 — Custom back is seekable or it is broken

**Claim.** Back follows the finger. A transition that only plays on release contradicts
the preview the system already showed, and the user saw that first.

**Rule.** Scope: **back you implement yourself** — sheets, overlays, hand-rolled
containers, any `BackHandler {}` popping state. `NavHost` already seeks correctly with no
app code, and flagging it is a false positive.

Custom back is driven by progress: `PredictiveBackHandler` with `SeekableTransitionState`.

**Pinned.** `NavHost.kt` ~L823-940 installs its own handler and calls
`SeekableTransitionState.seekTo(progress, previousEntry)`. developer.android.com: for apps
targeting Android 16+ on an Android 16+ device, "`onBackPressed` is not called and
`KeyEvent.KEYCODE_BACK` is not dispatched anymore".

---

### T-009 — Frequency sets the ceiling

**Detect: review-only.** Usage frequency is not in the source.

**Claim.** The motion that delights once a week is an obstruction forty times a session.
Nothing about the animation changes; the user's relationship to it does.

**Rule.**

| Frequency | Ceiling |
|---|---|
| 100+ per day | The platform state layer only |
| Tens per day | Fast tier from the scheme |
| Occasional | Default tier; continuity matters most |
| Rare or first-run | Delight permitted |

**"Platform state layer" means the feedback the component already gives you** for hover,
focus, press and drag — on Material that is the tonal overlay plus ripple that `Button`,
`ListItem`, `Card` and every other interactive component draw without being asked, together
with M3 Expressive's press shape morph. On a custom design system it is whatever your
equivalent is: the thing a component does on touch that you did not write at the call site.

**It always survives the gate.** It is rung 1 of the resolution ladder, and the default
fallback cannot fail the default rule. The ceiling governs what is added *on top of* the
state layer. Removing or replacing it is a product-wide decision belonging in MOTION.md —
and a bare `clickable` with `indication = null` has removed it by accident, which is the
common form of getting this wrong.

**Why it is ours.** No Android or Material source states a frequency gate. It is the
single most load-bearing judgment in motion work and it is entirely undocumented.

---

### T-010 — Exits use fewer properties, not shorter durations

**Claim.** Something leaving should not hold attention on its way out. The user has
already moved on.

**Rule.** On Android, asymmetry is expressed as **tier and property count, not a duration
ratio**: enter with spatial *and* effects; exit with effects only.

**Material binding.** The tier vocabulary and M3's own position that exits are usually
just a fade. In scheme terms: `defaultSpatialSpec` + `defaultEffectsSpec` in,
`fastEffectsSpec` out.

**Outside Material.** Enter moves *and* fades; exit only fades. The property count is the
mechanism; the tier names are Material's way of saying it.

**Scope — this is about a component entering and leaving, not about every fade.** Three
things are outside it:

- **Gesture dismissals**, which complete on velocity, and **predictive-back exits**, which
  the system times.
- **A change of emphasis in place.** A persistent element animating its own alpha, colour
  or elevation is not entering or leaving, so there is no spatial half to add and a
  symmetric spec is correct.
- **Transitions whose pattern is itself a cross-fade** (T-011: unordered top-level
  destinations). The pattern is chosen to promise *no* spatial relationship; adding
  movement to satisfy this rule would assert the order T-011 says does not exist.

Read literally and without these, the rule would make every cross-fade a violation and
contradict T-011 outright.

**Precedence with T-020.** An exit on a faster tier or with fewer properties, exactly as
this rule prescribes, is **not** a T-020 tier mismatch. T-020 compares elements moving in
the same direction of the same event; enter-versus-exit asymmetry is this rule's whole
subject. Without this, the two rules would forbid each other in every correct Material
transition.

**Why the ratio was wrong.** "Half the entrance" is one legacy pairing (emphasized
400/200) promoted to law; M2 standard was 225/195, M3 standard 250/200. Under springs
there is no duration to halve — which is why the earlier claim that the spring system
silently drops the asymmetry was false. It lives in the tier choice.

---

### T-011 — The pattern states the relationship

**Detect: review-only.** Relationship intent is not in the source.

**Claim.** Motion between screens tells the user how they are related. The wrong pattern
asserts a relationship that does not exist, and users trust it over the layout.

**Rule.** Direction promises **order**. A gesture is optional — a Next/Back wizard is
ordered and correctly directional without being swipeable.

| Relationship | Pattern |
|---|---|
| One element becomes the next screen | Container transform |
| Parent to child in a hierarchy | Forward and backward |
| Ordered peers | Lateral |
| **Unordered top-level destinations** — nav bar, rail, drawer | **Top level: cross-fade** |
| A component appearing in place | Enter and exit |

"Peer" means *unordered*. Top-level destinations have no order to promise: system back
returns to the start destination regardless of history, and a deep link has no origin at
all, so there is no source of truth for a direction. A swipeable `TabRow` + `Pager` is an
ordered set and is lateral — correct, and out of scope here.

**Material binding.** The five pattern names in the table, and the MDC vocabulary below.

**Outside Material.** The five *relationships* are the rule; the names are Material's. Map
your own transitions onto them and record the mapping in MOTION.md. A design system with a
sixth relationship Material does not name adds a row — the claim accommodates it.

**Pinned.** M3 transition patterns. Older vocabulary still live in code:
`MaterialContainerTransform`, `MaterialSharedAxis`, `MaterialFadeThrough` in MDC-Android.

---

### T-012 — Never gate input on an animation finishing

**Claim.** Motion that ignores input until it completes makes the interface feel like it
is not listening. The user never waits for an animation to grant permission.

**Rule.** Input remains live throughout. The violating forms are structural, not spec:
`enabled = !isAnimating` guards, `snapTo()` before `animateTo()` discarding current
position, and `delay()`-sequenced `LaunchedEffect` chains that cannot be interrupted
partway.

**Not a violation:** a `tween` retargeted mid-flight. Compose continues from the current
value; its defect is spending a full duration on a small remaining distance, which is a
spec question, not an interruption one.

**Pinned.** `Animatable.animateTo` cancels the in-flight animation and continues from its
current value.

---

### T-013 — Stagger has a total budget, not a per-item delay

**Detect: review-only.** Item count is runtime data.

**Claim.** A cascade reads as one gesture up to a point. Past it the user is watching a
queue, and the last arrival feels late rather than choreographed.

**Rule.** Budget the sequence, not the gap. Default where the product has not set one:
**~300ms total**, the effects settle. Beyond the budget, cap the *count* — items past the
cap share the final staggered delay rather than extending the sequence.

Never place later items before earlier ones: "animate the first few, place the rest" read
literally inverts the order, which is worse than the queue it avoids.

Viewport only, first entrance only, never on scroll.

---

### T-016 — Unanchored surfaces expand; they do not scale from centre

**Claim.** A surface scaling up from its own centre reads as flying toward the viewer.
That asserts a depth change M3 deliberately reduced.

**Rule.** Scope: **unanchored** full-surface scale from centre. A surface anchored to its
origin — a menu growing from its trigger, a container transform — scales correctly,
because it reads as emerging *from* the source rather than approaching the viewer.

**Material binding.** The justification — M3 reduced how much depth the system uses, so
asserting a depth change is off-language *there*.

**Outside Material.** The claim holds anywhere depth is not a primary axis of the design
language. A system that uses depth heavily and deliberately may find centre-scale correct;
that is a legitimate `DECIDED` entry, not a violation.

**Pinned.** M3 enter-and-exit: Android expands or collapses on an axis rather than
scaling, because scale implies an elevation change inconsistent with M3's reduced
elevation model. Counter-case that defines the scope: `DropdownMenuContent` scales 0.8→1.0
with FastSpatial from its anchor, `Menu.kt` ~L1827-1855.

---

### T-017 — A screen introduces itself once

**Claim.** Entrance motion says "this is new". Replaying it on return from a detail screen
says something arrived when nothing did, and makes going back feel slower than it is.

**Rule.** Entrance animations play on first entry to a destination, not on every re-entry
to composition.

**Mechanism.** `LaunchedEffect(Unit)` re-runs whenever the composable re-enters
composition, including popping back to it. The "already entered" flag belongs in
`rememberSaveable` or the destination's state holder.

---

### T-018 — Platform overscroll stays unless deliberately replaced

**Claim.** The stretch at the end of a list is what an Android user expects, and one of
the strongest signals that an app is native rather than ported.

**Rule.** Do not disable or replace the platform overscroll effect to install a custom
bounce. Per-component replacement is permitted with a stated reason — a pager carousel
setting `overscrollEffect = null` is legitimate. Replacing it product-wide belongs in
MOTION.md.

**Pinned.** Stretch overscroll is platform behaviour from Android 12 (API 31).

---

### T-019 — Skeletons match structure; indicators have a floor

**Detect: review-only.** Comparing a skeleton to the eventual layout is semantic.

**Claim.** A skeleton promises content of a shape. If the real content does not match
structurally, the promise breaks and the screen jumps.

**Rule.** The bar is *structural* match, not exact match — a heterogeneous feed may ship
an approximate card skeleton and it works, because the structure holds. Where the
structure is unknown, an indeterminate indicator.

Either way, apply a **delay before showing and a minimum visible duration**, so a fast
response does not produce a flash. An indicator that appears and vanishes within 80ms is
worse than no indicator.

**The whole sequence, in order.** Each step exists to remove one kind of flicker:

1. **Delay before showing.** Nothing appears for the first ~150ms. A response that arrives
   inside that window never shows a placeholder at all.
2. **Fade the placeholder in.** It should not appear instantly; an abrupt skeleton is its
   own flash.
3. **Hold a minimum.** Once shown, it stays for a minimum — its fade-in plus a short
   dwell — even if content arrives immediately after. A placeholder that vanishes before
   the eye resolves it reads as a glitch, not as speed.
4. **Cross-fade to content**, rather than swapping. The structural match means the two
   frames are nearly aligned, so a short cross-fade reads as the content resolving rather
   than as one thing being replaced by another.

Skipping step 3 is the common mistake, because it feels like deliberately slowing the app
down. It is the opposite: it is what stops a fast response from looking broken.

**Material binding.** M3 naming skeleton loaders a distinct transition pattern, which is
what makes a skeleton the expected form rather than one option.

**Outside Material.** Both halves stand alone: structural match is a property of the
promise, and the indicator delay-and-minimum is about human perception of flashing, not
about Material.

**Pinned.** M3 lists skeleton loaders as a distinct transition pattern.

---

### T-020 — One event, one scheme and one tier

**Detect: review-only.** What counts as "one perceived event" is not in the source. A
checker can compare tiers *within* a single transition block; it cannot decide where an
event begins.

**Claim.** Elements moving together but timed differently read as unrelated. The viewer
cannot say why the screen feels incoherent, only that it does.

**Rule.** Motion perceived as a single event uses one **scheme and tier** throughout — not
necessarily one spec, since spatial and effects springs properly differ within a tier. The
common defect is a pane transition on one tier with content on another.

Precedence with T-012: T-012 governs whether input is gated; T-020 governs coherence. A
uniform screen that blocks input is still a T-012 finding.

Precedence with T-010: compare elements moving in the *same direction* of the event. An
exit that is faster or uses fewer properties than the entrance it mirrors is T-010 working
as specified, not a tier mismatch.

Does not apply across the app/platform boundary — system transitions are not yours.

---

### T-021 — Keys identify content, not position

**Claim.** A list whose items re-animate on every insertion is telling the user everything
changed, when one thing did.

**Rule.** `key = { it }` on an index, or any key derived from position, is stable and
wrong: inserting one item shifts every subsequent key and re-animates the whole list. Keys
are derived from item identity.

F-003 catches a *missing* key. This catches a present one that lies.

---

### T-022 — Content tracks the keyboard, it does not jump

**Claim.** The keyboard animates in. Content that arrives in its final position partway
through reads as a glitch rather than a response.

**Rule.** Content follows the animated `WindowInsets.ime` value rather than repositioning
on a visibility callback. The violating form is a boolean "keyboard visible" driving a
layout change.

**Pinned.** `WindowInsets.ime`, `Modifier.imePadding()`.

---

### T-023 — Motion starts on the input frame

**Claim.** Perceived speed is set by when feedback begins, not when work finishes. Motion
that waits for a response makes a fast system feel slow.

**Rule.** Motion begins on the frame the input arrives, not the frame the result does. A
transition that can start before data lands, starts — the destination arrives in a loading
state rather than the origin holding still.

**Why it is ours.** Nothing in Material or Android guidance connects motion timing to
perceived performance, and it is the highest-yield judgment in app motion.

---

### T-024 — Back plays the inverse of forward

**Claim.** Reversal is how a user builds a model of where things live. An exit that is not
the inverse of its entrance breaks the model, and predictive back now shows it happening.

**Rule.** If forward enters from the right, back exits to the right. Enter-from-right
paired with exit-by-fade was survivable when back was instantaneous; with predictive back
rendering the reversal live under the user's finger, it is visibly wrong.

---

### T-025 — Where a gesture exists, motion follows the finger

**Claim.** Continuous, velocity-carrying gesture motion is the single strongest signal of
a native app. Fired transitions where a gesture was available is what ported apps feel
like.

**Rule.** Where a gesture is available, prefer velocity-continuous motion over a fired
transition: a sheet that drags rather than only animating closed on tap, a pane that
follows rather than snapping. This is a posture, not a per-site check.

---

### T-026 — One hero motion per event

**Claim.** When everything moves, nothing is emphasised. The thing that moves should be
the thing that changed.

**Rule.** One element leads an event; the rest support it or hold still. Six individually
correct springs firing at once satisfy every other rule in this file and still produce a
screen nobody can read.

**Why it is ours.** Every other rule governs motion in isolation. This is the only one
about how much motion an event may contain at all.

---

## Provenance

Taste is mostly inherited, not invented. What each rule adds is the decision its source
leaves open.

**Material is two things, and only one is taste.** Its *specs* — token values, component
anatomy, elevation, type scale — are not ours and belong to
[`hamen/material-3-skill`](https://github.com/hamen/material-3-skill). Its
*taste guidance* — which pattern suits which relationship, motion used sparingly,
expression in service of usability — is what we integrate, as the default for a product
that has not chosen otherwise.

### Whose standard we serve

**The product's own — whatever that is.** These skills help a team hold to the motion
language *they* chose, and choose one when they have not. They do not argue an app toward
Material.

"Their own" covers every case equally: M3 adopted wholesale, M3 extended, a wholly custom
system, or an inherited corporate language. A team that chose M3 has a standard that
happens to be Material — not the same as us applying Material to them, and the difference
shows the moment they want to depart from it.

- **A standard exists** → fidelity to it. Not improvement, not modernization, not M3
  conformance. Inconsistency with their standard is the finding; disagreement with our
  taste is not.
- **No standard exists** → help them decide, then hold them to it. The M3E default is a
  *proposal a human ratifies*, never applied silently.

### Resolution is per decision, not per codebase

For **this decision**, has the team said anything? Stop at the first rung that speaks:

0. The product's standard — `DECIDED` in MOTION.md, or a design system it points to
1. Pragmatic M3 Expressive
2. Craft — [Emil Kowalski's animation work](https://github.com/emilkowalski/skills) (MIT)
   and community practice, covering what M3 leaves silent
3. Ask

The same codebase draws from different rungs for different questions. A product that
customised three things follows its own standard for those three and M3E elsewhere. There
is no *threshold* of customisation at which resolution changes.

**One signal matters, to the fallback rather than to resolution.** An app with no
`androidx.compose.material3` dependency at all — built on Compose Foundation and UI, as
[Jewel](https://github.com/JetBrains/jewel) is — has declined Material rather than
customised it. Defaulting it to M3E imports a voice it avoided. Ask once; record the
answer.

**Gaps are normal.** Most design systems specify colour, type and spacing and say nothing
about motion. That is the condition the fallback exists for, not a finding.

**The fallback is overridable**, and **a skill says which rung it used** when a decision
resolves below rung 0.

### Two things this does not mean

**An accident is not a standard.** Only `DECIDED` sits at rung 0. A spec recurring across
thirty files is a copy-paste nobody examined. `OBSERVED` patterns are reported as
inconsistency, never enforced as doctrine.

**A standard is not a licence to harm users.** `floor` and `obligation` rules hold
regardless of MOTION.md.

### Sources

| Rule | Derived from | What we add |
|---|---|---|
| F-001, F-007, F-008, F-009, F-010 | d.android.com | Applied to motion specifically |
| F-002, F-003 | Compose docs | Made blocking rather than advisory |
| F-004 | d.android.com | Names the wrapping composables |
| F-005 | `MotionDurationScale` | Enumerates what bypasses it |
| F-006 | Open issue + source | Names the clip and scopes it to unintended cases |
| O-001 | Emil — reduced motion | **Inverted**: Android annihilates, so the carrier must be static |
| O-002 | Original (Lottie behaviour) | Makes the disabled frame a shipping requirement |
| T-001 | Original | Navigation defaults as an always-finding |
| T-002 | Emil — token discipline | Re-grounded on `MotionScheme`; extends to literal springs |
| T-004 | M3 Expressive vs Standard | Per-element, not per-surface |
| T-008 | d.android.com predictive back | Scoped to custom back |
| T-009 | Emil — frequency gate | State layer survives; ceiling governs additions |
| T-010 | M3 tier guidance | Tier and property count, not a duration ratio |
| T-011 | M3 transition patterns | Direction promises order; defines "peer" |
| T-012 | Emil — interruptibility | Re-grounded: gating input, not spec choice |
| T-013 | Emil — stagger | Budgets the sequence; fixes ordering |
| T-016 | M3 enter and exit | Scoped to unanchored centre scale |
| T-017, T-021 | Original | Compose-specific lifecycle traps |
| T-018 | Original | Platform fidelity as a product decision |
| T-019 | M3 skeleton loaders | Structural match, plus indicator floor |
| T-020 | Emil — cohesion | Scheme and tier, not one spec |
| T-022, T-023, T-024, T-025, T-026 | Original | Platform motion, perceived performance, reversal, gesture posture, restraint |

Eighteen of thirty-two derive from an existing source.

## Progress

**32 rules — 10 floor, 2 obligation, 20 taste.** Eight review-only, one partial, the rest
checkable.

Revision 01 applied three machine reviews. **Revision 02 applied the first human review**
(Seb, 2026-09-21): 26 keep, 1 revise, 5 discuss, **0 remove**. No rule was cut. The
outcomes were clarifications rather than reversals — self-timed versus touch-driven in
F-005 and F-007, the one-directional nature of F-009, what "platform state layer" means in
T-009, the full anti-flicker sequence in T-019, a real justification for T-001 in place of
a circular one, an honest split in F-006 between what a checker can see and what it cannot,
and untangling Android's *Remove animations* setting from Lottie's `reduced motion` marker
in O-002.

Still outstanding: a designer's review of the taste claims, which is a different question
from the engineering review this was.

Retired ids, not to be reused: **T-003** (restated a token fact), **T-007** (absorbed into
T-011), **T-014** (claim wrong for background list changes), **T-015** (claim contradicted
by Android's haptic vocabulary).
