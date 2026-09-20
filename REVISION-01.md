# Revision 01 — acting on the pre-reviews

Three independent reviews of the initial 30 rules: a taste review (Fable 5.1), a structural
review (GLM 5.3), and a fact-check (Kimi K3, pending). This records what changes and why,
so the rules and the reasoning stay reviewable together.

Where two reviews found the same defect independently, it is marked **[2×]** — those are the
highest-confidence findings and are not re-litigated.

---

## Cut

| Rule | Why |
|---|---|
| **T-003** — schemes and fades **[2×]** | Restates a token fact, has no fixture, decides nothing. Fails criteria 1 and 3. Fold the effects-spring identity into T-004's pinned block and route the fact to `hamen/material-3-skill`. |
| **T-015** — haptics at commitment | The claim is false on Android. `HapticFeedbackConstants.GESTURE_START`, `DRAG_START` (34), `SEGMENT_TICK`/`SEGMENT_FREQUENT_TICK` for scrubbing, `ScrollFeedbackProvider` (35, platform scroll haptics) and Compose's `TextHandleMove` all contradict "at commitment, never on scroll". Drag-start haptic confirms pickup — the launcher idiom. Transcribed from iOS practice. |
| **T-014** — refreshed data is not a state change | Wrong for the case that matters: a background reorder or insert in a visible list *is* telling the user their content moved, and `animateItem()` exists for it. Landing it unanimated "even when the diff is large" is the jump cut where the item under the thumb changes. |

If T-015 returns it becomes *each haptic maps to the `HapticFeedbackType` whose semantics
match the event*. If T-014 returns it splits into attention motion (no entrance, flash or
pulse on background change) versus continuity motion (keep), with large visible diffs
deferred behind a "new items" affordance.

---

## Reclassify

**T-005 and T-006 are obligations, not taste.** Both are accessibility duties that can never
yield to a product's standard, so counting them in the taste delta inflates the number that
is supposed to prove the collection is more than a linter. Introduce a third class —
`obligation` — rather than pushing them into `floor`, which means mechanical correctness.

**T-006 is currently `Overridable: yes` by omission.** A `DECIDED` entry could waive it,
which is deciding to strand users who switched animations off — exactly what the harm
carve-out forbids. Mark `Overridable: no`.

**T-002's claim is maintainability, not perception [2×].** Either recast the claim
perceptually — call-site numbers read as accident rather than intent — or accept it as
structural governance and move it out of `taste`.

**F-006 hides a judgment.** The clip is a documented fact, but whether it is a defect depends
on intent; a deliberate clipped reveal is legitimate. Scope to unintended clipping.

---

## Rewrite the reduced-motion cluster as a unit

T-005, T-006 and F-005 are one defect with three ids and **two mutual contradictions**:

1. **T-005 × F-005.** T-005 prescribes substituting a cross-fade. Remove animations zeroes
   `ANIMATOR_DURATION_SCALE`, so `MotionDurationScale` snaps that substitute too. Playing it
   anyway means bypassing the scale, which F-005 forbids.
2. **F-005 × T-006.** F-005 says hand-driven motion reads the scale and branches. Branching
   off for a Lottie yields a blank canvas, which is what T-006 exists to prevent.

The web model — `prefers-reduced-motion`, swap for a lighter animation — does not transfer.
Android has zero, not less.

**The Android rule:** meaning must have a **static carrier**. The destination at rest has to
show the relationship, because the motion will not be there to show it. A Lottie's
reduced-motion still-frame is the model for the whole class, not a special case.

Also correct: `ValueAnimator.areAnimatorsEnabled()` has existed since API 26, so "no semantic
API" overstates it. There is a boolean; there is no *preference*.

---

## Resolve the timing cluster

T-002, T-009, T-010, T-012 and T-020 are mutually inconsistent.

- **T-010 is only expressible as what T-002 bans.** "Half the entrance duration" is duration
  language; M3E tokens are springs with no duration. The only way to write it is a bare
  `tween`.
- **Three-way with T-009:** a high-frequency enter/exit needs ≤150ms in, ~75ms out. No such
  tokens exist, so the only default-path answer is no motion — which vacates T-010 exactly
  where T-009 applies.
- **T-012 × T-020 contradict on the same code:** a `tween` pane transition is compliant as
  uniform timing and a finding as a fixed duration on something interactive.

**Fixes:**

1. Declare the house default explicitly: springs.
2. Re-express T-010 in spring terms. Asymmetry on Android is **tier, not ratio** — entrance
   spatial + effects, exit effects-only, which is M3's own "exits are usually just a fade".
   The claim that the spring system drops the asymmetry silently is **false**: it lives in
   the tier choice. Drop the half-duration ratio.
3. Give the scheme a real high-frequency token so T-009's ceiling is reachable without a
   literal.
4. State precedence between T-012 and T-020.
5. State precedence between T-001 and T-002 — the NavHost default fires both.

---

