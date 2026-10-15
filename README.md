# Android UX Skills

Agent skills for building, reviewing, and auditing Jetpack Compose motion on Android.

> [!CAUTION]
> **This is not an official Google product.** This repository has no affiliation with
> Google, Android, or Material Design. Where a rule cites Google documentation or the
> Android Open Source Project (AOSP) source code, it links to that source. Everything
> else is our own engineering and design opinion.

> [!NOTE]
> **Version 1.0.0.** [`STANDARDS.md`](STANDARDS.md) contains 34 rules (`10` floor, `2`
> obligation, `22` taste). The 32 rules from revision 02 were fact-checked against primary
> sources, reviewed by three models, and reviewed by an engineer. `T-027` and `T-028` were
> added later and have not gone through those reviews yet. None of the taste rules have
> been reviewed by a designer yet, so read them as one engineering team's defaults rather
> than Material Design guidance.

## Skills

All three skills share the 34 rules defined in [`STANDARDS.md`](STANDARDS.md):

| Skill | Purpose |
|---|---|
| [`animate-compose`](skills/animate-compose/SKILL.md) | Decide whether an element should animate, pick the transition pattern and token spec, and implement the motion with reduced-motion fallback. |
| [`review-android-motion`](skills/review-android-motion/SKILL.md) | Review Compose motion changes against [`STANDARDS.md`](STANDARDS.md) and the project's `MOTION.md`, separating design judgment from rule checks. |
| [`improve-android-motion`](skills/improve-android-motion/SKILL.md) | Audit motion across a repository, draft a `MOTION.md` file from existing code conventions, and write self-contained fix plans. |

## Install

