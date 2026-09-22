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

Two environment notes, both of which cost an evening to find once:

- **`pi` and `pioneer` must be on PATH.** If they are installed under nvm, a non-interactive
  shell has not loaded it and they will appear to be missing entirely. `run-evals.py`
  resolves the actor's *real* path and grants its package directory to the sandbox, because
  `pi` on PATH is a symlink into a node package and the sandbox otherwise leaves Node
  hunting for the bundle's `chunks/` beside the symlink.
- **The sandbox sees only part of pi's configuration.** Pioneer copies five root files
  into the sandboxed pi home — `auth.json`, `models.json`, `models-store.json`,
  `settings.json`, `AGENTS.md` (`src/pi-home.ts`, `DEFAULT_ROOT_FILES`). Per-provider
  catalogues such as `claude-code-models.json` are not among them, so those providers
  resolve on the host and fail inside the sandbox with *"model not found"* rather than an
  auth error. That is why `claude-code` is a reader and never an arm.
- **Prepared batteries never live in the repo.** Pioneer refuses a run directory under a
  protected root, `/srv` among them, and this checkout is reached through a symlink into
  `/srv`. Output goes to `~/.cache/android-ux-skills` by default; `--work-dir` or
  `ANDROID_UX_SKILLS_WORK_DIR` moves it.

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
| `fabricated` | Strings that appear nowhere in the staged input **or in the skill's own reference docs**, which the with-skill arm can read every word of. `validate()` refuses a case whose forbidden strings are readable from either, so a hit can only be invention. The list is product-specific identifiers such as `AppMotion.destinationEnter`, not the skill's vocabulary: an earlier version listed `DECIDED` and duly failed a run for saying *"MOTION.md was not present, so I could not verify the DECIDED conventions"* — which is the correct answer, not a fabrication. |
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

## Three passes, each doing only what it is suited to

| Pass | Question | Method |
|---|---|---|
| `run-evals.py` | did it name the right lines | deterministic set-matching |
| `judge-evals.py` | was the review sensible work | a classifier, typed answers |
| `read-evals.py` | what does the unclear case mean | a language model, prose only |

The third exists because the first two share a limit: neither can explain itself.
Span-matching says a finding missed and cannot say whether the review nearly had it; the
classifier says 0.62 and cannot say what it was looking at. Both land on a human, and
reading transcripts by hand is how an eval suite stops being run.

```bash
./scripts/read-evals.py --report report.json --judge judge.json --out reading.md
./scripts/read-evals.py --report report.json --judge judge.json --full   # read everything
```

**Every pass uses at least two models, and refuses to run with one** unless told
`--allow-single`. Not for redundancy — for bias. Every model has a house style, one terse
and prone to missing things, another expansive and prone to inventing them. A skill
measured against a single model is measured against that model's habits as much as its own
merit, and a reading produced by one model is a single opinion wearing the clothes of a
conclusion.

That is not theoretical. Sweeping two codex models over the phantom battery, the older
fabricated a motion language where the newer did not. On an earlier sweep
`gemini-3.5-flash-lite` scored the skill at
0 → 1 taste hits and `gemini-3.5-flash` at 1 → 1: against the weaker model the skill looks
essential, against the stronger one it looks like it adds nothing, because the stronger
baseline found the defect unaided. Either number alone is a confident, misleading answer.

Readers get a `DECISION:` line before their prose. It is not a score — it exists so two
readings can be compared without reading both in full, and **where they disagree that is
reported rather than resolved**. On the first two-reader run one said a review had asserted
contents of a file it was never given; the other checked, found the file had in fact been
staged, and concluded the opposite. The second was right, and a single reader would have
had us "fix" a question that was not broken.

Readers run from an empty temporary directory rather than the repo. One of them was
observed opening fixture files to verify a claim — a good instinct in the wrong room, since
the same working directory also contains `evals/*.json`, which is the answer key.
`scripts/model-roster.json` holds the tiers: `arms` for the reviewer under test, `readers`
for this pass, and `sota` for a periodic manual re-read. Availability is discovered at run
time, because an entry there is an intention rather than a promise.

