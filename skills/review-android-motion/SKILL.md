---
name: review-android-motion
description: >
  Review Android Jetpack Compose motion and end with an explicit Block or Approve verdict.
  Judges whether the motion should exist, whether it matches the project's motion language
  in MOTION.md, whether its meaning survives when animations are disabled, and whether the
  screen holds together as a single coherent event. Runs its high-level motion judgment in
  isolation before seeing mechanical rule findings so rule matches do not crowd out design
  critique. Use when asked to review, critique, or check an animation, transition, or
  screen motion. Does not review general Compose recomposition or stability
  (use chrisbanes/skills), does not score Material 3 component conformance
  (use hamen/material-3-skill), and does not implement fixes (use animate-compose).
license: Apache-2.0
tags:
  - motion
  - android
  - compose
  - material-design
metadata:
  version: "0.1.0"
---

# Reviewing Android motion

## Initial response

When invoked with no target, reply with exactly this and nothing else:

> Point me at the motion. I'll judge whether it should exist before I judge how it's
> built.

## Scope

Review only motion behavior and implementation. Every finding in the table must cite a
rule ID from `references/standards.md`. Do not add table findings without a rule ID from
that file.

Route non-motion topics elsewhere: general Compose stability and recomposition to
`chrisbanes/skills`, Material 3 component and token conformance to `hamen/material-3-skill`,
and implementing code fixes to `animate-compose`.

## Review criteria

Judge code against **the project's own motion standard**, not personal preference:

1. Read `MOTION.md` first (if present), then inspect the surrounding code. Contradicting a
   `DECIDED` entry in `MOTION.md` is a **major** finding.
2. Check whether the surrounding code already establishes a pattern. When another composable
   in the reviewed code handles the same motion pattern the compliant way and the target
   code does not, flag the inconsistency as **major** even when no `MOTION.md` exists. When
   neither `MOTION.md` nor the surrounding code sets a convention, a `taste` finding is
   **minor**.
3. Verify the condition on any exception in `MOTION.md` before honoring it. An exception
   granted "until typed routes land" or "for first-run onboarding only" does not waive
   findings once typed routes are in use or outside onboarding.

## Procedure

### Step 1 — Run two isolated assessments

Run Assessment A and Assessment B as two separate subagents with self-contained prompts
and no inherited conversation context whenever subagent tools are available. Running them
inline is a degraded run and must be labeled as one.

**Assessment A — unanchored motion judgment.** Start with an empty context containing only
the target code and `MOTION.md`, without `references/standards.md` or any rule findings.
It evaluates:

- Should this motion exist at all, and what purpose does it serve?
- Does it match the project's motion language in `MOTION.md`? (If `MOTION.md` was not
  provided, state that plainly and never invent or guess its contents.)
- How will this animation feel on the tenth encounter in a session? Usage frequency is
  rarely visible in source code. If `MOTION.md` does not specify the frequency, **ask** or
  state the conditional assumption explicitly instead of asserting a frequency.
- Does the UI still communicate the state change when system animations are disabled?
- Do simultaneous animations on the screen work together as one coherent event, or compete
  for attention?

**Assessment B — rule checks.** Check the target code against `references/standards.md` and
return every match with `path`, `line-range`, `rule-id`, `severity`, and one line of
evidence.

Always read line numbers from a numbered view (`cat -n`, `nl -ba`, `rg -n`, or editor line
numbers) rather than counting lines by eye.

Keep the two passes isolated from each other. Give each subagent a self-contained prompt
with no inherited conversation context, so Assessment A never inherits
`references/standards.md` or rule findings from the parent session. Assessment B can run
in parallel with Assessment A, but **Assessment B's output must not enter the synthesis
context until Assessment A has finished and been recorded.** This two-pass separation is
adapted from `/impeccable critique` in
[Impeccable](https://github.com/pbakaus/impeccable) (Paul Bakaus, Apache-2.0) so mechanical
rule hits do not anchor the design critique.

If subagent isolation is unavailable, complete and record Assessment A before reading
`references/standards.md` for Assessment B, and start the report with:

> ⚠️ DEGRADED: single-context (<reason>)

### Step 2 — Synthesize findings

Combine both assessments into one review:

- Keep Assessment A in full as the `## Judgment` section.
- Anchor each finding at the code location where the fix belongs. When multiple child
  elements animate in conflict on the same event (`T-026` or `T-020`), report a single
  finding at the parent composable that coordinates them rather than flagging each child.
- Assign final severity during synthesis. `floor` and `obligation` findings are always
  `major`. For each `taste` finding, check `MOTION.md` and the rest of the reviewed file:
  if another function in the file or `MOTION.md` already establishes the compliant
  convention, mark the finding `major`; otherwise mark it `minor`.

### Step 3 — Verdict

Return **Block** if there is any unresolved `floor` violation, any `Overridable: no`
(`obligation`) violation, or any contradiction of a `DECIDED` entry in `MOTION.md`.
Otherwise return **Approve** with the findings table.

## Required output

```text
## Verdict
Block | Approve
Method: dual-agent (A: <id> · B: <id>)      ← or the degraded banner

## Judgment
<Assessment A, in full. This section comes first and is never trimmed to fit.>

## Findings
| Rule | Where | Class | Severity | What | Fix |
|------|-------|-------|----------|------|-----|
| T-009 | Feed.kt:88-96 | taste | minor | ... | ... |

## Floor / taste split
Floor: n findings.  Taste: n findings.
```

In the **Fix** column, name the concrete code change (the exact modifier, API call, or
token to use) rather than a vague instruction like "use a calmer animation".

Report the `Floor` and `Taste` counts **separately** and never average them.

## Common blocking and high-priority defects

| Pattern | Rule |
|---|---|
| Raw `tween(n)` or `spring(...)` outside a token definition | T-002 |
| Extra motion on a 100+/day control above the state-layer ceiling | T-009 |
| Directional slide between unordered top-level destinations | T-011 |
| State change communicated only by motion with no static indicator | O-001 |
| Motion that runs past five seconds with no way to stop it | O-003 |
| `NavHost` left on its 700ms default transition | T-001 |
| Per-frame animated value read during composition | F-001 |
| `animateItem()` in a lazy list without a stable item key | F-003 |
| Custom `BackHandler` closing animated UI without predictive back | T-008 |
| Smoothness or jank claims taken from a debug build | F-009 |

## Tone

Be direct and specific. Cite the rule ID, give the exact line range, and name the concrete
fix. If an animation should be removed altogether, state that first.
