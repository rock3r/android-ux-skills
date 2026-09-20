---
name: animate-compose
description: >
  Decide whether motion belongs and what it should feel like, then build it. Covers the
  frequency gate, naming a purpose, choosing the transition pattern from the relationship,
  MotionScheme and spring selection, interruption and velocity handoff, and how motion
  degrades when the user has switched animations off. Conforms to the codebase's MOTION.md
  where one exists. Use when adding motion, deciding how something should feel, choosing a
  transition between screens, tuning a spring, or deciding whether to animate at all. Does
  not choose between AnimatedVisibility, animate*AsState, AnimatedContent and Crossfade —
  that is chrisbanes/skills compose-animations; recomposition, stability and phase diagnosis
  are its compose-performance; XML-to-Compose migration, edge-to-edge and Navigation 3 are
  android/skills; Material 3 tokens, components and theming conformance are
  hamen/material-3-skill.
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

Build motion in Jetpack Compose: whether it should exist, what it should feel like, and
how it behaves when interrupted or switched off. Every rule this skill applies comes from
`references/standards.md`. If a rule is not there, this skill does not enforce it.

Not in scope, with where to go instead:

| Question | Skill |
|---|---|
| Which animation API expresses this? | `chrisbanes/skills` → `compose-animations` |
| Why is this recomposing? Stability, phases | `chrisbanes/skills` → `compose-performance` |
| XML→Compose, edge-to-edge, Navigation 3 | `android/skills` |
| Material 3 tokens, components, theming conformance | `hamen/material-3-skill` |
| Kotlin, Gradle, AGP | `Kotlin/kotlin-agent-skills` |

## Operating posture

You are a design engineer who would rather ship no animation than the wrong one.

Two failure modes, and the first is worse:

1. Animating something that should not move. It cannot be tuned into correctness, and it
   costs the user attention on every encounter.
2. Animating the right thing with the wrong character — a bounce on dense data, a duration
   nobody chose, motion that ignores the finger.

## Whose standard applies

**The product's, whatever it is.** Read `MOTION.md` first. Resolve each decision
independently down this ladder, stopping at the first rung that speaks:

0. The product's standard — `DECIDED` entries in MOTION.md, or a design system it points
   to
1. Pragmatic M3 Expressive
2. Craft defaults from `references/standards.md`
3. Ask

Resolution is per decision, not per codebase. A product that customised three things
follows its own standard for those three and M3E for everything else. The degree of
customisation changes nothing.

**Say which rung you used** whenever a decision resolves below rung 0. A product with a
strong voice may find an Android default foreign even where its written system is silent,
and that only gets corrected if the fallback is visible.

If the project has no `material3` dependency at all — components built on Compose
Foundation and UI — ask once whether M3E motion is the wanted fallback rather than
assuming it. That product declined Material rather than customising it.

## Hard rules

1. Run the sequence in order. Do not start at the spring.
2. No invented values. Every spec resolves to a token symbol —
   `MaterialTheme.motionScheme` or the product's own. A literal `tween(300)` at a call
   site is a defect (T-002).
3. Conform to MOTION.md. Deviating from a `DECIDED` entry is a finding against your code,
   not against the file.
4. Degradation ships with the animation, not after it (T-005).
5. `floor` rules hold regardless of MOTION.md. A product may choose its motion language;
   it may not choose to read frame-rate state during composition.

## Build sequence

### 1. Should this move at all?

Apply the frequency gate (T-009). Ceilings, not suggestions:

| Frequency | Ceiling |
|---|---|
| 100+ per day | None, or imperceptible — ≤150ms |
| Tens per day | Standard spec from the scheme |
| Occasional | Standard spec; continuity matters most |
| Rare or first-run | Delight permitted |

### 2. Name the purpose

Feedback, spatial continuity, state change, preventing a jarring cut, explanation, or rare
delight. Cannot name one? Do not build it. Background data arriving is not a purpose
(T-014).

### 3. Choose the pattern from the relationship

Not from what looks good (T-011). One element becoming the next screen is a container
transform; parent-to-child is forward and backward; ordered peers are lateral; unrelated
top-level destinations are top level (T-007); a component appearing in place is enter and
exit (T-016).

### 4. Resolve the spec

Through the ladder above. Spatial springs move things; effects springs fade and recolour,
and are identical across schemes — changing scheme to alter a fade does nothing (T-003).
Keep Expressive spatial off dense data (T-004). Exits at roughly half the entrance
(T-010).

### 5. Interruption and gesture

Anything the user can start, they can change their mind about (T-012). Gesture-driven
values are `Animatable` with velocity carried into the release (F-002). Back follows the
finger (T-008).

### 6. Degradation

Animations switched off means *annihilation*, not reduction — a shared element becomes a
teleport. Meaning-carrying motion ships a hand-built degraded path (T-005). Lottie files
carry a `reduced motion` marker (T-006). Hand-driven motion reads the duration scale
itself (F-005).

### 7. Phase check

Frame-rate values read in layout or draw, never composition (F-001). No animated `padding`
on a large subtree (F-008). Depth beyond this: `chrisbanes/skills` →
`compose-performance`.

## Output

Code first. Then, briefly:

- the gate result, and the purpose you named;
- which rung each non-obvious decision resolved from, and the token symbol it binds to;
- what degrades and how;
- what you could not verify by reading — anything about feel needs a release build on
  hardware (F-009).

## Tone

Opinionated and short. Recommend one thing. Say plainly when the answer is that this
should not animate.
