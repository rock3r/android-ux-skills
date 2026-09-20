# Android UX Skills

Agent skills for **Android motion and design-engineering craft** — the judgment calls that
decide whether an interface feels considered or merely functional.

> [!WARNING]
> Pre-alpha. Nothing here is ready to install. The rule set that everything else packages
> is not written yet.

## What this is for

Google's documentation supplies mechanism and withholds judgment. There is no guidance on
developer.android.com about when *not* to animate, no Compose-specific duration table, no
easing decision table, and no rule for choosing between the Expressive and Standard motion
schemes beyond "Expressive for most, Standard for utilitarian". The APIs are documented
exhaustively; the choices are not documented at all.

These skills encode the choices. Exact values, decision gates, and things never to ship —
not a restatement of the docs.

## What this is not for

The generic Jetpack Compose space is well served already, and these skills deliberately
route out of it rather than competing:

| Need | Use |
|---|---|
| Recomposition, stability, phase discipline, state and effects | [`chrisbanes/skills`](https://github.com/chrisbanes/skills) |
| XML→Compose migration, edge-to-edge, Navigation 3, Wear/TV | [`android/skills`](https://github.com/android/skills) |
| Material 3 tokens, components, theming conformance | [`hamen/material-3-skill`](https://github.com/hamen/material-3-skill) |
| Kotlin, Gradle and AGP migrations | [`Kotlin/kotlin-agent-skills`](https://github.com/Kotlin/kotlin-agent-skills) |

Every skill here states its non-scope and names where to go instead. A skill that answers
questions it has no special knowledge about is worse than one that declines.

## MOTION.md

The keystone is a per-repository `MOTION.md` capturing that codebase's motion language.
One skill generates it; the others read and conform to it.

It holds **decisions, not inventory** — anything a grep can answer is derived on demand and
never persisted, because counts and path lists rot fastest while still looking
authoritative. Specs reference token symbols rather than literal values, so the numbers keep
a single home in code.

Every entry carries its provenance:

| Tag | Meaning | How a skill treats it |
|---|---|---|
| `DECIDED` | A human ratified it | Conform silently |
| `OBSERVED` | Dominant in the codebase, never ratified | Conform, but surface it in the PR description |
| `OPEN` | No convention, or contradictory evidence | Stop and ask — do not pick |

Without that distinction a skill canonizes accidents: `tween(300)` across thirty files is
not a decision, it is a copy-paste with a quorum.

It also declares what the product's design system is and what should happen where that system
is silent. Most design systems specify colour, type and spacing and say nothing about motion,
so gaps are the normal case rather than a defect — and resolution happens per decision, not
per codebase. A heavily customised M3 app follows its own customisations where it made them
and M3 Expressive everywhere it did not; a wholly custom system follows itself where it
speaks and M3 Expressive where it does not. Teams that would rather be asked than defaulted
say so here, and that is the end of it.

When a skill resolves a decision from the fallback rather than the product's own standard,
it says so. A strong brand voice can find an Android default foreign even where its written
system is silent, and that only gets corrected if the fallback is visible.

When a codebase has no coherent motion language at all, the generating skill says so and
declines to write the file. Establishing one is a design decision with human ownership, not
something an agent commits quietly.

## Evals

Skills are evaluated with [Pioneer](https://github.com/rock3r/pioneer), which runs every
case in two arms — `baseline` without the skill and `with-skill` with it. A skill that does
not beat baseline is decoration, and this is the measurement that says so.

Two things the eval corpus is built to avoid:

- **Self-confirmation.** A finding the skill proposed cannot count toward its own recall, so
  every label records how it was discovered. Rejected findings are kept as well, since they
  are the precision denominator.
- **Leakage.** Staged fixture filenames are visible to the agent under test, so no path may
  describe what it contains. Variants live in separate batteries with identical filenames.

## Licence

Apache-2.0.
