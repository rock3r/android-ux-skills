# Overnight sweep — first numbers with error bars

23–24 September 2026. All four batteries, 18 case-battery pairs, two arm models, **two runs
each**. The first run of this suite where a delta can be read against the spread between
repeats, rather than against nothing.

Commit `348dff8`. Arms `zai/glm-5.3` and `openai-codex/gpt-6-luna`, both at `thinking=high`.
Case 25 was added after the sweep started and was run on its own.

## Result

Per run, baseline → with-skill. Each cell is one repeat; two repeats per model. Luna 6's
totals leave out the cases where one of its repeats returned nothing, so its denominators
are smaller than GLM's.

| Model | Run | floor | obligation | taste | false positives | severity right/wrong |
|---|---|---|---|---|---|---|
| GLM 5.3 | 1 | 0/3 → **3/3** | 1/1 → 1/1 | 7/10 → **9/10** | 25 → **5** | 6/2 → 10/3 |
| GLM 5.3 | 2 | 2/3 → **3/3** | 1/1 → 1/1 | 9/10 → **10/10** | 28 → **4** | 10/2 → 11/3 |
| Luna 6 | 1 | 2/3 → **3/3** | 0/1 → **1/1** | 3/8 → **7/10** | 4 → **2** | 5/0 → 11/0 |
| Luna 6 | 2 | 1/3 → **3/3** | 0/1 → **1/1** | 3/8 → **7/10** | 4 → **1** | 3/1 → 11/0 |

Luna 6 baseline left out cases 22, 50 and 80 of `no-motion-language`, and with-skill left out
case 80: in each, one of the two repeats returned empty output three times.

**What holds across both repeats of both models.** The skill finds every floor violation in
every run; the baseline finds between none and two of three. False positives fall in every
run, by a factor of five to seven for GLM. The two with-skill runs of each model agree with
each other closely — Luna 6's are identical on detection — so these deltas are larger than
the noise between repeats.

**What does not.** GLM's baseline taste is 7–9 of 10, so the skill's taste delta for GLM is
one or two findings, and a single run could show either. Luna 6's taste delta is four, in
both repeats.

## Severity: GLM is following the rules, and the labels disagree with them

All six of GLM's with-skill severity "errors" are the same call: `major` where the label
says `minor`, in a battery with no MOTION.md. GLM states its reason every time, and it is a
reading of `STANDARDS.md`:

> major per the standards' "diverges from an `OBSERVED` convention the codebase otherwise
> holds" row and T-001's own severity clause ("a codebase that resolves its specs to tokens
> everywhere else" → major)

It applies the same logic to the static-twin cases: the compliant form sitting in the same
file is, to GLM, a convention the codebase holds. The judge pass shows the same habit from
another side — with the skill, GLM fails `separates_seen_from_assumed` on 21 of 36 reviews
against 7 of 36 without it, and `conformance_claim` on 12 of 28 where no MOTION.md was
staged.

The rules and the labels could not both be right. See *Decided* below: the labels moved.

## Fixture defects the sweep found

Every one was in code declared clean, and every one was reported by a model before anyone
here noticed.

- **Case 24** put two movers on one event — `BookSpine` and `SpineLabel` both reacting to
  one flag with no leader, a `T-026` defect in a case built to carry `T-002` alone.
- **Case 80**, "nothing to find", held its switch and slider values in `remember`, so
  rotation reset settings the user had just made.
- **Case 10/11's `MOTION.md`** still described the status banner as a fade after the
  banner gained an expanding slot; Luna 6 reported the mismatch on its first run.

## Rule and skill changes the sweep drove

- `T-010`'s scope named "the contents of a collapsing container", which GLM stretched to
  case 60's deliberately clamped blurb. Clamped content is now outside it.
- Luna 6 accepted a MOTION.md exception granted "until typed routes land" in a file that
  uses typed routes, and never looked at a hand-rolled `BackHandler`. The skill now says an
  exception holds only while its condition does, and lists the one-step `BackHandler` in
  its never-ship table.

