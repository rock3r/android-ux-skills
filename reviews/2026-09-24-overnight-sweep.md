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

## Second sweep, same day: 25 cases

At `961a26f`, after the severity decision, the skill's severity paragraph, the static
twins 12, 26–29, 31 and 32, and the Compose-Pi and pioneer fixes. GLM 5.3 and Luna 6, two
runs each, every arm completed. 25 case-battery pairs; the totals below count every case
where both repeats ran.

| Model | Run | floor | obligation | taste | false positives | severity right/wrong |
|---|---|---|---|---|---|---|
| GLM 5.3 | 1 | 2/6 → **6/6** | 1/1 → 1/1 | 10/15 → **15/15** | 29 → **1** | 10/3 → 22/0 |
| GLM 5.3 | 2 | 3/6 → **6/6** | 0/1 → 1/1 | 11/15 → **14/15** | 29 → **7** | 11/3 → 20/1 |
| Luna 6 | 1 | 4/6 → **6/6** | 0/1 → **1/1** | 4/15 → **14/15** | 7 → **3** | 7/1 → 18/3 |
| Luna 6 | 2 | 1/6 → **6/6** | 0/1 → **1/1** | 3/15 → **14/15** | 9 → **1** | 4/0 → 17/4 |

**The skill finds every floor and obligation defect in all four runs**, against 1–4 of 6
without it. **Taste rises by 3–5 for GLM and by 10–11 for Luna 6**, well outside the
spread between repeats. False positives fall in every run, from 29 to 1–7 for GLM.

Luna 6 improved most since the morning sweep: taste 7/10 → 14/15 on a larger suite. The
new cases account for part of that, and so does the skill telling reviewers to ask about
frequency and to check an exception's condition.

**What still misses:**

- **Case 50, the composite.** Both models name `T-026`, but on the children's line range
  rather than the event's, so span matching scores a miss and a false positive. Luna 6 did
  it in both runs, GLM in one. It is the case class E exists for, and the hardest to span.
- **Severity for a convention held only in code.** Luna 6 still reports cases 10, 24 and
  31 as minor — 7 of its 7 severity errors. GLM makes that call correctly in all but one.
  The skill says it now; Luna 6 does not act on it consistently.
- **GLM over-applies `T-001`** on case 32, reporting the unset `exitTransition` and
  `popEnterTransition` as leaving the library default. They are not part of the case's
  question, and the finding lands on declared-clean lines once.

## Known limits

- Two runs is the minimum that shows a spread, not enough to estimate one.
- The verification runs are per-case, not a second full sweep; the table in *Result* is
  from before the fixes and is the last full measurement.
- Luna 6 returned empty output often enough to cost it four case-arms of eighteen.
- Luna 6 names the right defect on case 70 and cites the wrong lines for it; span
  matching scores that as a miss and a false positive, which is correct.

## Third sweep, 24–25 September: every rule a fixture can exercise

Cases 33–47 brought coverage to 33 of 34 rules: 41 case-battery pairs. GLM 5.3 and Luna 6
ran two runs each; Opus 5.5 ran once, through `claude-code` on the subscription.

A first attempt at `cc103d0` was stopped once it had turned up defects in four fixtures
and two gaps in the skill. Those were fixed and the sweep restarted at `8a5e05f`. The
restarted sweep found defects in six more fixtures (34, 35, 37, 44, 45 and 47). Those were
fixed and re-run at `edb97a3`–`7589995`, and the table uses the re-runs. GLM also re-ran
case 11, where one with-skill repeat returned nothing.

| Model | Run | floor | obligation | taste | false positives | severity right/wrong |
|---|---|---|---|---|---|---|
| GLM 5.3 | 1 | 4/9 → **9/9** | 1/2 → **2/2** | 20/26 → **26/26** | 59 → **5** | 20/5 → **37/0** |
| GLM 5.3 | 2 | 3/9 → **9/9** | 2/2 → 2/2 | 19/26 → **25/26** | 63 → **6** | 17/7 → 33/3 |
| Luna 6 | 1 | 1/9 → **9/9** | 0/2 → **2/2** | 11/26 → **24/26** | 10 → **3** | 8/4 → 25/10 |
| Luna 6 | 2 | 2/9 → **9/9** | 0/2 → 1/2 | 6/26 → **24/26** | 14 → **1** | 6/2 → 27/7 |
| Opus 5.5 | 1 | 3/9 → **9/9** | 2/2 → 2/2 | 16/26 → **26/26** | 38 → **0** | 18/3 → **37/0** |

**The skill finds every floor defect in every run of every model.** Without it, one to
four of nine. False positives fall in every run: by a factor of ten for GLM, and to none
for Opus. Opus with the skill misses nothing and flags nothing it should not; without
it, it finds 16 of 26 taste defects and flags declared-clean code 38 times.