It scores nothing, and nothing it produces feeds a number — which is the same reason
`run-evals.py` keeps models away from its grading. It is told nothing about which arm
produced a transcript and sees rule ids normalised out, because an explanation that begins
"this is the one with the skill" explains our expectations rather than the text.

It also turns out to be the best critic of the classifier's questions. On its first real
run it argued that three of them were compound — that `fabricates_input` fired on any
mention of specific code because the clause that mattered, *that the review was never
given it*, sat buried behind the clause that did not — and that `conformance_claim` was
missing a case reviews legitimately fall into, judging against framework guidance without
claiming to know this project's conventions. All three were right, and fixing them moved
the classifier off the fence. Its prompt asks explicitly whether the *review* is
borderline, the question is badly posed, or the acceptable answers are incomplete, so that
blaming the question is a finding rather than a default.

## The classifier pass

Set-matching catches whether the right line was named. Most of what a case actually claims
to test lives in its `expectations` array — "names `offset { }` as the fix", "reports it
against the screen rather than a child", "does not cite MOTION.md content" — and for a long
time the grader read none of it. Of 57 expectation lines across the four batteries, 51 are
already phrased as a yes/no about a single response.

Those become `checks`, graded by `scripts/judge-evals.py` against the saved transcripts:

```bash
./scripts/judge-evals.py --calibrate-only                    # trust check, costs pennies
./scripts/judge-evals.py --report report.json --out judge.json
```

Checks come in two kinds. **Universal** checks in `judge-checks.json` run against every
transcript in every battery and ask whether the review is a sensible piece of work at all:
does it invent files it was not given, does it name a concrete change or only wave at one,
does it separate what it saw from what it assumed, do its prose and its findings list agree,
does it stay on the subject it was asked about. None of them mentions a rule id, this
repository, or the existence of a skill — so the classifier cannot tell which arm it is
reading, and answering well does not depend on sharing our vocabulary. **Case** checks are
the per-case ones, and they do know what was planted.

The split matters beyond tidiness: a question phrased in our private vocabulary can only be
answered well by an arm that shares it, which measures vocabulary all over again. The
universal checks are also where the failures that get a reviewer switched off actually live,
and span-matching cannot see any of them.

**It is a classifier, not a judge model.** `run-evals.py` refuses to score anything with an
LLM because a model comparing two prose reviews rewards length, confidence, vocabulary and
finding count, and the with-skill arm wins on all four before correctness enters. Jev
cannot generate text at all: it takes state plus typed questions and returns a value from
a set declared here in advance. It has no way to prefer the longer review because it has
no way to say anything outside the schema. Every answer carries a calibrated probability,
so a question it is unsure about becomes an **abstention routed to a human** rather than a
confident guess folded into a number.

**The classifier is not deterministic.** Measured on one unchanged calibration state,
the same question returned 0.67 on one call and above 0.70 on the next — enough to flip a
verdict across a threshold and to make the calibration gate itself flap between runs.
`--samples` (default 3) asks each question several times and averages the *distributions*,
which is the right operation because the probability is the quantity being thresholded. All
questions for one state travel in a single request, so this is cheap.

**Calibration counts three outcomes, not two.** Answering the opposite of a settled reading
means the classifier cannot be trusted; declining to answer only means it is cautious near
that boundary. Folding them together made the gate flap on a single borderline item while
saying nothing about whether it had ever actually been wrong. Only *wrong* answers count
against the floor; undecided ones are reported separately. On the current 25-item set the
classifier has not yet been wrong once — it declines on one item and answers the rest.

**Thresholds are about the acceptable set, not the winning option.** For a `choice`, the
question is "is the answer one we accept", so the test is the probability mass those
answers hold — not the returned `confidence`, which measures spread across *all* options
and so falls as options are added. This was a real bug: on a review that plainly asked a
question, Jev returned `asks` 0.6, `scopes` 0.4 and exactly zero on both wrong answers, at
`confidence` 0.47. Every bit of mass sat on the two answers we accept, and the old logic
recorded it as an abstention. It failed worst precisely where several answers are
deliberately acceptable.