This repository is both a portable [Agent Plugins](https://agent-plugins.org/) package
(root `plugin.json` plus `skills/`) and a Claude Code plugin (`.claude-plugin/`).

- **Claude Code** — add this repository as a marketplace and install the plugin:

  ```text
  /plugin marketplace add rock3r/android-ux-skills
  /plugin install android-ux-skills@android-ux-skills
  ```

  To test a local checkout directly, run `claude --plugin-dir .`.

- **ChatGPT and Codex** — both read `.claude-plugin/marketplace.json` and the root
  `plugin.json`:

  ```text
  codex plugin marketplace add rock3r/android-ux-skills
  ```

- **Any Agent Plugins client** — `plugin.json` targets schema `1.0.0` and exposes the
  skills under `skills/` in the [Agent Skills](https://agentskills.io/specification)
  format.

## Scope and adjacent skills

Android's official documentation covers the Compose animation APIs in detail, but leaves
most product decisions open. It does not say when to skip an animation, which durations or
springs fit common interactions, or how to choose between the Material 3 Expressive and
Standard motion schemes beyond general descriptions. These skills provide concrete rules,
thresholds, and defaults for those choices.

They stay focused on motion decisions and route other Android and Compose questions to
specialized skill sets:

| Topic | Skill repository |
|---|---|
| Which Compose animation API to call, recomposition, stability, phases | [`chrisbanes/skills`](https://github.com/chrisbanes/skills) |
| XML-to-Compose migration, edge-to-edge, Navigation 3, Wear, TV | [`android/skills`](https://github.com/android/skills) |
| Material 3 tokens, components, and theming conformance | [`hamen/material-3-skill`](https://github.com/hamen/material-3-skill) |
| Kotlin, Gradle, and Android Gradle Plugin (AGP) upgrades | [`Kotlin/kotlin-agent-skills`](https://github.com/Kotlin/kotlin-agent-skills) |

## Recording project conventions in `MOTION.md`

The skills coordinate around a per-repository `MOTION.md` file that records a project's
motion language. `improve-android-motion` drafts this file from the codebase, and
`animate-compose` and `review-android-motion` read it before applying default rules.

`MOTION.md` stores decisions rather than a file inventory. It never lists call-site counts
or file paths, because those numbers go stale as soon as code changes and can be found
with search tools whenever needed.

### Shared ownership between design and engineering

A motion spec needs to stay readable to designers who do not read Kotlin, while still
pointing engineers and agents to real code tokens instead of raw numbers that drift out of
sync. Each entry in `MOTION.md` splits those two jobs into an **Intent** line and a
**Binding** line:

```markdown
### Sheets and surfaces that expand

- **Intent** — settles without bounce. Confident, not playful.   ← design owns this
- **Binding** — `AppMotion.surfaceExpand`                        ← engineering owns this
```

Designers can update the **Intent** description without touching Kotlin. Engineers own the
**Binding** symbol and keep it pointing to a valid token in code. If a review disagrees
with the intent, that is a design discussion; if a binding no longer resolves in code,
that is a bug.

### Provenance tags

Every entry in `MOTION.md` carries a tag showing how the rule was established:

| Tag | Meaning | How skills use it |
|---|---|---|
| `DECIDED` | Approved by a human on the team | Follow it directly; flag contradictions as major findings. |
| `OBSERVED` | Used consistently in the codebase, but not yet ratified | Follow it for consistency, and mention it in the pull request description. |
| `OPEN` | No clear pattern in the codebase, or conflicting patterns | Stop and ask the user before choosing. |

Only a human can mark an entry `DECIDED`. Without these tags, an agent auditing a codebase
would treat a `tween(300)` copied across thirty files as an intentional design rule.

### Design system fallbacks

Most design systems define color, typography, and spacing, but leave motion unspecified
for many interactions. `MOTION.md` states which design system the app uses and what to do
when that system is silent.

The skills resolve each motion question separately rather than treating customization as
all-or-nothing. An app that customizes three transitions uses its own tokens for those
three and falls back to Material 3 Expressive (or another configured fallback) for the
rest. Whenever a skill uses a fallback instead of a `DECIDED` project rule, it states
which fallback it used so the team can override it if needed. Teams that prefer the agent
to ask every time can state that in `MOTION.md`.

If an audited codebase has no consistent motion patterns at all, `improve-android-motion`
reports what it found and does not write a `MOTION.md` file. Choosing a motion language
for a product requires a human decision.

## Isolated review passes

When reviewing code, `review-android-motion` forms its high-level motion judgment before
it sees any rule-by-rule findings. The skill runs two separate passes in isolated
contexts:

1. **Assessment A (motion judgment):** Reads only the code and `MOTION.md` to judge
   whether the motion should exist, whether it matches the product's language, and whether
   the screen holds together as a single coherent transition.
2. **Assessment B (rule checks):** Scans the code against `STANDARDS.md` and reports line
   numbers and rule IDs.

When a single prompt asks a model to do both at once, easy mechanical rule hits dominate
the review and the broader question—whether the animation belongs on the screen at all—gets
skipped.

This two-pass design comes from `/impeccable critique` in
[Impeccable](https://github.com/pbakaus/impeccable) (Paul Bakaus, Apache-2.0), which runs
an unanchored critique and deterministic checks in separate subagents before combining
them. When subagent isolation is unavailable, `review-android-motion` runs Assessment A
first in the main context and marks the report as single-context.

## Evals

The review skill is tested with [Pioneer](https://github.com/rock3r/pioneer), which runs
each test case twice: once without the skill (`baseline`) and once with it (`with-skill`).
Comparing the two runs measures whether the skill improves detection and reduces false
positives over the base model alone.

The evaluation suite in [`skills/review-android-motion/evals/`](skills/review-android-motion/evals/README.md)
is designed around two safeguards:

- **No self-confirmation:** Findings first proposed by the skill itself do not count
  toward recall until verified. Rejected findings stay in the test files as negative spans
  so false positives reduce precision.
- **No filename hints:** The agent under test can see staged filenames, so fixture paths
  use neutral names (`c10/AppNavigation.kt`, `m1/MOTION.md`) that do not reveal the planted
  bug. Context variants run in separate batteries using the same filenames.

## Acknowledgements

- [Emil Kowalski](https://github.com/emilkowalski/skills) (MIT) — the skill structure and
  several motion principles adapted here for Android.
- [Impeccable](https://github.com/pbakaus/impeccable) by Paul Bakaus (Apache-2.0) — the
  isolated two-pass review architecture.
- Ivan Morgillo ([hamen](https://github.com/hamen)) — the idea for an Android design skill
  collection, and [`material-3-skill`](https://github.com/hamen/material-3-skill), which
  covers Material 3 component and token specs.

## Licence

Apache-2.0.
