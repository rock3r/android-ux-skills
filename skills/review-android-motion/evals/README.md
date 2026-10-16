# Evals for `review-android-motion`

This suite runs with [Pioneer](https://github.com/rock3r/pioneer) and is graded by
`scripts/run-evals.py`.

```bash
./scripts/run-evals.py --skill review-android-motion --dry-run     # validate and plan
./scripts/run-evals.py --skill review-android-motion --model claude-code/claude-sonnet-4-6
./scripts/run-evals.py --skill review-android-motion --battery stale-exception
./scripts/run-evals.py --skill review-android-motion --runs 5      # average 5 samples per arm
```

Use `--runs` to average across multiple runs when model outputs vary between calls. Scalar
metrics are averaged across runs, while diagnostic lists (such as false positives and
unlabeled findings) are concatenated so single-run failures remain visible.

## Environment requirements

- **`pi` and `pioneer` must be on `PATH`.** Non-interactive shells often skip `nvm`
  initialization, which hides binaries installed under Node version managers.
  `run-evals.py` resolves the real path of `pi` and passes its package directory to the
  Pioneer sandbox via `--runtime-read`, because `pi` on `PATH` is a symlink into a Node
  package that imports sibling `chunks/` files.
- **Extension-backed model providers require Pioneer `0.3.6` or newer.** Earlier versions
  copied only `pi`'s root config files into the sandbox and omitted `extensions/`, causing
  providers such as `claude-code` and `kimi-code` to fail with `"model not found"`.
  Pioneer `0.3.6` ([pioneer#82](https://github.com/rock3r/pioneer/pull/82)) copies enabled
  extensions into the sandbox. Providers billed per token are refused unless you pass
  `--allow-metered`.
- **Run directories live outside the repository.** Pioneer refuses run directories under
  protected roots such as `/srv`. Output defaults to `~/.cache/android-ux-skills`; set
  `--work-dir` or `ANDROID_UX_SKILLS_WORK_DIR` to override it.

Running `--dry-run` still executes `validate()`, which checks that every declared line
range is in bounds and starts and ends on non-blank lines, rejects overlapping spans, and
verifies that every cited rule ID exists in `STANDARDS.md`. However, if editing a fixture
shifts a range onto different non-blank lines inside the file, `validate()` cannot detect
that the span moved off its target construct—always update the line ranges in `evals*.json`
when editing a fixture.

## How detection grading works

Pioneer runs every case in two arms: **`baseline`** (without the skill) and
**`with-skill`** (with the skill loaded). Comparing the two arms shows whether the skill
improves detection and precision over the base model.

`run-evals.py` grades findings deterministically by checking line-range overlap rather than
asking an LLM judge to score prose. Using a generative model to score free-form reviews
tends to reward longer outputs, confident tone, and rule terminology even when the findings
are wrong.

To keep the comparison fair across both arms:

- **The output format is appended to the case prompt**, not hidden inside the skill. Both
  `baseline` and `with-skill` are asked to write their normal review followed by a
  `FINDINGS` summary block at the end.
- **Baseline is not required to know our rule IDs.** The `with-skill` arm must match file,
  line range, class, and rule ID (`T-001`, `F-003`, and so on). The `baseline` arm is
  graded on file, line range, and class using whatever short identifier it chooses.
- **`floor`, `obligation`, and `taste` are reported separately** and never averaged. Models
  already catch many mechanical `floor` bugs without help; keeping `taste` separate shows
  whether the skill improves design judgment.

### Additional fields reported by `run-evals.py`

| Field | What it tracks |
|---|---|
| `severity_right` / `severity_wrong` | Whether the reported severity (`minor` vs. `major`) matches the expected severity for that battery's context. |
| `fabricated` | Product-specific identifiers (such as `AppMotion.destinationEnter`) that appear in the review output despite not existing in any staged file or skill reference doc. `validate()` verifies that `forbidden_strings` do not appear in the staged inputs or skill docs. |
| `blanketing` | Findings whose line range covers both the planted defect and clean `negatives` spans around it. Counted once and flagged so a single whole-file span cannot score as a clean hit. |
| `unlabeled` | Findings that fall outside both `expect` and `negatives` spans. These are held out for human review (via `scripts/eval-queue.py`) rather than automatically counted as false positives. |
| `unparsed` | Lines inside the `FINDINGS` block that look like findings (for example, Markdown table rows) but do not match the required line format. |
| `duplicates` | Repeated findings on the same span, collapsed so duplicates are neither rewarded nor penalized twice. |

An `expect` entry can also include `also_at` for defects that can be honestly anchored at
more than one location (such as `O-002`, which can be reported on either the composable
playing the Lottie animation or the `.json` asset file missing the marker).

## Evaluation batteries

Because Pioneer fixes the two arms to `baseline` and `with-skill`, project context (`MOTION.md`
presence and state) is varied across four separate battery files (`evals*.json`):

| Battery | Cases | Staged files | Question tested |
|---|---|---|---|
| `no-motion-language` | 10–12, 20–29, 30–39, 40–48, 50, 51, 60, 70, 80 | Kotlin source (and Lottie JSON for case 30) | Does the skill find the planted defect and leave the compliant twin alone? |
| `established-language` | 10, 11, 40 | Kotlin source + `MOTION.md` with `DECIDED` entries | Does severity escalate to `major`, does the fix name the project's token, and does the skill use the frequency map in `MOTION.md`? |
| `stale-exception` | 10 | Kotlin source + `MOTION.md` with a lapsed exception | Does the reviewer check whether an exception's condition ("until typed routes land") still holds in the code? |
| `phantom-language` | 10 | Kotlin source only, while the prompt claims a `MOTION.md` exists | Does the reviewer state that `MOTION.md` is missing instead of inventing conventions? |

When the same case ID appears in multiple batteries, it stages the same filename so the
file path never hints at the battery variant. Only cases whose expected result changes with
`MOTION.md` are included in the secondary batteries.

## Rule coverage

The suite covers 34 of the 35 rules in `STANDARDS.md` (all except `F-009`, which governs
debug-vs.-release benchmarking practice rather than source code). Every evaluation class in
[`TAXONOMY.md`](TAXONOMY.md) is represented:

| Case | Class | Rule | What the fixture tests |
|---|---|---|---|
| 10 / 11 | B. Context-dependent severity | T-001 | Recall on default `NavHost`, then precision when all four transitions are set. |
| 12 | B. Context-dependent severity | T-001 | Default `NavHost` in a file with no other motion tokens (`minor` severity). |
| 20 | A. Static twin | F-001 | Value `offset(x = ...)` beside lambda `offset { ... }` in the same file. |
| 21 | A. Static twin | F-003 | `animateItem()` without a list key, beside a keyed list. |
| 22 | A. Static twin | T-021 | List keyed by index position, beside one keyed by item ID. |
| 23 | A. Static twin | T-017 | Entrance animation in `LaunchedEffect(Unit)`, beside one guarded across back navigation. |
| 24 | A. Static twin | T-002 | Inline `tween()` / `spring()` at a call site, beside a token definition. |
| 25 | A. Static twin | T-022 | Layout switched on a keyboard boolean, beside one tracking `WindowInsets.ime`. |
| 26 | A. Static twin | F-008 | Animated `padding`, beside the same shift using `offset { }`. |
| 27 | A. Static twin | F-004 | `sharedElement` into a `ModalBottomSheet`, beside one between regular Compose screens. |
| 28 | A. Static twin | T-016 | Unanchored center scale on a modal surface, beside a menu scaling from its trigger anchor. |
| 29 | A. Static twin | F-002 | Drag offset driven by `animateFloatAsState`, beside an `Animatable` carrying release velocity. |
| 30 | C. Absence | O-002 | Lottie file whose final frame clears the canvas with no `reduced motion` marker, beside one whose final frame stays visible. |
| 31 | A. Static twin | T-012 | Button disabled while its animation runs, beside an interruptible twin. |
| 32 | A. Static twin | T-024 | Screen that slides in from the right but fades out on pop, beside one that slides back out. |
| 33 | C. Absence | T-019 | Loading indicator with no show delay or minimum hold time, beside one that has both. |
| 34 | F. Legitimate twin | T-011 | Lateral slide on unordered bottom-bar tabs (violation) vs. ordered sign-up steps (compliant). |
| 35 | A. Static twin | T-023 | Button that waits for a network response before animating, beside one that responds on tap. |
| 36 | C. Absence | O-001 | Status communicated only by a pulsing dot, beside the same pulse paired with a text label. |
| 37 | F. Legitimate twin | T-018 | Overscroll disabled app-wide (violation) vs. disabled on a looping carousel (compliant). |
| 38 | A. Static twin | F-010 | `sharedElement` on text whose style changes between screens, beside an unchanged image. |
| 39 | A. Static twin | F-005 | `withFrameNanos` ticker ignoring `MotionDurationScale`, beside one that checks it each frame. |
| 40 | D. Not in the source | T-009 | Usage frequency unknown in `no-motion-language` (must ask/scope, not flag) vs. defined in `established-language` (must flag). |
| 41 | A. Static twin | F-007 | Dragged chip docking side stored in `remember`, beside one stored in `rememberSaveable`. |
| 42 | A. Static twin | T-004 | Chart bars animated with an Expressive spatial spring, beside bars using Standard. |
| 43 | A. Static twin | T-010 | In-place badge exiting with spatial scale + fade, beside one exiting with fade only. |
| 44 | A. Static twin | T-013 | Stagger delay growing unbounded with list index, beside one capped at a total budget. |
| 45 | A. Static twin | T-027 | Favorite button playing a celebratory pop on both save and clear, beside one that pops only on save. |
| 46 | A. Static twin | T-028 | Layout-shifting banner shown after background sync, beside a snackbar for a manual sync. |
| 47 | A. Static twin | T-025 | Custom bottom sheet that only opens/closes on tap, beside one supporting finger drag. |
| 48 | A. Static twin | O-003 | An endless marquee with no way to stop it, beside the same marquee paused and resumed by a tap. Both go still when animations are off. |
| 50 | E. Composite-only | T-026 | Five individually valid child springs firing at once on a single screen event. |
| 51 | E. Composite-only | T-020 | Expanding panel on the slow tier paired with inner options on the fast tier. |
| 60 | F. Legitimate twin | F-006 | `animateContentSize` clipping an elevated Card's shadow (violation) vs. a flat text reveal (compliant). |
| 70 | G. Framework-correct (hybrid) | T-008 | Standard `NavHost` (must not flag) alongside a custom `BackHandler` missing predictive back (must flag). |
| 80 | G. Framework-correct (pure) | — | Clean file using framework-handled motion; any reported finding is a false positive. |

In Case 40, `no-motion-language` treats the spring as a `negative` (asserting a violation
without knowing usage frequency is a false positive), while `established-language` supplies
the frequency map in `MOTION.md` and requires flagging it. Note that `run-evals.py` only
checks that the review did not assert a finding in `no-motion-language`; whether the
review asked the question is checked by `judge-evals.py` and in the transcript.

## Three evaluation passes

| Script | Question answered | Method |
|---|---|---|
| `run-evals.py` | Did the review flag the expected lines and avoid clean lines? | Deterministic line-range overlap |
| `judge-evals.py` | Did the review follow behavioral expectations (concrete fix, no ungrounded claims)? | Calibrated typed classifier (Jev) |
| `read-evals.py` | Why did a case miss or produce an uncertain classifier score? | Blinded multi-model transcript summary (prose only, never scored) |

```bash
./scripts/judge-evals.py --calibrate-only                    # verify classifier calibration
./scripts/judge-evals.py --report report.json --out judge.json
./scripts/read-evals.py --report report.json --judge judge.json --out reading.md
./scripts/read-evals.py --report report.json --judge judge.json --full
```

`run-evals.py` and `read-evals.py` run across at least two models from
`scripts/model-roster.json` by default (pass `--allow-single` to run with one model), while
`judge-evals.py` averages repeated samples (`--samples`) against the Jev classifier
endpoint. Testing reviewer or reader passes against a single model conflates the skill's
effect with that model's baseline tendencies.

`read-evals.py` runs in an empty temporary directory so reader models cannot inspect
`evals/*.json` answer keys, and strips arm labels and rule IDs before presenting
transcripts. It outputs a `DECISION:` header line per reader so disagreements between
readers are easy to spot, and it never feeds back into numeric scores.

## How the classifier pass (`judge-evals.py`) works

Line-range matching checks *where* a finding landed, while `judge-evals.py` checks the
behavioral expectations in each case (`expectations` in `evals*.json`) and universal review
quality checks in `judge-checks.json`:

- **Universal checks (`judge-checks.json`):** Run on every transcript in every battery
  without referencing rule IDs or skill terminology. They check whether the review names a
  concrete code fix, separates observed code from assumptions, keeps its prose consistent
  with its `FINDINGS` block, and stays within scope.
- **Per-case checks (`evals*.json`):** Check case-specific expectations, such as naming
  `offset { }` as the fix or reporting a composite defect at the parent screen composable.

Key design details of `judge-evals.py`:

- **Constrained classification rather than free-form judging:** Jev returns probability
  distributions over pre-declared options (`noul`, `choice`, `score`) rather than generating
  text. Low-confidence answers become **abstentions** for human inspection rather than
  noisy pass/fail flips.
- **Multi-sample probability averaging (`--samples`, default `3`):** Because classifier
  probabilities can vary slightly across calls near a threshold, `judge-evals.py` averages
  the returned probability distributions across samples before applying thresholds.
- **Acceptable-set probability mass:** For multi-option `choice` checks where more than one
  option is acceptable (for example, either asking the user for usage frequency or stating
  a conditional assumption), `judge-evals.py` sums the probability mass across all
  acceptable options rather than thresholding on single-option `confidence`.
- **Mandatory two-sided calibration (`judge-calibration.json`):** Before grading any real
  transcript, `judge-evals.py` runs against hand-labeled pass and fail examples in
  `judge-calibration.json`. `validate()` requires every active check to have both passing
  and failing calibration items, and any wrong answer on the calibration set halts grading.
  Checks that fail calibration reproducibly (such as the withdrawn `fabricates_input`
  check, documented in `judge-checks.json`) are removed rather than left in the score;
  fabrication on the `phantom-language` battery is enforced deterministically via
  `forbidden_strings`.

### Configuring the classifier API key

`judge-evals.py` reads the API key from `TYPESAFE_API_KEY`, `TYPESAFE_API_KEY_SPEC`, or
`~/.config/typesafe/key` (overridable via `TYPESAFE_API_KEY_FILE`). A key spec supports
three formats:

| Format | Behavior |
|---|---|
| `op://Vault/Item/field` | Reads the secret on demand via the 1Password CLI (`op`). |
| `!<shell command>` | Runs the command and uses its first line of stdout as the key. |
| Any other string | Treated as a literal API key. |

There is no `--api-key` CLI flag so keys do not appear in process tables or shell history.

#### Option 1: Amp secret on an Amp runner

Store the key as an Amp secret from the machine with 1Password access:

```bash
op read "op://Private/TypeSafe/test api key" \
  | amp secrets set TYPESAFE_API_KEY --user --secret --data-file -
```

Start the runner with `--amp-env` (or `amp.runner.env.enabled`) so `TYPESAFE_API_KEY` is
injected into runner command environments.

Note that `--amp-env` injects the secret into the environment of every command executed by
threads on that runner, and `--user` scope exposes it to all projects the runner serves.
Prefer project-scoped secrets when this repository is configured as an Amp project, or use
an on-demand key file (`TYPESAFE_API_KEY_FILE`) when the runner serves unrelated work.

#### Option 2: Pushing the key to a remote runner over SSH

Because 1Password desktop integration is tied to the local GUI login session, running
`ssh <runner> 'op read ...'` from a remote machine fails with `No accounts configured`.
Instead, push the key from the machine with the unlocked vault into the runner's in-memory
tmpfs (`/run/user/<uid>/jev-key`, mode `0600`):

```bash
./scripts/push-jev-key.sh <runner-host> "op://Private/TypeSafe/test api key"
```

Then set the runner's key spec to `!cat /run/user/$(id -u)/jev-key` (re-run after a
reboot). Alternatively, use a 1Password service account (`OP_SERVICE_ACCOUNT_TOKEN`) with
a shared vault (service accounts cannot read a `Private` vault).

### Alternative and local System One classifiers (Cloudflare Clef and Laya)

`judge-evals.py` defaults to `jev-1.14.0` on TypeSafe's API, and `TYPESAFE_ENDPOINT` /
`--backend` can target any System One-compatible classifier (`choice`/`noul`/`score`):

- **Cloudflare Clef (`clef` 27B, `clef-flash` 9B, `clef-omni` 30B-A3B, Apache-2.0):**
  Pass `--backend clef-flash` or `--backend clef` (with `CLOUDFLARE_ACCOUNT_ID` and
  `CLOUDFLARE_API_TOKEN` or a key spec) to run against Workers AI, or point
  `--endpoint` at a local `/v1/systemone` server running
  [`mlx-community/clef-flash-4bit`](https://huggingface.co/mlx-community/clef-flash-4bit)
  (Apple Silicon MLX, 6.2 GB),
  [`ggml-org/Clef-Flash-GGUF`](https://huggingface.co/ggml-org/Clef-Flash-GGUF)
  (`llama.cpp`), or `ollama pull clef` (`http://127.0.0.1:11434/v1/systemone`). With a
  16k–64k+ context window, Clef and Clef-flash classify full review transcripts without
  truncating the `FINDINGS` block.
- **Laya ([`convaiinnovations/laya`](https://huggingface.co/convaiinnovations/laya),
  Apache-2.0):** Implements the same schema on CPU or CUDA via `laya-serve`, but its
  322M–421M checkpoints cap state length at ~320–768 tokens and truncate overlong inputs
  from the end, cutting off the `FINDINGS` block on longer review transcripts.
  `judge-evals.py` logs the maximum state size and warns above 700 tokens in case
  per-check excerpts are used with Laya.

## Preventing fixture leaks

Fixture directories use opaque IDs (`c10`, `m1`) and realistic filenames
(`AppNavigation.kt`, `MOTION.md`), because Pioneer exposes staged filenames to the agent
under test.

`scripts/check-fixture-leaks.sh` runs in CI and checks both **filenames** and **comments
inside fixtures** so KDoc comments describe only what the UI component does, never which
rule it violates. See [rock3r/pioneer#64](https://github.com/rock3r/pioneer/issues/64) for
the upstream path-guard proposal.