## Harness changes the sweep drove

- `--runs n` kept only the mean. Each repeat's grade is now kept, and the summary prints
  the min–max across repeats. This sweep predates that change; the table above was
  regraded from its transcripts.
- The judge failed every with-skill review in `established-language` and
  `stale-exception` on `conformance_claim`, for judging code against a MOTION.md it had
  been given. The check is now skipped where a MOTION.md is staged.

## Verification after the changes

Every change above was re-run on the cases it touches, both models, two runs each. The
fixtures were fixed again where the re-run found something new.

| Case | Before (skill, 4 runs) | After (skill) | Notes |
|---|---|---|---|
| stale-exception 10 | Luna 6 0/2 | **3/3** that ran | Every run cites the lapsed condition |
| 40, asks rather than asserts | judge: **0/4** ask or scope | judge: **4/4** scope, at 1.00 | Baseline stays silent 4/4 |
| 60 | GLM flags the blurb vanishing | F-006 **4/4** | The blurb now fades; GLM was right |
| 70 | Luna 6 missed T-008 2/2 | **2/4** scored | Luna 6 now names T-008 both times but cites the NavHost's lines, a miss plus a false positive |
| 80 | GLM flags `remember` once | **0/4** findings | As the case requires |
| 24 | GLM's two-movers finding | T-002 **4/4** | Luna 6 found a static-carrier gap, now fixed |

Case 40's result is the one that matters most. It is the only case whose pass is a
*question*, span-matching cannot see a question at all, and before this run neither model
ever asked. With one paragraph added to the skill both give a conditional verdict and name
the frequency they assume, and neither baseline does. That is also the clearest case in
the suite of the skill doing something a capable model does not do unaided.

## Decided: a convention in the code raises severity

Seb, 24 September: **major**. A spot that departs from what the rest of the code does is
how a regression usually arrives — an agent about to introduce a bad change, or someone new
who does not know the convention — so it is major whether or not MOTION.md records it. The
recommendation above it was the opposite, and was overruled.

The severity table now counts a convention the code holds, written or not; the output
contract says the same. Labels moved to match: case 10 is major in `no-motion-language` and
`phantom-language`, and the static twins 22–25 are major, since each file does the right
thing one function away. Case 12 is new and holds the other direction — the same untouched
default in a file with no convention anywhere stays minor. Under these labels, all six of
GLM's severity "errors" in this sweep become correct.

## Opus 5.5, one run

Claude Opus 5.5 through `claude-code` (subscription, not metered), pioneer 0.3.6, at
`614ea32` — before the severity change. One run, so no spread. Graded against the current
labels:

| Arm | floor | obligation | taste | false positives | severity right/wrong |
|---|---|---|---|---|---|
| baseline | 1/3 | 1/1 | 11/11 | 25 | 9/4 |
| with-skill | **3/3** | 1/1 | 11/11 | **0** | 13/2 |

Opus finds every taste defect unaided, so on taste the skill adds nothing; what it adds is
the floor — 1/3 to 3/3 — and precision: 25 false positives to none. Its two severity misses
are cases 22 and 23 reported minor where the new labels, set after this run, say major. Its
one unlabelled finding is `T-028` on case 30, applied to the fixture that rule was written
for.

An earlier Opus run was discarded: Pi was upgraded to 0.87.1 mid-sweep, which stopped
passing tools to the `claude-code` extension, and every later case answered "I don't have
the files". The extension is patched on bepi until Compose-Pi's fix lands.

## Known limits

- Two runs is the minimum that shows a spread, not enough to estimate one.
- The verification runs are per-case, not a second full sweep; the table in *Result* is
  from before the fixes and is the last full measurement.
- Luna 6 returned empty output often enough to cost it four case-arms of eighteen.
- Luna 6 names the right defect on case 70 and cites the wrong lines for it; span
  matching scores that as a miss and a false positive, which is correct.
- Opus 5.5 did not run: OpenRouter returns 402, the account has no credits.
