# Revision 01 — changes from the initial rule reviews

Three independent reviews evaluated the initial 30 rules in `STANDARDS.md`: a taste review
(Fable 5.1), a structural review (GLM 5.3), and a source fact-check (Kimi K3). This
document records what changed in Revision 01 and why.

Items marked **[2×]** were flagged independently by two reviews.

---

## Rules removed

| Rule | Reason |
|---|---|
| **T-003** — schemes and fades **[2×]** | Restated a Material 3 token fact with no decision or fixture. Merged the effects-spring note into `T-004` and routed general Material 3 token facts to `hamen/material-3-skill`. |
| **T-015** — haptics at commitment | Contradicted Android platform behavior. `HapticFeedbackConstants.GESTURE_START`, `DRAG_START` (API 34), `SEGMENT_TICK` / `SEGMENT_FREQUENT_TICK`, `ScrollFeedbackProvider` (API 35), and Compose's `TextHandleMove` all fire haptics during drag or scroll rather than only on release. |
| **T-014** — refreshed data is not a state change | Incorrectly banned animations on background list updates. When items reorder or insert in a visible list, `Modifier.animateItem()` keeps the user's reading position stable. |

If `T-015` is reintroduced later, it should require mapping each interaction to the
matching `HapticFeedbackType`. If `T-014` is reintroduced, it should separate attention
animations (no pulse or flash on background data refresh) from spatial continuity
(`animateItem()` on list reorders).

---

## Reclassifications

- **`T-005` and `T-006` moved to `obligation` (`O-001` and `O-002`).** Both are
  accessibility requirements that cannot be overridden by `MOTION.md`. Keeping them in
  `taste` inflated the evaluation score that measures design judgment.
- **`O-002` (formerly `T-006`) marked `Overridable: no`.** Previously it omitted the
  override flag, which would have allowed a `MOTION.md` file to waive disabled-animation
  legibility.
- **`T-002` claim rewritten around consistency [2×].** Framed around keeping a project's
  motion specs in shared tokens rather than scattering raw numbers across call sites.
- **`F-006` scoped to unintended clipping.** `Modifier.animateContentSize()` always clips
  to bounds, which is a bug when it cuts off a drop shadow (`Modifier.shadow` or Card
  elevation) but often intentional for text or section reveals.

---

## Rewriting the reduced-motion rules (`O-001`, `O-002`, `F-005`)

In the initial draft, `T-005`, `T-006`, and `F-005` contradicted each other in two ways:

1. **`T-005` vs. `F-005`:** `T-005` told developers to replace spatial motion with a
   cross-fade when reduced motion was enabled. On Android, "Remove animations" sets
   `ANIMATOR_DURATION_SCALE` to `0.0f`, which snaps any Compose cross-fade to its end state
   immediately. Playing a fade anyway would require bypassing `MotionDurationScale`, which
   `F-005` forbids.
2. **`F-005` vs. `T-006`:** `F-005` said to branch to a static state when animations are
   off, while `T-006` covered Lottie files whose final frame is blank.

Web `prefers-reduced-motion` asks for gentler motion, whereas Android sets the animation
duration scale to zero. The revised rules reflect Android's behavior:

- **`O-001`:** Because transitions snap at scale zero, the destination layout at rest must
  communicate whatever relationship the animation would have shown.
- **`O-002`:** Every Lottie composition must land on a legible resting frame when
  animations are disabled (either through a complete final frame or a `reduced motion`
  marker).
- **Platform API note:** `ValueAnimator.areAnimatorsEnabled()` has been available since
  API 26 as a boolean check.

---

## Resolving timing rule conflicts (`T-001`, `T-002`, `T-009`, `T-010`, `T-012`, `T-020`)

The initial timing rules conflicted in three places:

- **`T-010` vs. `T-002`:** `T-010` asked for exit durations to be "half the entrance
  duration", which cannot be expressed with Material 3 spring tokens and forced developers
  to write raw `tween` literals banned by `T-002`.
- **`T-009` vs. `T-010`:** High-frequency surfaces had no token under 150ms in the default
  scheme.
- **`T-012` vs. `T-020`:** `T-012` criticized fixed-duration tweens while `T-020` required
  matching timing across an event.

**Changes made:**

