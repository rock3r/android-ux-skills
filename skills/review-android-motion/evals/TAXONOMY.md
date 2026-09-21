# Eval classes

Rules group by *what shape of eval can test them*, which cuts differently from
`floor`/`obligation`/`taste`. A floor rule and a taste rule can need the same harness; two
taste rules can need entirely different ones.

Seven classes. One rule from each is built out, so the harness is proven against every shape
before the remaining rules are filled in behind it.

| Class | What makes it distinct | Exemplar | Rules in the class |
|---|---|---|---|
| **A. Static twin** | Violation and fix are both visible in source, one line apart | F-001 | F-002, F-003, F-004, F-008, T-002, T-017, T-021, T-022 |
| **B. Context-dependent severity** | Detection is easy; what it *means* depends on MOTION.md | T-001 | T-002, T-004, T-018 |
| **C. Absence** | The defect is something missing, and absence has no syntax | O-002 | O-001, T-019, T-024, ripple presence |
| **D. Not in the source at all** | The deciding fact is runtime or human; the skill must ask, not assert | T-009 | T-011, T-013, T-014, T-020, F-009 |
| **E. Composite-only** | Every part is individually correct; the defect exists only in the whole | T-026 | T-020, T-023 |
| **F. Legitimate twin** | The same construct is a defect or correct depending on intent | F-006 | T-016, T-018, T-012 |
| **G. Framework-correct** | The framework already does the right thing; flagging it is the failure | T-008 | F-003, T-001, T-018 |

Rules appear in more than one class. That is expected — the class describes the *hardest*
thing about testing the rule, and the exemplar is chosen so that each harness shape gets
exercised once.

## Why the classes differ

**A — Static twin.** The easy case, and the only one where a checker could plausibly
replace the skill. Mutation fixtures: inject the violation into clean code, keep the
untouched neighbour as a must-not-flag. Single battery; a floor rule fires identically
whether or not a motion language exists.

**B — Context-dependent severity.** Detection is not the interesting part. The question is
whether the skill reads MOTION.md at all, or pattern-matches on code and invents a severity.
Needs the battery matrix: absent, established, stale, phantom.

**C — Absence.** You cannot grep for a missing thing. The skill has to know something
*should* be present from the surrounding context — a Lottie is being played, therefore there
should be a readable frame when animations are off. The precision risk is high: demanding
the missing thing everywhere is as useless as never noticing it.

**D — Not in the source at all.** Frequency of use, the relationship between two screens,
how many items a list holds at runtime. The correct behaviour is to **ask or scope the
claim**, not to guess. These grade the opposite way round from every other class: a
confident finding is the failure, and a question is the pass.

**E — Composite-only.** Every element individually satisfies every rule; the screen is still
wrong. This is the hardest shape to fixture, because the fixture must be *entirely free of
individual defects* or the grader cannot tell whether the skill found the composite problem
or merely tripped over a part.

**F — Legitimate twin.** The same construct appears twice, correct once and wrong once, and
only surrounding signal distinguishes them. Tests whether the skill reads the signal or the
syntax.

**G — Framework-correct.** The framework already handles it, so the only possible finding
is a false positive. Pure precision. These matter disproportionately: a skill that flags
correct framework usage gets switched off after one review, and nothing it says afterwards
is heard.

## What each exemplar must show

| Class | Pass looks like | Fail looks like |
|---|---|---|
| A | Flags the injected violation, ignores the twin | Flags both, or neither |
| B | Same finding, severity moves with MOTION.md | Same severity everywhere — not reading the file |
| C | Notices the missing thing where it is required | Demands it everywhere, or never |
| D | Asks, or states the assumption it is working from | Asserts a number it cannot know |
| E | Names the composite, not a part | Reports several correct parts as defects |
| F | Distinguishes the two by their surrounding signal | Treats the construct as always-wrong |
| G | Says nothing about the framework path | Any finding at all |
