<!-- GENERATED FILE — do not edit.
     Source: STANDARDS.md at the repository root.
     Regenerate with ./scripts/sync-references.sh -->

# Android motion standards

This document defines the 35 rules used by the skills in this repository. If a rule is not
listed here, the skills do not enforce it.

> [!NOTE]
> **Status: revision 02, plus T-027, T-028 and O-003.** 35 rules (`10` `floor`,
> `3` `obligation`, `22` `taste`).
>
> Revision 01 applied three model reviews (taste, structure, and fact-check). Those reviews
> removed three rules, resolved two contradictions between rules, and narrowed three rules
> that previously flagged valid Compose code. See REVISION-01.md for the
> details.
>
> Revision 02 applied the first human engineering review (`26` keep, `1` revise, `5`
> discuss, `0` remove), which clarified rule scopes and edge cases.
>
> None of the `taste` rules have been reviewed by a designer yet.

## Admission criteria

A rule belongs in this file only if it meets all six criteria:

1. **Decides something the official docs leave open.** Rules can build on Material Design
   guidance or established motion practice, but they must not repeat basic API facts or
   token tables. Material 3 token values, component specs, and theming rules belong in
   [`hamen/material-3-skill`](https://github.com/hamen/material-3-skill). A rule here must
   specify which surface it applies to, what threshold to use, what the default is, or when
   an exception applies.
2. **Uses concrete values and APIs.** State exact numbers, symbols, and APIs instead of
   vague adjectives.
3. **Is checkable in source, or marked `Detect: review-only`.** Either a violating snippet
   and its compliant fix fit in 40 lines or fewer, or the rule is marked
   `Detect: review-only` because the deciding fact (such as usage frequency or screen
   hierarchy) is not visible in source code.
4. **Cites a primary source for every platform fact.** Every claim about Android, Compose,
   Material, or Lottie behavior must name the exact file, symbol, or documentation page
   where that behavior is defined.
5. **Has a rule class.** Every rule is classified as `floor`, `obligation`, or `taste`.
6. **Is grounded in Android behavior.** When adapting a principle from web or iOS motion,
   re-derive the rule from how Android and Jetpack Compose work rather than simply swapping
   API names.

Every `taste` rule also starts with a one-sentence **Claim** stating the user-visible
effect before the implementation rule.

### Material bindings

Six rules refer to Material 3 tokens or patterns. Each of those rules separates its
Material-specific form from the general principle:

- **Material binding** — the Material 3 token name, transition pattern, or elevation model
  used when the app uses Material 3.
- **Outside Material** — how the same principle applies in an app with a custom design
  system.

Separating the two lets teams with custom design systems keep the underlying motion rules
while mapping them to their own tokens. Only `T-004` is specific to Material 3's
Expressive and Standard schemes.

## Rule classes

- `floor` — Mechanical and performance bugs in Compose motion. Always major, and never
  overridden by `MOTION.md`.
- `obligation` — Accessibility requirements: what the screen shows when animations are
  disabled, and whether motion left running can be stopped. Always major, never overridden
  by `MOTION.md`, and counted separately from `taste` in evaluation scores.
- `taste` — Design and interaction judgment. Overridable by an explicit `DECIDED` entry in
  the project's `MOTION.md` unless the rule states `Overridable: no`.

Evaluation runs grade and report `floor`, `obligation`, and `taste` findings separately
rather than averaging them together.

### Severity depends on project conventions

For `taste` rules, severity depends on what the project has already established in
`MOTION.md` or in the surrounding code:

| Situation | Severity |
|---|---|
| Contradicts a `DECIDED` entry in `MOTION.md` | **Major.** The team already made this decision. |
| Diverges from an established codebase convention — either an `OBSERVED` entry in `MOTION.md` or the same pattern done the compliant way elsewhere in the reviewed code | **Major.** Flagged as an inconsistency with the rest of the codebase. |
| Violates a `floor` or `obligation` rule | **Major**, regardless of `MOTION.md`. |
| Violates a `taste` rule where no convention exists in `MOTION.md` or the surrounding code | **Minor.** Worth noting in review, but does not block approval. |

A convention does not need a `MOTION.md` file to count. If the surrounding code already
follows a pattern—such as resolving transition specs through a token object—and one new call
site uses a raw default or literal, that inconsistency is **major**. When neither
`MOTION.md` nor the surrounding code sets a convention, `taste` findings stay **minor**.

---

## Floor

### F-001 — Frame-rate values are read in layout or draw, never composition

**Rule.** Read values that change every animation frame inside a lambda modifier rather
than passing them directly to a value modifier. Calling `Modifier.offset(x = animatedDp)`,
`Modifier.alpha(v)`, or `graphicsLayer(scaleX = v)` reads the state during composition and
recomposes the composable every frame.

Scope: properties that provide a lambda modifier overload (`offset`, `alpha`, and
`graphicsLayer` transforms).

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
the layout phase (specifically, during the layout phase's placement step)". For broader
phase guidance, see `chrisbanes/skills` (`compose-performance`).

---

### F-002 — A value the finger controls is an `Animatable`

**Rule.** Drive gesture-controlled positions with `Animatable`, and pass the gesture's
release velocity into `animateDecay` or `animateTo(targetValue, initialVelocity = velocity)`.
Using `animate*AsState` for a dragged value drops the finger's velocity, causing the motion
to stop or restart abruptly on release.

**Pinned.** `androidx.compose.animation.core.Animatable`, `animateDecay`.
**Detect:** heuristic — requires tracing how gesture state flows into the animation.

---

### F-003 — `animateItem()` requires a key

**Rule.** Every lazy list item that uses `Modifier.animateItem()` must provide a
`Bundle`-compatible `key` on `items(...)`. Without a key, Compose cannot track items across
reorders or insertions and plays broken animations without throwing an error.

Scope: missing keys, or keys whose type cannot be stored in a `Bundle`. What a present key
is derived from is outside this rule.

**Pinned.** developer.android.com: "It is important to provide a key to each item to
ensure `animateItem()` works as expected."

---

### F-004 — No shared elements across a View-backed container

**Rule.** `sharedElement` and `sharedBounds` cannot animate across an `AndroidView`
boundary or any composable backed by a separate platform window or view hierarchy,
including `Dialog` and `ModalBottomSheet`. Either keep both endpoints in the same Compose
hierarchy or use an enter/exit transition instead of a shared element.

**Pinned.** developer.android.com: "No interoperability between Views and Compose is
supported. This includes any composable that wraps `AndroidView`, such as a `Dialog` or
`ModalBottomSheet`." Stable since Compose Animation `1.10.0-alpha05`.

---

### F-005 — Self-timed motion reads the duration scale itself

**Rule.** "Self-timed" motion means an animation whose progress your own code steps forward
using a frame callback, timer, or media clock.

**Standard Compose animation APIs already respect the system duration scale.**
`animate*AsState`, `AnimatedVisibility`, `AnimatedContent`, `Transition`, and `Animatable`
run on the Compose animation clock, read `MotionDurationScale`, and snap to their end state
when animations are turned off. A gesture-driven `Animatable` is also handled automatically
by Compose.

Code that bypasses the Compose animation clock must read the scale itself:

| Bypasses the scale | Why |
|---|---|
| `withFrameNanos` loops | Your code advances the clock directly. |
| `LottieAnimatable.animate()` called directly | Declares `ignoreSystemAnimationsDisabled`, but never reads it. |
| Video, `WebView`, `SurfaceView` content | Runs outside Compose's animation clock. |
| `Animatable` launched from a coroutine scope without `MotionDurationScale` | `WindowRecomposer` only installs `MotionDurationScale` on the recomposer and effect contexts. |
| `basicMarquee` | Runs under its own `MotionDurationScale`, fixed at 1 by design. |

When the scale is zero, jump directly to a **static end state** and do not request new
frames. A marquee's static end state is its text, wrapped and in full. Inside a
`LaunchedEffect`, read `coroutineContext[MotionDurationScale]` on every iteration so the
loop stops immediately if the user disables animations while the screen is open:

```kotlin
LaunchedEffect(Unit) {
    val scale = coroutineContext[MotionDurationScale]
    var last = -1L
    while (true) {
        val factor = scale?.scaleFactor ?: 1f
        if (factor == 0f) {
            last = -1L
            delay(500) // at rest: no frames requested, check the setting twice a second
            continue
        }
        withFrameNanos { now ->
            if (last >= 0) advance((now - last) / factor)
            last = now
        }
    }
}
```

Outside a Compose effect (such as in a video player or `WebView`), read
`Settings.Global.ANIMATOR_DURATION_SCALE` with a `SettingNotFoundException` fallback, and
register a `ContentObserver` if the view stays alive across settings changes.

**Pinned.** `androidx.compose.ui.MotionDurationScale`, supported since Compose Animation
`1.2.0-alpha05`. On Android, `WindowRecomposer` installs `MotionDurationScaleImpl` in the
recomposer context (inherited by `LaunchedEffect`) and updates `scaleFactor` from a
`ContentObserver` on `ANIMATOR_DURATION_SCALE`. `withFrameNanos` does not apply the scale.
`Settings.Global.ANIMATOR_DURATION_SCALE`: "Setting to 0.0f will cause animations to end
immediately." `LottieAnimatable.animate()` declares `ignoreSystemAnimationsDisabled` but
never reads it in the implementation. `BasicMarquee.kt:401-404` runs the marquee inside
`withContext(FixedMotionDurationScale)`, under the comment "Marquee animations should not
be affected by motion accessibility settings"; `:545-549` defines that scale's
`scaleFactor` as `1f`.

---

### F-006 — `animateContentSize` clips its child

**Detect: partial.** Clipping a shadow or elevated surface is checkable in source; other
uses are review-only.

**Rule.** `Modifier.animateContentSize()` applies `clipToBounds` unconditionally. Any drop
shadow, elevation shadow, ripple extending outside the bounds, or nested
`AnimatedVisibility` exit overflowing the container gets clipped. Setting
`SizeTransform(clip = false)` on an inner animation cannot undo an outer
`animateContentSize`.

Because source code alone does not always show whether clipping is intentional, this rule
splits into two cases:

- **Checkable defect:** `animateContentSize` applied on the same modifier chain after
  `Modifier.shadow`, a non-zero `elevation`, or directly on an elevated `Card` or `Surface`
  whose shadow it cuts off.
- **Review-only:** `animateContentSize` on a container without shadows or elevation. A
  clipped reveal is often intentional; when reviewing without a rendered preview, note that
  it clips and ask whether that is intended rather than flagging it as a bug.

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

**Pinned.** `clipToBounds` is applied in both overloads at `AnimationModifier.kt:69-78`
(not mentioned in KDoc). Reported in
[issuetracker 225932760](https://issuetracker.google.com/issues/225932760), where the clip
is marked as intended behavior.

---

### F-007 — Motion state that survives rotation must be saveable

**Rule.** `remember` keeps state across recompositions, but resets when the Activity is
recreated on rotation or configuration change. If an `Animatable` or state holder stores a
user-placed position in plain `remember`, rotating the device snaps the UI back to its
initial position.

Scope: **touch-driven positions placed by the user**, such as a bottom sheet offset, a
swiped carousel page, or an in-progress drag reorder. Time-driven animations that happen to
be mid-flight during rotation are outside this rule; restarting or finishing them on
recreation does not lose user state.

**Pinned.** developer.android.com: on configuration change "the system recreates the
activity… Compose recreates the UI". `rememberSaveable` survives Activity recreation;
`remember` does not.

---

### F-008 — Layout properties have no cheap animated form

**Rule.** `Modifier.padding`, `size`, `width`, and `height` have no lambda overloads.
Animating their inputs reads state during composition and forces Compose to recompose and
remeasure the layout on every frame. When the visual change is only a position shift, use
`Modifier.offset { }` or `Modifier.graphicsLayer { }`. Only animate layout dimensions when
neighboring elements genuinely need to reflow around the changing size.

**Pinned.** `Padding.kt:54-144` defines four value overloads and no lambda overload.

---

### F-009 — Feel is not assessed in a debug build

**Detect: review-only.** This rule governs how performance claims are verified rather than
what source code contains.

**Rule.** Never judge animation smoothness, frame drops, or perceived speed from a debug
build. Compose debug builds run without R8 optimizations or baseline profiles, so frame
times in debug do not represent production behavior. Always verify motion feel on a physical
device running a release build with R8 enabled.

**This rule works in one direction:** debug builds are strictly slower than release builds.
If an animation is smooth in a debug build, it will be smooth in release. However, jank
observed in a debug build does not prove a release problem, and optimizing code based only
on debug jank can add unnecessary complexity.

**Pinned.** developer.android.com: "You can only reliably measure the performance of a
Lazy layout when running in release mode and with R8 optimization enabled."

---

### F-010 — `sharedElement` demands identical content; otherwise `sharedBounds`

**Detect: review-only.** Determining whether two composables render identical content
requires reading both layouts in context.

**Rule.** Use `sharedElement` only when the source and destination render the exact same
visual content. When the content changes between states—such as a different composable, a
changed font weight or text style, or a different background color—use `sharedBounds`
instead. Using `sharedElement` on visually different content produces an abrupt visual
mismatch during the transition.

**Pinned.** developer.android.com: "`sharedBounds()` is for content that is visually
different but should share the same area between states, whereas `sharedElement()` expects
the content to be the same"; for `Text`, "`sharedBounds()` is preferred to support font
changes".

---

## Obligation

Accessibility requirements: what the screen shows when animations are disabled, and
whether motion left running can be stopped. Never overridable, and counted separately from
`taste` findings.

### O-001 — Meaning must have a static carrier

**Overridable: no.**

**Claim.** Information communicated by motion must remain clear when animations are turned
off.

**Scope: meaning carried by the motion of your own layout** — such as an item moving to a
new group, a section expanding, or an indicator pulsing to show status. What an animation
file displays once it stops is outside this rule.

**Rule.** Turning on Android's "Remove animations" accessibility setting writes `0.0f` to
all three system animation scales. Unlike CSS `prefers-reduced-motion`, Android does not
slow animations down or play a gentler substitute; it snaps every Compose transition and
any substitute animation straight to its end state.

Because no animation plays at scale zero, **the resting UI state must communicate the same
information on its own**. A moved item must be identifiable in its new place, an expanded
section must look expanded at rest, and a status indicator that pulses must also have a
static label, icon, or color change. If turning off animations hides the state change, the
UI was relying on motion alone to carry meaning.

**Pinned.** AOSP `RemoveAnimationsPreference.kt:118-131` writes `0.0f` to
`WINDOW_ANIMATION_SCALE`, `TRANSITION_ANIMATION_SCALE`, and `ANIMATOR_DURATION_SCALE`
(Settings → Accessibility → Color and motion; deep link `g.co/android/animations`).
`ValueAnimator.areAnimatorsEnabled()` (API 26+) returns a boolean and can also be disabled
by battery saver modes on some devices.

---

### O-002 — Every Lottie has a readable disabled frame

**Overridable: no.**

**Claim.** When animations are disabled, a Lottie animation stops on a single frame. That
resting frame must show a complete, legible illustration rather than a blank or half-drawn
canvas.

**Two separate mechanisms use the phrase "reduced motion":**

- **Remove animations** is the Android system setting (Settings → Accessibility → Color and
  motion) that sets the three animation duration scales to `0.0f`.
- **`reduced motion`** is a named marker inside a Lottie `.json` file (`reduced motion`,
  `reduced_motion`, `reduced-motion`, or `reducedmotion`). Lottie looks for this marker when
  system animations are disabled.

**Rule.** When system animations are off, Lottie jumps to the **last** frame of the
composition (or the first frame if `speed < 0`), unless the `.json` defines a
`reduced motion` marker, in which case Lottie renders that marker's `startFrame`. If an
animation's final frame fades out or clears the canvas and the file has no marker, users
with animations disabled see an empty space.

A composition whose final frame already shows the complete illustration needs no marker.
When the final frame is blank or mid-transition, add a `reduced motion` marker in the
`.json` or bound playback with a `LottieClipSpec` whose end frame is legible.

**How Compose applies the marker:** `animateLottieCompositionAsState` divides playback
speed by the system animator scale, which produces `Float.POSITIVE_INFINITY` at scale zero
and causes `LottieAnimatable` to jump to `endProgress`. Separately, `LottieAnimation` checks
at draw time whether animations are disabled and overrides the drawn frame with the
`reduced motion` marker's `startFrame`.

Because that override happens inside `LottieAnimation` at draw time, **code that reads
`LottieAnimationState.progress` directly** (such as a custom painter or `graphicsLayer`)
only sees `endProgress` and ignores the marker. In those cases, the composition's final
frame or `LottieClipSpec` end frame must itself be readable.

Scope: the resting frame a Lottie displays when animations are disabled. Code that keeps a
Lottie playing while animations are off is outside this rule.

**Pinned — the marker.** `LottieDrawable.java:99-112` defines the four accepted marker
names (`reduced motion`, `reduced_motion`, `reduced-motion`, `reducedmotion`, matched
case-insensitively); `:899-911` defines `getMarkerForAnimationsDisabled()`; `:1293-1299`
defines `animationsEnabled()`; `SystemReducedMotionOption.java:21-27` maps animator scale
zero to `REDUCED_MOTION`.

**Pinned — the Compose path.** `LottieAnimation.kt:138-143` applies the draw-time override
(`if (!drawable.animationsEnabled(context) && markerForAnimationsDisabled != null)
drawable.progress = markerForAnimationsDisabled.startFrame`), added in commit `66bc2fb`;
`animateLottieCompositionAsState.kt:59-64` computes `speed / Utils.getAnimationScale(...)`
(dividing by zero yields `POSITIVE_INFINITY`); `LottieAnimatable.kt:242-260` snaps to
`endProgress` when `speed.isInfinite()`; `:199-205` defines `endProgress` as `clipSpec` max
(or min when speed is negative).

---

### O-003 — Endless motion can be stopped

**Overridable: no.**

**Detect: partial.** An endless run is in the source. Whether a finite one outlasts five
seconds can depend on how wide its content is at runtime.

**Claim.** Motion that keeps going beside something the user is trying to read pulls the
eye back every time it moves. For some users that decides whether the screen can be read at
all.

**Scope: motion that starts by itself, runs longer than five seconds, and shares the screen
with other content** — an `infiniteRepeatable` pulse or shimmer, a Lottie on
`LottieConstants.IterateForever`, a `basicMarquee`, a pager that advances on a timer.
Outside it:

- **An indicator of work that blocks the screen**, only while nothing else on the screen
  can be used. The work holds the screen, and an indicator that did not move could make it
  look frozen. An indicator that runs longer than five seconds beside content the user can
  use is inside the rule.
- **Motion the user started and can stop** — a video they pressed play on, with its own
  controls.
- **Motion the finger drives.**

**Rule.** It stops by itself within five seconds, or the screen gives the user a way to
pause, stop or hide it — a control on that screen, not a setting somewhere else. Where a
screen has several, one control stops them all. For text, the simplest way to comply is not
to scroll it at all: wrap it, or truncate it and give the user a way to reach the full
message.

The control can be the moving element itself, paused and resumed by a tap, as long as
accessibility services announce it as a control. Make it `clickable` with an `onClickLabel`
that names the action, "Pause" or "Resume", so TalkBack and Switch Access can find it.
Pausing only while a finger holds it does not count, for the same reason WCAG gives for
motion that stops only while it has focus.

Stopping by itself means a bounded run: a `repeatable` whose iterations total under five
seconds, or a Lottie with a finite `iterations`. Lowering `basicMarquee`'s `iterations`
rarely gets it under five seconds, and when a finite run ends the marquee snaps back to the
start of its text, so the text stays clipped.

Whichever way it stops, it rests somewhere readable. A marquee halted part-way through its
text hides the rest of the message; show the message in full. A `basicMarquee` cannot pause
where it is: stopping it returns it to the start of its text. So pausing a marquee should
show the same static text as the animations-off state, wrapped and in full.

**Remove animations is not the mechanism.** Where the motion ignores Remove animations,
as `basicMarquee` and a frame loop that never reads the scale do, the app has to honour it
itself (F-005). Doing so still does not satisfy this rule, because Remove animations is one
system-wide switch, not a control on the screen.

**What Android changes.** WCAG states the requirement for the web, where a page can
listen for `prefers-reduced-motion`. Android has no such preference, and the one setting
it has is bypassed by the framework's own marquee — so the control has to be in the app.

**Pinned.** WCAG 2.2, SC 2.2.2 Pause, Stop, Hide (Level A): moving content that "starts
automatically, lasts more than five seconds, and is presented in parallel with other
content" needs "a mechanism for the user to pause, stop, or hide it"; sufficient
techniques G152 (stop after n cycles, within five seconds) and G186 (a control that stops
the moving content). Understanding SC 2.2.2: "An animation that occurs as part of a
preload phase or similar situation can be considered essential if interaction cannot occur
during that phase for all users and if not indicating progress could confuse users or
cause them to think that content was frozen or broken." Its Intent: "other mechanisms than
a button can be used", but "having an animation stop only so long as a user has focus on
it … would not be considered a 'mechanism for the user to pause'".
`BasicMarquee.kt:401-404` — `withContext(FixedMotionDurationScale)`, under the comment
"Marquee animations should not be affected by motion accessibility settings", and
`:545-549`, which pins its `scaleFactor` to `1f`; `:429-433` — every run, finished or
cancelled, ends in `finally { offset.snapTo(0f) }`, back at the leading edge.

---

## Taste

### T-001 — The `NavHost` default transition is a finding

**Claim.** Navigation Compose defaults to a 700ms cross-fade, which exceeds Material 3's
maximum screen transition duration and leaves both screens partially transparent on top of
each other for most of a second on every navigation.

**Rule.** Always replace the 700ms library default on `NavHost` (by setting
`enterTransition` and `exitTransition`, plus `popEnterTransition` and `popExitTransition`
when reverse transitions differ) or `NavDisplay` in Navigation 3. The issue is the **700ms
duration, not the cross-fade pattern**: a shorter cross-fade resolved from a motion token
is valid for top-level destinations.

**Contextual severity:** In a codebase with no established motion tokens, leaving the
default `NavHost` transition is **minor**. In a codebase that already resolves transitions
through `MaterialTheme.motionScheme` or its own motion tokens—even within the same
file—leaving `NavHost` on its 700ms default is **major** because it breaks the project's
convention.

**Pinned — why 700ms is too long.** Material 3 duration tokens top out at 600ms
(`extraLong4`), and Material 3's standard screen transition is 500ms emphasized (or 400ms
enter / 200ms exit). Navigation Compose's 700ms default is 40% longer than Material's
longest transition token.

**Pinned.** `DefaultNavTransitions.android.kt:35-47`; Navigation 3
`NavDisplay.android.kt:32-48` (`DEFAULT_TRANSITION_DURATION_MILLISECOND = 700`).

---

### T-002 — No bare `tween()` or `spring()` at a call site

**Claim.** Hardcoded durations and springs scattered across call sites drift apart and make
a product's motion inconsistent.

**Rule.** Resolve every animation spec from `MaterialTheme.motionScheme` or from the
project's own motion token object. Call-site `tween(…)` and `spring(…)` literals belong
only inside token definitions.

Scope: specs written in the product's own code. Library defaults applied when a caller
passes no spec parameter are outside this rule.

**Material binding.** Use `MaterialTheme.motionScheme` as the default token source. Because
`MotionScheme` defines springs rather than durations, keyframe or fixed-duration animations
must resolve to a named token in the codebase rather than an inline number.

**Outside Material.** Resolve specs through the project's own motion token object.

**Pinned.** `MotionScheme` is annotated with `@Immutable`; its experimental opt-in was
removed in androidx commit `8ada756` ("Graduate MotionScheme from experimental"), shipped
in `1.5.0-alpha15`.

---

### T-004 — Expressive spatial springs stay off elements read as data

**Claim.** Bouncy motion on a chart bar, table row, or number makes the data harder to read
while it settles.

**Rule.** Material 3's Expressive fast spatial spring (`dampingRatio 0.6 / stiffness 800`)
visibly overshoots. Do not use Expressive spatial springs on elements whose **position or
length represents data**, such as chart bars, plotted points, table rows, or numeric
readouts. Use the Standard spatial spring or an effects spec on those elements instead.
Expressive spatial springs remain appropriate on the containers around them, such as a
sheet, floating action button (FAB), or card.

Effects springs are identical in both the Expressive and Standard schemes (`1.0/3800`,
`1.0/1600`, `1.0/800`), so switching schemes does not change fades or color transitions.

**Material binding.** This rule applies specifically to Material 3's Expressive and
Standard motion schemes.

**Outside Material.** In a custom design system, keep underdamped (bouncy) spatial springs
off elements whose position or size represents data, and record that rule in `MOTION.md`.

**Pinned.** `ExpressiveMotionTokens.kt:21-33` and `StandardMotionTokens.kt:19-31` define
identical effects spring values in both files. Material 3 guidance states that Expressive
"should be used for most situations, particularly hero moments and key interactions" and
Standard "should be used for utilitarian products".

---

### T-008 — Custom back is seekable or it is broken

**Claim.** Predictive back lets the user scrub a transition with their finger. A custom
back handler that waits for finger release before starting its animation breaks that
gesture preview.

**Rule.** Scope: **custom back handlers implemented in app code**, such as hand-rolled
sheets, overlays, or `BackHandler {}` blocks that close animated UI. Standard `NavHost`
destinations already support predictive back out of the box and must not be flagged.

Drive custom back transitions with gesture progress using `PredictiveBackHandler` and
`SeekableTransitionState`.

**Pinned.** `NavHost.kt` (~L823-940) installs its own predictive back handler and calls
`SeekableTransitionState.seekTo(progress, previousEntry)`. On Android 16+ devices, apps
targeting Android 16+ no longer receive `onBackPressed` or `KeyEvent.KEYCODE_BACK`
(developer.android.com).

---

### T-009 — Frequency sets the ceiling

**Detect: review-only.** How often a user triggers an interaction is not visible in source
code unless `MOTION.md` records it.

**Claim.** An expressive animation that feels pleasant once a week becomes an obstacle when
triggered forty times in a session.

**Scope: motion triggered directly by user input or navigation.** Outcomes of background
work, even when started by the user, are outside this rule.

**Rule.** Cap animation intensity based on how often a user encounters the surface:

| Frequency | Maximum motion |
|---|---|
| 100+ times per day | Platform state layer only |
| Tens of times per day | Fast tier from the motion scheme |
| Occasional | Default tier from the motion scheme |
| Rare or first-run | Expressive or celebratory motion allowed |

**Platform state layer** refers to the built-in press, hover, focus, and drag feedback
provided by standard interactive components—on Material 3, the ripple, tonal state overlay,
and press shape morph on `Button`, `ListItem`, and `Card`. On a custom design system, it is
the equivalent built-in touch feedback.

Built-in state-layer feedback is always allowed at any frequency. This rule caps additional
motion layered on top of it. Removing the state layer altogether (for example, calling
`Modifier.clickable(indication = null, ...)` by mistake) is a defect unless documented as
a product-wide rule in `MOTION.md`.

---

### T-010 — Exits use fewer properties, not shorter durations

**Claim.** When an in-place UI element closes, the user has already shifted attention to
what remains on screen.

**Rule.** For components that appear and disappear in place, make the exit simpler than the
entrance by animating **fewer properties on a faster tier**, rather than halving a duration:

- **Entrance:** spatial + effects (for example, expand/scale plus fade).
- **Exit:** effects only (fade out, optionally paired with a fast-tier `shrinkVertically`
  or `shrinkHorizontally` so the surrounding layout closes smoothly instead of snapping
  shut after the fade).

**Material binding.** Use `defaultSpatialSpec` + `defaultEffectsSpec` on enter, and
`fastEffectsSpec` on exit.

**Outside Material.** Animate both position/scale and opacity on entrance, and only opacity
(plus layout slot collapse) on exit.

**Scope — components that appear and disappear in place** (menus, tooltips, popups, badges,
and inline expandable sections). The following cases are outside this rule:

- **Surfaces that travel from an edge or source** (sheets, drawers, side panels, shared
  elements, and container transforms). Those exit back toward their origin.
- **Gesture-driven dismissals** (swipe-to-dismiss or predictive back), whose timing follows
  the user's finger.
- **In-place emphasis changes** where a persistent element changes alpha, color, or
  elevation without entering or leaving.
- **Clamped content** (such as text truncated to three lines) that stays on screen.
- **Full-screen destination transitions** between screens.

**Why duration ratios do not apply:** Spring tokens have no duration parameter to halve. In
Material 3's spring system, entrance/exit asymmetry is expressed through tier selection and
property count.

---

### T-011 — The pattern states the relationship

**Detect: review-only.** The hierarchical or peer relationship between screens depends on
app information architecture.

**Claim.** Screen transitions tell the user how two destinations relate in the app's
structure. Using a directional slide between unrelated sections implies a spatial order
that does not exist.

**Rule.** Use directional transitions only when destinations have a defined **order** (such
as steps in a sign-up flow or a swipeable `TabRow` + `Pager`). A swipe gesture is not
required for ordered steps—a Next/Back wizard is ordered and should slide laterally.

| Screen relationship | Transition pattern |
|---|---|
| One element expands into the next screen | Container transform |
| Parent to child in a hierarchy | Forward and backward |
| Ordered peers (wizard steps, horizontal pager tabs) | Lateral slide |
| **Unordered top-level destinations** (bottom bar, navigation rail, drawer) | **Top-level cross-fade** |
| Component appearing in place | Enter and exit |

Top-level destinations in a navigation bar, rail, or drawer are unordered peers: system
back returns to the start destination rather than stepping laterally, and deep links can
open any tab directly. Use a cross-fade (or fade-through) between them, never a directional
slide.

**Material binding.** The five Material 3 transition patterns above (and `MaterialContainerTransform`,
`MaterialSharedAxis`, and `MaterialFadeThrough` in MDC-Android).

**Outside Material.** Map the project's custom transitions to these five structural
relationships in `MOTION.md`.

---

### T-012 — Never gate input on an animation finishing

**Claim.** Disabling buttons or ignoring touches while an animation finishes makes the app
feel unresponsive.

**Rule.** Keep controls interactive while animations run. Do not gate input on animation
state (`enabled = !isAnimating`), call `snapTo()` immediately before `animateTo()` in a way
that resets in-flight progress, or run sequential `delay()` chains inside an unkeyed
`LaunchedEffect` that ignores new taps until the sequence finishes.

A `LaunchedEffect(state)` block that runs `delay()` before `animateTo()` **is allowed**,
because a new state change cancels the coroutine (including any pending `delay()`) and
starts the new transition immediately. Retargeting a `tween` mid-flight is also allowed by
this rule, because Compose continues smoothly from the current animated value.

**Pinned.** `Animatable.animateTo` cancels any in-flight animation on the same `Animatable`
and starts from the current value and velocity.

---

### T-013 — Stagger has a total budget, not a per-item delay

**Detect: review-only.** The number of items in a list is usually determined at runtime.

**Claim.** A short stagger groups items into a single cascade, but a fixed delay multiplied
across a long list forces the user to wait for a slow queue of arrivals.

**Rule.** Cap the **total stagger window** from the first item starting to the last item
starting at roughly **300ms** (unless `MOTION.md` sets a different cap). Do not use an
unbounded `index * delayMs` formula that grows linearly with list length. When a list has
more items than fit in the budget, cap the maximum delay so trailing items start together
at the end of the 300ms window. Never place later items on screen before earlier items have
started animating.

This budget applies to two cases:

- **Items entering the viewport together** on initial load (never stagger items as they
  scroll into view).
- **Discrete parts of a single control updating in place** (such as stars in a rating bar
  filling in sequence). Only animate the parts whose state actually changed.

**Pinned.** `SpringSpec` has no start-delay parameter (`dampingRatio`, `stiffness`, and
`visibilityThreshold` only), and `repeatable(initialStartOffset = ...)` only accepts a
`DurationBasedAnimationSpec`. To stagger spring animations, launch one coroutine per item
keyed to the target state, call `delay(staggerMs)`, and then call `animateTo(...)` so a new
input cancels any pending delays.

---

### T-016 — Unanchored surfaces expand; they do not scale from centre

**Claim.** Scaling a dialog or panel up from its center makes it look like it is flying
toward the user along the z-axis, which clashes with Material 3's flat elevation model.

**Rule.** Scope: **unanchored** surfaces that appear in the middle of the screen without a
trigger element. Expand those surfaces along an axis (or fade them in) rather than scaling
from `0f` or `0.8f` around their center.

Surfaces **anchored to a trigger**—such as a `DropdownMenu` scaling out from the button
that opened it, or a container transform expanding from a card—may use scale with an explicit
`transformOrigin`, because the motion reads as growing out of the trigger.

**Material binding.** Material 3's enter-and-exit guidance and reduced elevation model.

**Outside Material.** Applies to any design system that avoids z-axis depth effects. Design
systems that intentionally use central scale for modals can record that choice as `DECIDED`
in `MOTION.md`.

**Pinned.** Material 3 enter-and-exit guidance specifies axis expansion rather than central
scaling. Contrast with anchored menus: `DropdownMenuContent` in `Menu.kt` (~L1827-1855)
scales `0.8f → 1.0f` using `FastSpatial` from its anchor `transformOrigin`.

---

### T-017 — A screen introduces itself once

**Claim.** Playing an entrance animation again when the user navigates back to a screen
makes back navigation feel slow and suggests the content was reloaded.

**Rule.** Run one-off entrance choreography only when a destination first enters the back
stack, not when the user pops back to it from a child screen.

**Mechanism.** A plain `LaunchedEffect(Unit)` runs every time a composable re-enters
composition, including when popping back from a detail screen. Store the "has played
entrance" boolean in `rememberSaveable` or in the screen's `ViewModel` / state holder.

---

### T-018 — Platform overscroll stays unless deliberately replaced

**Claim.** Android's stretch overscroll at the edge of a scrolling list tells the user they
have reached the boundary and matches the rest of the operating system.

**Rule.** Keep the default platform overscroll effect on scrollable containers instead of
disabling it (`LocalOverscrollFactory provides null` / `overscrollEffect = null`) or
replacing it with a custom bounce:

- **Endless or looping carousels** have no boundary to stretch against, so disabling
  overscroll on them is valid without a comment.
- **Per-component replacements** on other views require a brief comment explaining why
  platform overscroll does not fit that component.
- **App-wide overscroll replacement or removal** must be recorded as a `DECIDED` entry in
  `MOTION.md`.

**Pinned.** Stretch overscroll has been Android's platform default since Android 12
(API 31).

---

### T-019 — Skeletons match structure; indicators have a floor

**Detect: review-only.** Checking whether a placeholder matches the loaded layout requires
comparing both compositions.

**Claim.** A skeleton placeholder previews the shape of incoming content, and a loading
spinner that flashes for a few milliseconds looks like a rendering glitch.

**Scope: placeholders shown in place of loading content** (skeleton screens and loading
spinners). Immediate press feedback inside the control the user just tapped—such as a
button label changing to "Saving…"—is outside this rule.

**Rule.** When the loaded layout's structure is known in advance, use a skeleton that
matches its coarse layout geometry. When the layout structure varies or is unknown, use an
indeterminate progress indicator.

In both cases, prevent brief flashes on fast loads by following this four-step sequence:

1. **Wait ~150ms before showing the placeholder.** If the data arrives within 150ms, never
   show the placeholder at all.
2. **Fade the placeholder in** rather than popping it onto the screen in a single frame.
3. **Hold the placeholder for a minimum visible duration** once it appears, even if data
   arrives right after the fade-in starts, so the placeholder does not flash and vanish.
4. **Cross-fade from the placeholder to the loaded content** rather than cutting abruptly.

**Material binding.** Material 3 defines skeleton loaders as a standard transition pattern.

**Outside Material.** Both the structural match requirement and the delay/minimum-hold
timing apply in any design system.

---

### T-020 — One event, one scheme and one tier

**Detect: review-only.** Grouping separate animations into a single user-perceived event
requires reading the screen composition as a whole.

**Claim.** When a container and its contents animate together on mismatched speed tiers,
the transition looks disjointed.

**Rule.** All animations that run together in the **same direction of a single user-perceived
event** must use the same motion **scheme and speed tier** (for example, `defaultSpatialSpec`
and `defaultEffectsSpec` from the same scheme). A common violation is animating an
expanding panel on the `slow` tier while sliding its inner rows in on the `fast` tier.

**Scope: elements moving together as part of one transition** (such as a panel and the
controls revealed inside it). Data visualizations whose position encodes a value (chart
bars, plotted points) move to show that value rather than moving with the pane, and are
outside this rule.

Only compare animations moving in the same phase of the same event: compare entering
elements with entering elements, and exiting elements with exiting elements. Do not compare
an entrance spec with the exit spec that mirrors it, or compare across separate user
inputs. System window transitions are also outside this rule.

---

### T-021 — Keys identify content, not position

**Claim.** Keying a lazy list by index causes every item after an insertion or deletion to
re-run its item animation as if the whole list had changed.

**Rule.** Pass a stable item ID (such as `key = { item.id }`) to `items(...)` or
`itemsIndexed(...)`, never the list index (`key = { index -> index }`) or a key derived
from list position. When an item is inserted at the top, index-based keys shift for every
following row and trigger false animations down the list.

Scope: lists that already provide a `key` parameter. Whether a `key` exists at all is
outside this rule.

---

### T-022 — Content tracks the keyboard, it does not jump

**Claim.** The software keyboard slides smoothly onto the screen. Repositioning input
fields on a boolean visibility callback causes the layout to jump in a single frame while
the keyboard is still moving.

**Rule.** Drive keyboard-avoiding layout shifts from the animated `WindowInsets.ime` inset
(or `Modifier.imePadding()`) rather than toggling padding or arrangement from a boolean
`isKeyboardVisible` state.

**Pinned.** `WindowInsets.ime`, `Modifier.imePadding()`.

---

### T-023 — Motion starts on the input frame

**Claim.** Users judge responsiveness by when visual feedback starts, not when a network or
disk request finishes.

**Rule.** Start visual feedback or screen transitions on the frame the user taps, rather
than waiting for an asynchronous call to return before starting the animation. If a button
triggers an async action, reflect the active state on the button immediately on tap. If a
tap navigates to a new screen, transition immediately and show a loading state in the
destination rather than holding the origin screen still.

---

### T-024 — Back plays the inverse of forward

**Claim.** Navigating back reverses the path the user took to get there. If a screen slides
in from the right on forward navigation, fading it out on back breaks spatial
continuity—especially under predictive back, where the user scrubs the exit live.

**Scope: surfaces and destinations that traveled from an edge or origin** (pushed screens,
bottom or side sheets, drawers, and shared elements). Components that appear in place
without directional travel (menus, tooltips, badges) have no path to retrace and are
outside this rule.

**Rule.** Match the back/dismiss exit direction to the inverse of the entrance direction.
A screen that enters by sliding from the right must exit by sliding back to the right on
pop.

---

### T-025 — A hand-rolled surface drags like the one it replaces

**Detect: review-only.** Recognizing that a custom composable replaces a standard draggable
sheet, drawer, or card requires reading the UI role in context.

**Claim.** Standard Android sheets, drawers, and dismissible cards follow the user's finger
during a drag. A custom replacement that only opens and closes on button taps feels rigid.

**Scope: custom sheets, drawers, panels, and dismissible cards** that stand in for a
platform component users normally drag. Predictive back and release velocity on an existing
drag handler are outside this rule.

**Rule.** Support direct finger dragging (such as `anchoredDraggable` or `draggable`) on
custom sheets, drawers, and swipeable cards rather than only toggling them with tap
animations.

---

### T-026 — One hero motion per event

**Claim.** When five separate cards, headers, and badges animate with independent springs
on the same state change, they compete for attention and make the screen hard to scan.

**Rule.** Give each state change a single primary motion, and keep sibling elements either
static or subordinate to that transition. Report this as **one finding at the parent
composable** that coordinates the competing animations, rather than flagging each child
composable separately.

**Group parts of a single control together:** Five stars inside one rating bar are five
parts of a single control, not five competing controls. When multiple parts of one control
change together, stagger them in sequence so they read as one coordinated sweep rather than
suppressing four of the five stars. Reserve suppression for separate sibling components
that do not need independent entrance or emphasis animations on the same event.

---

### T-027 — A correction is not a celebration

**Detect: review-only.** Determining which state direction represents progress versus
undoing an action depends on product semantics.

**Claim.** Bouncy, expressive motion celebrates an action. Playing the same celebratory
bounce when a user undoes an action—such as un-starring an item or clearing a
bookmark—treats a retraction like an achievement.

**Scope: controls that toggle or step between states in place** (favorites, bookmarks,
ratings, and counters). Component entrances and exits are outside this rule.

**Rule.** When one direction of a control represents positive commitment (saving, liking,
increasing a rating) and the opposite direction represents clearing or undoing it, make the
retraction calmer or faster than the activation. For example, animate activation with an
Expressive spring or scale pop, and animate clearing with a Standard spring or a simple
color/fade transition.

**Neutral toggles are exempt:** Controls where neither state is "progress"—such as a
dark/light theme toggle, an expand/collapse chevron, or a filter chip—should animate
symmetrically in both directions.

---

### T-028 — Background work finishes quietly

**Detect: review-only.** Telling background sync apart from user-blocking actions requires
checking how the work was triggered and whether the current screen depends on it.

**Claim.** Prominent banners and motion draw the user's eye away from what they are reading.
Using them to announce routine background sync completions interrupts the user for app
housekeeping.

**Scope: background syncs, prefetches, and uploads**, whether scheduled automatically or
started via a "Sync now" / pull-to-refresh action. Foreground actions that block the
current screen (such as submitting a checkout form) are outside this rule.

**Rule.**

- **While running:** Show progress quietly in place (such as a small inline icon or subtle
  progress bar). If it keeps moving for longer than five seconds, it also needs a way to
  pause, stop or hide it (O-003).
- **On success:** Hide the running indicator without displacing layout content. If the user
  explicitly triggered the sync (for example, tapping "Sync now"), a brief non-blocking
  confirmation—such as a snackbar or the button briefly showing "Synced"—is allowed. Never
  show a modal dialog or insert a layout-shifting banner for a completed background sync.
- **On failure:** Show an inline error on the current screen only if the failure makes the
  current screen's content stale or unusable. Otherwise, report the failure through a
  system notification (updating the existing notification ID with `setOnlyAlertOnce(true)`
  so repeated retries do not keep alerting the user).

**Pinned.** developer.android.com ("Foreground services overview" and "Create a
notification"): calling `notify()` with an existing ID updates the notification in place,
and `setOnlyAlertOnce()` alerts the user only on the first appearance.

---

## Provenance

Most rules in this file adapt existing Android, Compose, or motion-design guidance and fill
in the concrete thresholds or Compose APIs that the upstream docs leave open.

**Separation from Material 3 component specs:** Material 3 token tables, component padding,
elevation values, and typography belong to
[`hamen/material-3-skill`](https://github.com/hamen/material-3-skill). This file covers
only motion behavior and transition choices.

### Whose standard applies

These skills enforce the **project's own motion language** first, whether that language is
Material 3 Expressive, customized Material 3, or a custom design system:

- **When the project has a defined standard (`MOTION.md` or clear code conventions):**
  Check code for consistency with that standard rather than pushing it toward Material 3
  defaults.
- **When the project has no defined standard:** Use the fallback ladder below, and state
  which rung provided the default so the team can approve or override it.

### Per-decision resolution ladder

Each motion question resolves independently down this list, stopping at the first rung that
answers it:

0. **Project standard:** `DECIDED` entries in `MOTION.md`, or the design system it names.
1. **Material 3 Expressive:** Default spatial and effects tokens from `MotionScheme`.
2. **Craft defaults:** The rules in this file (drawing on
   [Emil Kowalski's animation principles](https://github.com/emilkowalski/skills), MIT, re-derived
   for Android).
3. **Ask the user:** When the question depends on product intent not visible in code.

A project that customizes three transitions uses Rung 0 for those three and falls back to
Rung 1 or Rung 2 for the rest.

**Non-Material projects:** If a repository does not depend on
`androidx.compose.material3` at all (building directly on Compose Foundation and UI, like
[Jewel](https://github.com/JetBrains/jewel)), do not assume Material 3 Expressive as
Rung 1. Ask once what fallback the team wants and record the answer in `MOTION.md`.

**Unratified code patterns vs. standards:** Only human-approved `DECIDED` entries sit at
Rung 0. Repeated patterns found in code (`OBSERVED`) are flagged when a new file breaks
consistency with them, but they never override `floor` or `obligation` rules.

### Rule sources

| Rule | Upstream source | What this file adds |
|---|---|---|
| F-001, F-007, F-008, F-009, F-010 | developer.android.com | Concrete Compose motion triggers and fixes |
| F-002, F-003 | Compose animation docs | Treated as blocking review findings |
| F-004 | developer.android.com | Lists the affected wrapper composables (`Dialog`, `ModalBottomSheet`) |
| F-005 | `MotionDurationScale` docs | Lists every API path that bypasses the Compose clock |
| F-006 | IssueTracker #225932760 + source | Splits checkable shadow clipping from review-only reveals |
| O-001 | Emil Kowalski — reduced motion | Adapted for Android's `0.0f` scale: requires a static rest carrier |
| O-002 | Lottie Android source | Requires a readable resting frame when animations are disabled |
| O-003 | WCAG 2.2 SC 2.2.2 | Names the Compose forms; the system switch is not the mechanism, and the marquee ignores it |
| T-001 | Navigation Compose source | Flags the 700ms default transition duration |
| T-002 | Emil Kowalski — token discipline | Applied to `MotionScheme` and literal `spring()` / `tween()` calls |
| T-004 | M3 Expressive vs. Standard | Scoped per element (data readouts vs. containers) |
| T-008 | Predictive back docs | Scoped to custom back handlers (`NavHost` excluded) |
| T-009 | Emil Kowalski — frequency gate | Preserves built-in state layers; caps added motion by usage frequency |
| T-010 | M3 enter/exit guidance | Uses spring tier and property count rather than duration ratios |
| T-011 | M3 transition patterns | Ties directional motion to ordered destinations |
| T-012 | Emil Kowalski — interruptibility | Focuses on input-gating patterns in Compose |
| T-013 | Emil Kowalski — stagger | Caps total stagger window (~300ms) and covers multi-part controls |
| T-016 | M3 enter/exit guidance | Scoped to unanchored center-scaling surfaces |
| T-017, T-021 | Original | Compose navigation and lazy-list key lifecycle bugs |
| T-018 | Android 12 overscroll docs | Treats disabling platform overscroll as an explicit exception |
| T-019 | M3 skeleton loader guidance | Adds the 4-step delay, fade-in, minimum-hold, and cross-fade sequence |
| T-020 | Emil Kowalski — cohesion | Requires one scheme and speed tier per perceived event |
| T-022, T-023, T-024, T-025, T-026 | Original | Keyboard tracking, input-frame feedback, back symmetry, drag parity, single hero motion |
| T-027 | Original | Asymmetric motion between positive actions and retractions |
| T-028 | Original | Quiet completion rules for background syncs and work |

## Revision history

**Current total:** 35 rules (`10` `floor`, `3` `obligation`, `22` `taste`). Ten are marked
`Detect: review-only`, one `Detect: heuristic`, and two `Detect: partial`; the remaining 22
are directly checkable in source. Each rule defines its own scope so two rules do not
fire on the same defect.

- **Revision 01** applied three independent model reviews (`REVISION-01.md`).
- **Revision 02** applied the first human engineering review (Seb, 2026-09-21: `26` keep,
  `1` revise, `5` discuss, `0` remove), clarifying self-timed vs. touch-driven motion in
  `F-005` and `F-007`, the one-way debug performance rule in `F-009`, built-in state layers
  in `T-009`, the four-step anti-flicker sequence in `T-019`, the 700ms cross-fade rationale
  in `T-001`, checkable vs. review-only clipping in `F-006`, and Android's "Remove
  animations" setting vs. Lottie's `reduced motion` marker in `O-002`.
- **Post-revision 02 additions:** `T-027`, `T-028` and `O-003`.

**Retired rule IDs (never reused):** `T-003` (restated a token fact covered by `T-004`),
`T-007` (merged into `T-011`), `T-014` (incorrectly banned `animateItem()` on background
list updates), and `T-015` (contradicted Android's platform haptic constants).
