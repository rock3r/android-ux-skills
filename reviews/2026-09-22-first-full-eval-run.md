# First full eval run — review-android-motion

22 September 2026. All four batteries, 14 cases, three arm models. The first time the
suite has been run end to end rather than validated.

## Result

| Arm model | floor | obligation | taste | false positives | severity right/wrong |
|---|---|---|---|---|---|
| `zai/glm-5.3` | 0/2 → **2/2** | 1/1 → **1/1** | 3/7 → **7/7** | 20 → **4** | 3/1 → 10/0 |
| `openai-codex/gpt-6-astra` | 1/2 → **2/2** | 0/1 → **1/1** | 3/7 → **7/7** | 7 → **1** | 3/1 → 7/3 |
| `openai-codex/gpt-5.6-luna` | 0/2 → **2/2** | 0/1 → **1/1** | 1/7 → **3/7** | 2 → **1** | 1/0 → 6/0 |

Baseline → with-skill. Every model finds **every floor violation with the skill and none
without it**. Two of three reach 7/7 on taste. False positives fall in all three, most
sharply where they were worst: GLM drops 20 to 4 while its recall rises, so precision and
recall moved together rather than trading against each other.

Severity moves correctly in two of three. Astra is the exception at three wrong, the only
model to miss severity more than once, and the one unexplained result here.

## Luna is the weak arm and that is the point

Luna reaches 3/7 on taste where the other two reach 7/7, and produced seven findings across
fourteen cases against GLM's twenty-two. It stayed silent through `established-language` and
`stale-exception` entirely. Its one finding on case 50 spanned lines 26-98, blanketing every
must-not-flag span in the file.

Run alone, any one of these models supports a different conclusion — "transformative",
"solid", or "mediocre on taste" — with equal confidence. That is the argument for the
two-model minimum, and it has now been demonstrated three separate times rather than
asserted.

## Three harness bugs this run exposed

Each was found because a number looked wrong, and each had been quietly flattering the
suite.

**An empty response scored as a clean review.** Astra returned exit 0 with no body on some
arms. Those were counted as reviews that looked and found nothing: no findings, no false
positives, perfect precision, indistinguishable from a genuinely clean fixture. It first
reported the skill making floor detection *worse* — 1/2 without, 0/2 with. Empty output is
now an error, and since an unchanged prompt was observed returning nothing on one attempt
and a full review on the next, it is retried twice before being recorded as failed. Eight
retries fired in the corrected run and no arm failed.

**A check that could not pass its own calibration.** `fabricates_input` asked whether a
review described a document it was never given. It was withdrawn after three wordings and
after adding the materials list to the classifier state: it still answers "fabrication"
whenever a review describes a document's contents, and the decisive calibration pair — the
same review judged against different materials — returns the same answer to both.

**One reader looking like two.** An expired credential meant the reading pass ran on a
single model and said nothing about it, producing exactly the lone opinion that two readers
exist to prevent.

## What the unlabeled column is for

GLM produced seven findings outside every labelled span. Several look real and are worth
adjudicating rather than dismissing:

- `O-001` on `SyncStatus` — sync-complete meaning lives only in the Lottie
- `T-026` and `T-004` on `RatingControl` — one tap fires five simultaneous springs, and the
  stars double as the rating readout
- `T-020` on `CheckoutSummary` — the badge appearing reflows three siblings instantly
- `T-010` and `T-025` on `ReaderScreen` — the panel exit uses the same spatial property as
  its entrance, and there is no drag-to-dismiss

GLM also reported one finding under `M-001`, a rule id that does not exist in
`STANDARDS.md`.

## Known limits of this measurement

- **One arm family.** `claude-code` and `kimi-code` cannot run inside the sandbox because
  pioneer does not copy the `extensions/` directory into the sandboxed Pi home, so providers
  implemented by an extension never register
  ([pioneer#81](https://github.com/rock3r/pioneer/issues/81)). Every arm above is therefore
  OpenAI or Z.AI; Claude can read transcripts but cannot review code.
- **One run per model.** No repeats, so nothing here has an error bar. `--runs` exists and
  was not used.
- **Eight rules of thirty-two.** One exemplar per eval class, as `TAXONOMY.md` intends. The
  harness is now proven against all seven shapes; the remaining rules are not yet tested.
- **One skill of three.** `animate-compose` and `improve-android-motion` have no evals.
