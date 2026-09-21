# Evals for review-android-motion

Run with [Pioneer](https://github.com/rock3r/pioneer), graded by `scripts/run-evals.py`.

```bash
./scripts/run-evals.py --skill review-android-motion --dry-run     # plan only
./scripts/run-evals.py --skill review-android-motion --model claude-code/claude-sonnet-4-6
./scripts/run-evals.py --skill review-android-motion --battery stale-exception
```

## What is being measured

Pioneer runs every case twice: **`baseline`** without the skill and **`with-skill`** with
it. That turns "is this skill worth anything" into an experiment rather than an opinion.
If with-skill does not beat baseline, the skill is decoration.

The grader is deterministic set-matching on rule id plus line-range overlap. Nothing is
scored by a model, because an LLM judging prose rewards length, confidence, rule vocabulary
and finding count — and with-skill wins on all four before correctness enters.

The output contract lives in the **case prompt**, not in the skill, so baseline answers the
same question in the same shape. Otherwise the measurement is "did it know our format".

## The batteries

Pioneer's two arms are fixed, so a second factor cannot be an arm. Each battery is a
separate `evals*.json`, and all four stage **identical case ids, prompts and filenames** —
only the file contents differ. The agent cannot tell which battery it is in.

| Battery | Stages | Asks |
|---|---|---|
| `no-motion-language` | code only | Is the violation found at all, and is the correct code left alone? |
| `established-language` | code + a MOTION.md with a `DECIDED` token | Does severity rise, and is the token named as the fix? |
| `stale-exception` | code + a MOTION.md whose exception names a symbol that is gone | Is a dead exception enforced on authority alone? |
| `phantom-language` | code only, prompt claims a MOTION.md exists | Are conventions invented from a file that was never provided? |

`phantom-language` is the one no other battery can replace. A skill that hallucinates a
motion language scores well everywhere else, because its fabrications tend to match what a
real MOTION.md would have said. Only asking about a file that does not exist separates
reading from confabulating.

## Coverage of T-001

One rule, deliberately, taken as far as it goes before adding a second:

- **Recall** — the NavHost with no transitions specified (`c10`).
- **Precision** — the same file with all four transitions bound to product tokens (`c11`),
  which must produce no finding. Both fixtures also carry a correct gesture-driven
  `Animatable` and a correctly-specified fade, declared as `negatives`, so over-flagging
  anywhere in the file is caught.
- **Severity** — graded separately from detection. Finding the right thing and misjudging
  how much it matters is a different failure from missing it, and against an established
  language it is the more interesting one.
- **Document trust** — `stale-exception` and `phantom-language` test the two ways a skill
  can be wrong about MOTION.md: over-trusting a stale one, and inventing an absent one.

## Fixture naming

Directories are opaque (`c10`, `m1`) and staged filenames are realistic
(`AppNavigation.kt`, `MOTION.md`). Pioneer lists every staged file in `case.json` and prints
them to stderr, so a path that describes what it contains hands the agent the answer — the
run still completes and still produces a score, and the score means nothing.

`scripts/check-fixture-leaks.sh` enforces this, and CI runs it. Upstream proposal to move
the guard into Pioneer itself: [rock3r/pioneer#64](https://github.com/rock3r/pioneer/issues/64).
