---
name: animate-compose
description: >
  Decide whether motion belongs and what it should feel like, then implement it in Jetpack
  Compose. Covers the usage-frequency gate, naming a purpose, choosing a transition pattern
  from the screen relationship, MotionScheme and spring token selection, gesture
  interruption and velocity handoff, and reduced-motion fallbacks. Conforms to the
  project's MOTION.md when present. Use when adding an animation, choosing a screen
  transition, tuning a spring, or deciding whether something should animate at all. Does
  not choose between AnimatedVisibility, animate*AsState, AnimatedContent, and Crossfade
  (use chrisbanes/skills compose-animations); recomposition, stability, and phase
  diagnostics belong to compose-performance; XML-to-Compose migration, edge-to-edge, and
  Navigation 3 belong to android/skills; Material 3 tokens, components, and theming
  belong to hamen/material-3-skill.
license: Apache-2.0
tags:
  - motion
  - android
  - compose
  - material-design
metadata:
  version: "0.1.0"
---

# Building Android motion

## Initial response

When invoked with no question, reply with exactly this and nothing else:

> Ready. I'll decide whether the motion belongs before deciding how it should feel.

## Scope

Build motion in Jetpack Compose: decide whether an animation should exist, choose its
pattern and token spec, and handle interruption and disabled-animation states. Every rule
this skill applies comes from `references/standards.md`. If a rule is not in that file,
this skill does not enforce it.

Route non-motion questions to the matching skill:

| Question | Skill |
|---|---|
| Which Compose animation API expresses this? | `chrisbanes/skills` → `compose-animations` |
| Why is this recomposing? Stability and phases | `chrisbanes/skills` → `compose-performance` |
| XML-to-Compose migration, edge-to-edge, Navigation 3 | `android/skills` |
| Material 3 tokens, components, theming conformance | `hamen/material-3-skill` |
| Kotlin, Gradle, Android Gradle Plugin (AGP) | `Kotlin/kotlin-agent-skills` |

## Principles

Prefer shipping no animation over shipping the wrong one:

1. **Do not animate elements that should stay still.** Unnecessary motion on a frequent
   action slows the user down on every interaction and cannot be fixed by tuning spring
   constants.
2. **Match the motion spec to the content.** Avoid bouncy spatial springs on data tables or
   charts, raw duration literals scattered across call sites, and transitions that ignore
   finger velocity or interruption.

## Resolving the project's motion standard

Read `MOTION.md` first if the repository has one. Resolve each motion decision
independently down this ladder, stopping at the first rung that answers the question:

0. **Project standard:** `DECIDED` entries in `MOTION.md`, or the design system it names.
1. **Material 3 Expressive:** `MaterialTheme.motionScheme` tokens.
2. **Craft defaults:** The rules in `references/standards.md`.
3. **Ask the user:** When the decision depends on product context not in the codebase.

Resolve decisions one by one rather than per repository. An app that customizes three
transitions uses Rung 0 for those three and falls back to Rung 1 or Rung 2 for the rest.

Whenever a decision resolves below Rung 0, **state which rung you used** in your output so
the team can see when a default was applied.

If the project does not depend on `androidx.compose.material3` at all (building directly on
Compose Foundation and UI), ask once whether the team wants Material 3 Expressive as the
fallback rather than assuming it.

## Hard rules

1. Follow the build sequence below in order before picking a spring or duration.
2. Never write raw `tween(300)` or `spring(...)` literals at a call site (`T-002`). Resolve
   every spec to a token symbol on `MaterialTheme.motionScheme` or the project's own token
   object.
3. Follow `DECIDED` entries in `MOTION.md`.
4. Implement the disabled-animation resting state alongside the animation (`O-001`,
   `O-002`).
5. Always enforce `floor` and `obligation` rules regardless of `MOTION.md`.

## Build sequence

### 1. Check the usage-frequency ceiling (`T-009`)

| Usage frequency | Maximum motion |
|---|---|
| 100+ times per day | Platform state layer only |
| Tens of times per day | Fast tier from the motion scheme |
| Occasional | Default tier from the motion scheme |
| Rare or first-run | Expressive or celebratory motion allowed |

### 2. Name the purpose

State which job the motion does: immediate input feedback, spatial continuity, state change
clarity, avoiding an abrupt layout cut, onboarding explanation, or rare celebration. If it
does none of these, do not animate it.

### 3. Pick the transition pattern from the screen relationship (`T-011`, `T-016`)

Choose the transition pattern based on how the two states relate:

- One element expanding into a detail screen → **container transform**
- Parent screen to child screen → **forward and backward**
- Ordered peers (wizard steps, horizontal pager tabs) → **lateral slide**
- Unordered top-level destinations (bottom bar, rail, drawer) → **cross-fade** (`T-011`)
- Component appearing in place → **enter and exit** (`T-016`)

### 4. Select the token spec (`T-004`, `T-010`, `T-024`)

Use spatial springs for position, size, and shape changes, and effects springs for opacity
and color. Effects springs are identical in Material 3's Expressive and Standard schemes
(`T-004`). Keep Expressive spatial springs off data rows, chart bars, and numeric readouts
(`T-004`).

For components appearing in place, enter with spatial + effects and exit with effects only
(`T-010`). For surfaces that enter from a screen edge or origin, exit back along the same
path (`T-024`).

### 5. Handle interruption and gesture velocity (`T-012`, `F-002`, `T-008`)

Keep controls enabled while animations run (`T-012`). Drive gesture-controlled positions
with `Animatable` and pass release velocity into `animateDecay` or `animateTo` (`F-002`).
Drive custom back handlers with `PredictiveBackHandler` and `SeekableTransitionState`
(`T-008`).

### 6. Handle disabled animations (`O-001`, `O-002`, `F-005`)

When Android's "Remove animations" setting is enabled, all three system animation scales
are `0.0f` and Compose transitions snap immediately to their end state. Make sure the
destination layout at rest communicates the state change without relying on the transition
(`O-001`). Ensure every Lottie animation lands on a legible resting frame or `reduced motion`
marker (`O-002`). For custom `withFrameNanos` loops, read `MotionDurationScale` each frame
and stop requesting frames when `scaleFactor == 0f` (`F-005`).

Animations left on bring a separate duty: motion that starts by itself and runs past five
seconds stops by itself or gets a pause control on the screen (O-003). The control can be
a tap on the moving element, if it is `clickable` with an `onClickLabel` of "Pause" or
"Resume". `basicMarquee` ignores Remove animations, so show its text wrapped and in full
when the scale is zero (F-005); that does not count as the pause control.

### 7. Check Compose phases (`F-001`, `F-008`)

Read rapidly changing animation values inside lambda modifiers (`Modifier.offset { }`,
`Modifier.graphicsLayer { }`) so they run in layout or draw rather than recomposing every
frame (`F-001`). Avoid animating `Modifier.padding` or `size` when a positional offset
works (`F-008`).

## Output

Provide the code first, followed by a short summary covering:

- the usage-frequency ceiling and the purpose of the motion;
- which ladder rung and token symbol each spec uses;
- how the UI behaves when system animations are disabled;
- what still requires verification on a physical device running a release build (`F-009`).

## Tone

Keep responses direct and concise. Recommend one concrete option, and state plainly when an
element should not animate.
