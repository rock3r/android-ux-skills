# Evaluation classes

The evaluation suite groups rules by **how a test fixture has to be structured to test
them**, which is orthogonal to whether a rule is `floor`, `obligation`, or `taste`:

| Class | How the fixture is built | Exemplar | Rules in this class |
|---|---|---|---|
| **A. Static twin** | The violation and its compliant fix sit side by side in the same file | F-001 | F-002, F-003, F-004, F-005, F-007, F-008, F-010, T-002, T-004, T-010, T-012, T-013, T-016, T-017, T-021, T-022, T-023, T-024, T-025, T-027, T-028 |
| **B. Context-dependent severity** | The code construct is identical; expected severity changes with `MOTION.md` or neighboring code | T-001 | T-002, T-004, T-018 |
| **C. Absence** | The defect is a missing element (a static label, a Lottie marker, or a loading delay) rather than a wrong call | O-002 | O-001, T-019 |
| **D. Not in the source** | The deciding fact (usage frequency) is not in source code; without `MOTION.md` the reviewer must ask rather than flag | T-009 | T-011, T-013, T-020, F-009 |
| **E. Composite-only** | Each child animation is valid on its own; the defect only appears in how the parent coordinates them | T-026 | T-020 |
| **F. Legitimate twin** | The exact same API call is a bug in one context and valid in another | F-006 | T-011, T-018 |
| **G. Framework-correct** | The framework (`NavHost`) already handles the requirement; flagging the framework call is a false positive | T-008 | F-003, T-001, T-018 |

## Details by class

- **A — Static twin:** Places a violating composable and a compliant composable in the same
  file so only the target construct differs. Tested in the `no-motion-language` battery.
- **B — Context-dependent severity:** Tests whether the reviewer reads `MOTION.md` and
  surrounding code conventions when assigning `minor` vs. `major` severity, using the four
  batteries (`no-motion-language`, `established-language`, `stale-exception`, and
  `phantom-language`).
- **C — Absence:** Tests whether the reviewer notices something missing (such as a static
  text label alongside a pulsing dot, a `reduced motion` marker in a Lottie file whose
  final frame clears the canvas, or a 150ms delay before showing a loading spinner) without
  flagging twin composables that do not need it.
- **D — Not in the source:** Tests rules that depend on product context not visible in
  Kotlin code, such as how often a screen or control is used (`T-009`). When `MOTION.md` is
  absent, asserting a violation is graded as a false positive; the reviewer must ask or
  state a conditional assumption instead. When `MOTION.md` supplies the frequency map,
  flagging the violation is required.
- **E — Composite-only:** Tests screen-level coordination defects (`T-026` and `T-020`).
  Every individual child animation in the fixture follows `STANDARDS.md` so the test only
  passes when the reviewer flags the parent composable that combines them.
- **F — Legitimate twin:** Uses the same API call twice in one file—once where surrounding
  context makes it a defect (such as `animateContentSize` clipping a `Card` shadow, or a
  lateral slide on unordered bottom-bar tabs) and once where it is appropriate (a flat text
  reveal, or ordered sign-up steps).
- **G — Framework-correct:** Checks that the reviewer does not flag motion that Jetpack
  Compose or Navigation Compose already handles automatically. Class G uses two fixtures:
  - **Hybrid (`case 70`):** Pairs a standard `NavHost` (which handles predictive back
    automatically) with a custom `BackHandler` that closes an animated overlay without
    predictive back, so simply staying silent on everything fails recall.
  - **Pure (`case 80`):** Contains only valid framework-handled motion, where any finding
    is a false positive.

## Pass and fail criteria by class

| Class | Passing behavior | Failing behavior |
|---|---|---|
| A | Flags the violating composable and leaves the compliant twin unflagged | Flags both, or misses the violation |
| B | Escalates severity to `major` when `MOTION.md` or neighboring code sets a convention, and keeps it `minor` otherwise | Reports the same severity regardless of context |
| C | Flags the composable missing the required fallback/delay and leaves the compliant twin unflagged | Flags both, or misses the missing element |
| D | Asks or states a conditional assumption when `MOTION.md` is absent; flags when `MOTION.md` settles the fact | Asserts an ungrounded violation without `MOTION.md` |
| E | Reports one finding at the parent composable that coordinates the event | Flags individual child composables separately, or misses the conflict |
| F | Distinguishes the violating call from the valid one using surrounding context | Flags both calls based on syntax alone |
| G | Leaves framework-handled motion unflagged | Flags valid framework usage |
