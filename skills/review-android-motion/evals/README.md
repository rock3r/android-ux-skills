# Evals for review-android-motion

Run with [Pioneer](https://github.com/rock3r/pioneer), graded by `scripts/run-evals.py`.

```bash
./scripts/run-evals.py --skill review-android-motion --dry-run     # validate and plan
./scripts/run-evals.py --skill review-android-motion --model claude-code/claude-sonnet-4-6
./scripts/run-evals.py --skill review-android-motion --battery stale-exception
./scripts/run-evals.py --skill review-android-motion --runs 5    # average 5 samples per arm
```

`--runs` exists because these models are not deterministic and a single sample cannot
separate a capability gap from sampling noise. Scalars are averaged; the diagnostic lists
are concatenated, since a false positive that shows up in one run of five is still worth
reading.

`--dry-run` still runs `validate()`, which checks every declared line range against the
fixture it names, rejects overlapping spans, and rejects rule ids that no longer exist in
`STANDARDS.md`. Ranges are written by hand against files that then get edited; a range that
has drifted off its construct does not fail loudly, it just quietly stops measuring what it
claims to while continuing to report a number.

## What is being measured

Pioneer runs every case twice: **`baseline`** without the skill and **`with-skill`** with
it. That turns "is this skill worth anything" into an experiment rather than an opinion.
If with-skill does not beat baseline, the skill is decoration.

The grader is deterministic set-matching on line-range overlap. Nothing is scored by a
model, because an LLM judging prose rewards length, confidence, rule vocabulary and finding
count — and with-skill wins on all four before correctness enters.

The output contract lives in the **case prompt**, not in the skill, so baseline answers the
same question in the same shape. Otherwise the measurement is "did it know our format".

The contract asks for the review in whatever form the arm would normally produce, followed
by a machine-readable block repeating the same findings. It has to be additive: the skill's
own required output is a markdown table, and a contract demanding "nothing but these lines"
put the two in direct conflict — the with-skill arm would emit its table, parse to zero
findings, and score zero recall with perfect precision. `unparsed` now counts table-shaped
rows, so that failure is loud rather than flattering.

**Baseline is not held to our rule ids.** The contract tells an arm with no standards to
invent its own identifier, so requiring `T-001` from it measured vocabulary rather than
capability: a baseline naming the exact defect at the exact lines scored as a miss *and* a
false positive, and the headline delta could only ever flatter the skill. Baseline matches
on location and class; with-skill must also name the rule. The two arms are therefore
graded by deliberately different criteria, and the delta should be read as "did the skill
find more", not "did it phrase things our way".

### What the grader reports beyond hits and misses

| Field | Why it exists |
|---|---|
| `severity_right` / `severity_wrong` | Severity is the payload of three batteries. It used to be printed but never scored, so a skill answering "minor" everywhere was numerically identical to one whose severity moved with the staged MOTION.md. |
| `fabricated` | Strings that appear nowhere in the staged input. `validate()` refuses a case whose forbidden strings are actually readable, so a hit can only be invention. |
| `blanketing` | One span covering the defect *and* the clean code around it. It counts once, so it cannot also be a false positive — without this, "something on this screen is wrong" would be the highest-scoring answer available. |
| `unlabeled` | A finding outside every labelled span. **Not** a false positive: our labels are not a census of every defect in a fixture, and punishing a real finding we failed to anticipate trains the skill to stay quiet. These need a human, and they are how the label set improves. |
| `unparsed` | Lines that looked like findings and did not parse. Silently dropping them made a badly formatted review indistinguishable from a clean one: zero findings, zero false positives, perfect precision. |
| `duplicates` | Collapsed, so repeating a finding is neither rewarded nor punished twice. |

An `expect` may carry `also_at`, a list of alternate anchors. Some defects have more than
one honest place to report them: O-002's subject is the composable that plays the Lottie,
but the missing marker is a fact about the `.json`, and naming either is correct. Without
alternates the right answer in the reasonable-but-unexpected file scored as a miss.

Floor, obligation and taste are counted separately and never averaged. Floor findings are
mechanical and a capable model finds many unaided; taste is the part meant to justify the
skill. Averaging lets a flat taste delta hide behind a strong floor delta, which is exactly
how this collection would quietly become a linter.

## The batteries

Pioneer's two arms are fixed, so a second factor — what the project has decided — cannot be
an arm. Each battery is a separate `evals*.json`.

| Battery | Cases | Stages | Asks |
|---|---|---|---|
| `no-motion-language` | 10, 11, 20, 30, 40, 50, 60, 70, 80 | code only | Is the violation found at all, and is the correct code left alone? |
| `established-language` | 10, 11, 40 | code + a MOTION.md with `DECIDED` entries | Does severity rise, is the token named as the fix, and does a fact settled in the file stop being treated as unknowable? |
| `stale-exception` | 10 | code + a MOTION.md exception that has lapsed | Is a standing approval enforced after the condition it was granted under has been met? |
| `phantom-language` | 10 | code only, prompt claims a MOTION.md exists | Are conventions invented from a file that was never provided? |

Where a case id appears in more than one battery it stages the same fixture under the same
filename with the same prompt, so nothing about the variant is visible to the agent from the
shape of the task. Two deliberate exceptions, both unavoidable:

- `phantom-language`'s prompt must assert that a MOTION.md exists — that assertion *is* the
  experiment.
- Not every case appears in every battery. A battery only contains the cases whose answer
  the staged document actually changes; padding the rest would multiply runtime without
  measuring anything.

`phantom-language` is the one no other battery can replace. A skill that hallucinates a
motion language scores well everywhere else, because its fabrications tend to match what a
real MOTION.md would have said. Only asking about a file that does not exist separates
reading from confabulating — and only `forbidden_strings` makes that machine-checkable,
since every other signal of fabrication is prose.

`stale-exception` is deliberately harder than it looks. Its exception names the very file
under review and would waive the finding, except it was granted "until typed routes land"
and the file already uses typed routes. An exception naming an absent symbol would have
been passed by any skill that ignores exceptions entirely; this one has to be read against
the code.

## Coverage

One exemplar per eval class in `TAXONOMY.md`, so every harness shape is proven before the
remaining rules are filled in behind it.

| Case | Class | Rule | What it pins down |
|---|---|---|---|
| 10 / 11 | B. Context-dependent severity | T-001 | Recall, then precision on the same file with all four transitions bound to tokens. |
| 20 | A. Static twin | F-001 | The defect and its fix fifteen lines apart in one file. |
| 30 | C. Absence | O-002 | A missing marker, with a twin whose composition legitimately needs none. |
| 40 | D. Not in the source | T-009 | Both directions: unknowable without MOTION.md, required with it. |
| 50 | E. Composite-only | T-026 | Five individually correct children, one wrong screen. |
| 60 | F. Legitimate twin | F-006 | The same clip, once a defect and once deliberate. |
| 70 | G. Framework-correct (hybrid) | T-008 | The framework path must stay silent while the hand-rolled twin is flagged. |
| 80 | G. Framework-correct (pure) | — | Nothing to find. Any finding is a failure. |

Case 40 is the only pair that spans batteries by design. In `no-motion-language` the
frequency of use is genuinely not in the source, so the spring is a `negative` and asserting
a verdict against it is a false positive. In `established-language` the same spring is
covered by MOTION.md's frequency map, so it becomes a required finding. Asking the question
is the pass in the first and a failure in the second — but note that **whether the reviewer
actually asks is not machine-checked**. Only the assertion is. Read the transcript for the
question; the number only tells you it did not assert.

## Fixture naming and leaks

Directories are opaque (`c10`, `m1`) and staged filenames are realistic
(`AppNavigation.kt`, `MOTION.md`). Pioneer lists every staged file in `case.json` and prints
them to stderr, so a path that describes what it contains hands the agent the answer — the
run still completes and still produces a score, and the score means nothing.

`scripts/check-fixture-leaks.sh` enforces this, and CI runs it. It checks two things: paths
that name the defect, and **prose inside the fixtures**. The second matters more and was
missed for longer. A KDoc reading "everything on screen responds to the same single event"
*is* the composite finding, written out for the agent; several cases were measuring comment
comprehension. Fixture comments now say what the code is for, never why it is wrong.

Upstream proposal to move the path guard into Pioneer itself:
[rock3r/pioneer#64](https://github.com/rock3r/pioneer/issues/64).