**Luna 6's taste rises from 6–11 to 24 of 26**, in both repeats. Its remaining misses are
single runs spread over five cases, three of them class C absences (33, 36, 46).

**Luna 6 still calls a convention held only in code minor.** Every one of its severity
errors is that call. The skill now sets severity in the synthesis and says a convention
needs no MOTION.md, and Luna 6 gets it right on cases 23, 32, 43, 45 and 47 in one run of
two. It does not yet do so reliably. Opus makes the call correctly every time; GLM misses
three calls, in both directions.

**The judge agrees in `no-motion-language`.** With the skill, failed checks fall from 21
to 12 for GLM, 85 to 52 for Luna 6 and 13 to 1 for Opus. Where a MOTION.md is staged,
with-skill reviews fail `separates_seen_from_assumed` more often than baseline: they cite
the document's entries, and the classifier sees the review but not the document, so it
cannot tell a citation from an assumption. That is the limit that withdrew
`fabricates_input`.

### Fixture defects the sweep found

Every one was in code declared clean, and each was reported by a model first.

- **Case 20** moved three children on one flag with no leader, a T-026 defect in a case
  built for F-001. Luna 6 reported T-026 instead of F-001.
- **Case 30**'s manual-sync confirmation was a full-width 400×400 Lottie replacing a
  button, which displaces content. T-028 forbids that even for work the user asked for.
- **Case 34**'s ordered steps set two of their four transitions, so the outgoing step
  fell back to the host's default fade while the incoming one slid.
- **Case 35**'s correct twin swapped straight to a spinner with no delay or minimum hold
  (T-019).
- **Case 37**'s "endless" carousel began at page 0, so it had an edge after all.
- **Case 42** read its animated bar values in composition (F-001, both halves of the twin),
  and its card clipped its own shadow (F-006).
- **Case 44** waited on a raw `delay()` that ignores the animator scale (F-005), and put
  two cascades on one screen (T-026).
- **Case 45** snapped its scale before the pop, discarding an in-flight animation (T-012).
- **Case 47**'s panels could not recover from a cancelled back: the restore ran a
  suspending call in a cancelled coroutine. Rotating with a panel open replayed its
  entrance, and the drag area stayed put while the sheet moved.
- **Case 39**'s correct twin copied F-005's own snippet, which read the animator scale once
  and missed a change made while the screen was up. That was a defect in the rule, below.

### Rule, skill and judge changes the sweep drove

- **F-005** now reads the `MotionDurationScale` an effect already carries, every frame.
  `WindowRecomposer` keeps it current through a `ContentObserver`. At zero the loop
  requests no frames.
- **T-018** gives a component with no edge its own bullet. It had asked for a stated
  reason and then called an uncommented `overscrollEffect = null` legitimate.
- **T-019** covers placeholders shown where content is loading. A control acknowledging
  its own press is outside it. Case 35's twin, written to change on the tap as T-023
  asks, had been flagged under T-019 for doing so without a delay.
- **T-020** excludes an element read as a value: a bar moves to show its value, not with
  the pane. That had overlapped T-004, which asks for exactly that split.
- **review-android-motion** now sets severity in the synthesis, where the convention is
  visible, and reports it in the findings table. It says a convention needs no MOTION.md,
  and that line numbers come from a numbered view. Pi's `read` returns plain text, and Luna
  6 had been citing lines in the imports.
- **The judge's `conformance_claim`** failed Opus with the skill on 24 cases for citing the
  twin as the convention, which the severity decision requires. It now accepts a
  convention the reviewer points to in the code it was given. Calibration passes 29 of 29.
  With the fix, Opus with the skill fails one judge check in `no-motion-language`, against
  13 without it.
- **`validate()`** rejects a span that starts or ends on a blank line. An added import had
  slid case 39's span off its function while it still fitted inside the file.

### After the sweep: the Fix column

The judge read 25 of Luna 6's with-skill reviews as offering only generic remedies, such
as "use a non-expressive spec", so the skill now says the Fix column names the call, value
or construct to write. On the eight cases where both of Luna 6's with-skill runs had been
generic, 16 of 16, a re-run at `5245434` was generic 6 times, undecided 3 and specific 7.
Detection on those cases held: taste 5/6 and 6/6 against 6/6 and 6/6.

### Known limits

- Two runs, one for Opus, is the minimum that shows a spread, not enough to estimate one.
- Cases 34, 35, 37, 44, 45 and 47 were re-run after their fixes, not re-swept with the
  rest, and so ran against a slightly later skill.
- `separates_seen_from_assumed` cannot credit a citation of a staged MOTION.md, so read
  its results in `established-language` and `stale-exception` as noise.
- Case 39's tickers never wrap their text or loop. Baselines flag it, with-skill arms do
  not, and it counts as a baseline false positive in both halves.