1. Standardized on Material 3 spring tokens as the default mechanism.
2. Rewrote `T-010` in terms of spring tiers and property count: enter with spatial +
   effects (`defaultSpatialSpec` + `defaultEffectsSpec`), exit with effects only
   (`fastEffectsSpec`).
3. Allowed the built-in component state layer (ripple, press overlay, shape morph) at any
   usage frequency in `T-009`.
4. Scoped `T-012` to input-blocking patterns (`enabled = !isAnimating`, `snapTo` resets,
   and unkeyed `delay()` chains) rather than tween specs.
5. Scoped `T-001` to the untouched 700ms `NavHost` default and `T-002` to specs written in
   product code so the two rules do not both fire on the same line.

---

## Narrowing rules that flagged valid Compose code

| Rule | False positive in initial draft | Fix applied |
|---|---|---|
| **T-008** | Flagged standard `NavHost` declarations, even though `NavHost.kt` (~L823–940) already wires predictive back with `SeekableTransitionState.seekTo`. | Scoped to custom back handlers (`BackHandler {}`, hand-rolled sheets, and overlays). |
| **T-016** | Flagged anchored menus such as `DropdownMenuContent` (`Menu.kt` ~L1827–1855), which scale `0.8f → 1.0f` from their trigger anchor. | Scoped to unanchored surfaces scaling from their own center. |
| **T-012** | Claimed Compose `tween` jumps to a stale start value on interruption (a CSS / `ValueAnimator` issue, not Compose `Animatable`). | Reframed around gating user input on animation completion. |
| **T-011** | Flagged Next/Back wizards and onboarding steppers because they were not swipeable. | Tied directional transitions to **ordered** destinations rather than swipe gestures. |
| **T-018** | Flagged looping carousels that set `overscrollEffect = null`. | Allowed disabling overscroll on endless carousels and documented per-component exceptions. |
| **T-019** | Required exact pixel matching on skeletons and missed fast-load flicker. | Required coarse structural matching and added the 150ms delay + minimum visible hold sequence. |
| **T-020** | Required a single `AnimationSpec` across an event, which conflicted with pairing spatial and effects springs. | Required a single motion **scheme and speed tier** per perceived event. |
| **T-009** | Flagged Material 3 Expressive's built-in button press morph on high-frequency buttons. | Exempted the built-in component state layer from the frequency cap. |

---

## Removing duplicate coverage

- **`F-001` vs. `F-008`:** `F-001` requires lambda modifiers (`offset { }`,
  `graphicsLayer { }`), which do not exist for `padding` or `size`. Scoped `F-001` to
  properties that have lambda overloads and `F-008` to layout dimensions that do not.
- **`T-007` merged into `T-011` [2×]:** `T-007` duplicated the top-level destination row of
  `T-011` with a conflicting definition of "peer". Merged into `T-011`.
- **`T-001` clarified [2×]:** Specified that the defect is the 700ms duration rather than
  the cross-fade pattern itself.
- **Lottie disabled frame consolidated into `O-002`:** Removed duplicate Lottie notes from
  `O-001` and `F-005`.

---

## Marking review-only rules

Rules whose deciding condition is not visible in static source code are now marked
`Detect: review-only` (`T-009`, `T-011`, `T-013`, `T-019`, `T-020`, `T-025`, `T-027`,
`T-028`, `F-009`, `F-010`), `Detect: heuristic` (`F-002`), or `Detect: partial` (`F-006`).

---

## Rules added in Revision 01 (`T-021` – `T-026`)

Six rules were added to cover gaps identified during the reviews:

1. **`T-021` — Keys identify content, not position:** Catches `key = { index }` on lazy
   lists, which satisfies `F-003` syntactically but re-animates every subsequent row on
   insertion.
2. **`T-022` — Content tracks the keyboard, it does not jump:** Requires `WindowInsets.ime`
   instead of boolean keyboard-visibility layout toggles.
3. **`T-023` — Motion starts on the input frame:** Requires immediate visual feedback on
   tap rather than waiting for async responses.
4. **`T-024` — Back plays the inverse of forward:** Requires exit direction on pop to
   reverse the forward entrance direction.
5. **`T-025` — A hand-rolled surface drags like the one it replaces:** Requires custom
   sheets, drawers, and swipeable cards to support finger dragging.
6. **`T-026` — One hero motion per event:** Prevents multiple sibling components from
   running independent competing entrance or emphasis animations on the same event.