**Schema-safety is not accuracy.** A constrained model can still be confidently wrong about
a valid option. So `judge-calibration.json` holds hand-written responses whose reading is
unambiguous, the classifier answers those first on every invocation, and if it gets any of
them wrong its output is withheld entirely. `validate()` refuses to run a battery whose
checks are not calibrated **in both directions** — a check calibrated only on states that
should pass would be satisfied by a classifier that answers "pass" to everything.

**Residual leak.** The rule-id column is normalised before classification, since with-skill
writes `T-009` and baseline writes whatever it invented. That removes the token that
identifies the arm outright; prose style still differs, and no amount of scrubbing fixes
that.

Judge results are printed beside the detection numbers and never added into them.

What this still cannot do is tell you whether a question was a *good* one, or read a
transcript for reasoning that was right for the wrong reason. Jev generates no text, so
that remains a human job — which is what the transcripts are for.

### Supplying the key

No vault path is baked into the repo. A key *spec* goes in `TYPESAFE_API_KEY_SPEC` or in a
file (`~/.config/typesafe/key`, override with `TYPESAFE_API_KEY_FILE`) and takes one of
three forms:

| Form | Meaning |
|---|---|
| `op://Vault/Item/field` | read with the 1Password CLI at the moment it is needed |
| `!<shell command>` | run it; its first line of output is the key |
| anything else | a literal key |

There is deliberately no `--api-key` flag, because an argument is visible in the process
table and in shell history.

#### When the vault is on a different machine from the runner

The obvious spec — `!ssh vaultmachine 'op read "op://..."'` — **does not work**, and it is
worth knowing why before trying it. 1Password's desktop-app integration is bound to your
GUI login session. Over SSH, `op` reports `No accounts configured` however many prompts you
approve, and `op signin` only exports a session token into the shell that ran it. The vault
side has to initiate. Two ways:

**Push it, from the machine with the vault.** Works today, needs nothing new:

```bash
./scripts/push-jev-key.sh <runner-host> "op://Private/TypeSafe/test api key"
```

The key is piped from `op` straight into the runner's per-user tmpfs — RAM only, `0600`
inside a `0700` directory, gone on reboot. It touches no disk on either machine and never
appears in an argument list. The runner's spec is then `!cat /run/user/$(id -u)/jev-key`.
Re-run it after a reboot, or whenever the runner says the file is missing.

**Or use a service account**, which is 1Password's supported path for unattended
automation: install `op` on the runner, set `OP_SERVICE_ACCOUNT_TOKEN`, and the spec
becomes the `op://` reference directly with no second machine involved. One catch to check
before committing to it — a service account cannot read a *Private* vault, so the item has
to live in a shared one.

### Could this run locally instead? (parked)

Not being pursued — the hosted classifier is fine. Recorded because the question will come
back, and because the blocker is specific rather than a matter of taste.

[Laya](https://github.com/NandhaKishorM/laya) is the obvious candidate — Apache-2.0 open
weights, the same `choice`/`noul`/`score` vocabulary, and a PyTorch package that runs on
CPU or CUDA. (`laya-mlx` is a separate third-party Apple-silicon port, not the Linux one.)
`TYPESAFE_ENDPOINT` already exists so the classifier can be pointed anywhere.

It does not fit yet, for one specific reason. Laya's checkpoints cap the *state* at roughly
320 tokens (English, 512 total) or 768 (multilingual and typed-decisions, 1024 total), after
the question and its options take their share — and an overlong state is **truncated from
the end**. Our transcripts run 400 tokens for the simplest single-defect review and grow
from there, and the findings block is the last thing in them. Laya would silently discard
precisely the part being graded and answer confidently about the remainder.

Two other things to know before revisiting it: the released package has no HTTP server at
all — the Jev-compatible `/v1/systemone` route exists only in an unmerged pull request — and
its own benchmarks note both base checkpoints ship overconfident, with the multilingual one
having no fitted temperatures.

None of that is fatal. The route in is per-check excerpts rather than whole transcripts,
which most checks would accept anyway, plus a temperature fitted on our own calibration set.
`judge-evals.py` reports the largest state it classified, and warns past 700 tokens, so the
size of that gap stays visible rather than being rediscovered later.

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