## Re-ground the rules that fire on correct code

| Rule | Fires on | Fix |
|---|---|---|
| **T-008** | `NavHost` already seeks predictive back — installs its own handler and calls `SeekableTransitionState.seekTo(progress, previousEntry)`, `NavHost.kt` ~L823–940, zero app code | Scope to custom back: sheets, overlays, hand-rolled containers, `BackHandler {}` popping state |
| **T-016** | `DropdownMenuContent` scales 0.8→1.0 with FastSpatial, `Menu.kt` ~L1827–1855 | Anchored scale reads as emerging *from* source. Restrict to unanchored full-surface scale from centre, or cut |
| **T-012** | Compose already retargets from the current value | "tween jumps to a stale start" is a CSS/`ValueAnimator` failure. Real violators: `snapTo()` before `animateTo()`, `enabled = !isAnimating` guards, `delay()`-sequenced effects. Recast as *never gate input on animation completion* |
| **T-011** | Every Next/Back wizard and onboarding stepper | "cannot swipe between" is the wrong test. Direction promises **order**; gesture is optional. Change "swipeable" to "ordered" |
| **T-018** | A pager carousel with `overscrollEffect = null` | Allow per-component with a stated reason |
| **T-019** | Heterogeneous feeds shipping approximate card skeletons | The bar is *structural* match, not exact. Add the adjacent rule that is actually missing: indicator delay and minimum, so skeletons do not flash on an 80ms load |
| **T-020** | M3's own patterns, and the app/platform boundary every app has | Android form is one **scheme and tier** per event, not one spec |
| **T-009** | M3E's own button press — a spring shape morph on a 100+/day control | Say explicitly that it survives the gate. The default fallback cannot fail the default rule |

---

## Deduplicate

- **F-001 × F-008** — F-001's remedy (use the lambda form) does not exist for `padding`, which
  is why F-008 was written. Scope F-001 to lambda-capable properties.
- **T-007 → T-011 [2×]** — T-007 is T-011's top-level row promoted to a rule, and the two
  define "peer" differently, so the same tab switch can get opposite answers. Make T-007 a
  row in T-011 and define peer once. Note that a swipeable `TabRow` + `Pager` is lateral,
  correct, and out of scope.
- **T-001** — the finding is the 700ms, not the pattern **[2×]**. A top-level-only app
  satisfies T-007 with a cross-fade. Say so.
- **Lottie reduced motion** — currently in T-005, T-006 and F-005. Put it in exactly one.

---

## Mark enforceability

Criterion 3 assumes every rule has a fixture. These cannot be checked from source and must be
marked **review-only**, so mutation fixtures are not mistaken for checker coverage:

T-009 (frequency is not in the code), T-010, T-011, T-013 (item count is runtime), T-014,
T-019, T-020, F-009, F-010.

**F-009 has no fixture at all** and fails criterion 3 outright — "do not assess feel in a
debug build" cannot have a violating snippet. Demote to a procedural note, or give the
criterion an explicit review-only exemption.

False-positive-prone, needing narrower triggers: F-001, F-002, F-006, F-007, F-008, T-004,
T-012, T-017.

---

## Add

Nine gaps, in rough order of how often they bite:

1. **Keys identify content, not position.** `key = { it }` is stable yet re-animates the whole
   list on one insertion. F-003 does not catch it.
2. **IME transitions** — content tracks animated `WindowInsets.ime` rather than jumping on a
   visibility callback.
3. **Perceived performance** — motion starts on the input frame, not the response frame;
   transition before the data arrives; indicator delay and minimum. Named by the taste review
   as the highest-yield missing area.
4. **Ripple / state-layer presence** — a bare `clickable` with no indication drops press
   feedback entirely. T-009 governs its cost but never its existence.
5. **Nested scroll handoff** — a collapsing bar consumes child fling velocity, rather than
   animating on its own after the fling.
6. **Pull-to-refresh** — the indicator tracks the drag 1:1 and does not animate itself on
   release.
7. **Reversal symmetry** — back plays the inverse of forward. Predictive back now shows this
   live, so enter-from-right paired with exit-by-fade is visibly wrong.
8. **Gesture-first posture** — prefer velocity-continuous gesture motion over fired
   transitions wherever a gesture exists. More native-vs-ported than any timing value.
9. **One hero motion per event** — the thing that moves is the thing that changed. Six
   correctly-specced springs firing at once currently pass every rule.

Also uncovered: splash-to-first-frame handoff, size-class and fold transitions, scroll-linked
effects carrying no easing of their own, and list-detail pane changes.

---

## Standing lesson

Six rules kept their source mechanism and swapped nouns: T-005, T-010, T-012, T-013, T-015,
T-020. Inheriting taste is the policy and remains right — but *inherited* has to mean the
claim was re-derived from how Android behaves, not that the rule was translated. The
admission criteria need a check for it, because nothing in the current five catches a web
rule wearing Compose symbols.
