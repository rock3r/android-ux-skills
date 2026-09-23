# Android UX Skills

> [!CAUTION]
> **This is not an officially supported Google product, and has no affiliation with Google,
> Android or Material Design.** It is an independent, unofficial project. Where it cites
> Google's documentation or the AOSP source it says so and links to it; everything else is
> our own opinion and should be read that way.

> [!WARNING]
> **Work in progress. Nothing here is ready to install or rely on.**
>
> The 32 rules of revision 02 in [`STANDARDS.md`](STANDARDS.md) have been fact-checked
> against primary sources, reviewed by three separate models, and had one engineering
> review by a human. The two added since, T-027 and T-028, have not been through those
> reviews.
> They have **not** had a designer's review of the taste claims, which is the review that
> matters most for rules about how things should feel. The skills, the eval harness and the
> corpus design are scaffolding around a rule set that is still moving. Names, rule ids and
> file layout will change.

Agent skills for **Android motion and design-engineering craft** — the judgment calls that
decide whether an interface feels considered or merely functional.

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

It holds **decisions, not inventory** — anything a grep can answer is derived on demand
and never persisted, because counts and path lists rot fastest while still looking
authoritative.

### It has two audiences, and they own different halves

A motion language is a design artefact. It has to be approvable and maintainable by
whoever owns design, and most designers do not read Kotlin — so a file that is a list of
`MaterialTheme.motionScheme.defaultSpatialSpec()` is unmaintainable by the person whose
decisions it records. But specs must also bind to token *symbols* rather than literal
values, or the numbers acquire a second home and drift out of sync with the code.

Both hold, because each entry carries an **intent** and a **binding**:

```markdown
### Sheets and surfaces that expand

- **Intent** — settles without bounce. Confident, not playful.   ← design owns this
- **Binding** — `AppMotion.surfaceExpand`                        ← engineering owns this
```

Design owns the intent line and can change it without reading code. Engineering owns the
binding and keeps it resolving to something real. A review that disagrees with the intent
is a design conversation; a binding that no longer resolves is a defect. Neither side
needs to edit the other's half, and the file stays legible to both.

Every entry carries its provenance:

| Tag | Meaning | How a skill treats it |
|---|---|---|
| `DECIDED` | A human ratified it | Conform silently |
| `OBSERVED` | Dominant in the codebase, never ratified | Conform, but surface it in the PR description |
| `OPEN` | No convention, or contradictory evidence | Stop and ask — do not pick |

Without that distinction a skill canonizes accidents: `tween(300)` across thirty files is
not a decision, it is a copy-paste with a quorum.

It also declares what the product's design system is and what should happen where that
system is silent. Most design systems specify colour, type and spacing and say nothing
about motion, so gaps are the normal case rather than a defect — and resolution happens
per decision, not per codebase. A heavily customised M3 app follows its own customisations
where it made them and M3 Expressive everywhere it did not; a wholly custom system follows
itself where it speaks and M3 Expressive where it does not. Teams that would rather be
asked than defaulted say so here, and that is the end of it.

When a skill resolves a decision from the fallback rather than the product's own standard,
it says so. A strong brand voice can find an Android default foreign even where its
written system is silent, and that only gets corrected if the fallback is visible.

When a codebase has no coherent motion language at all, the generating skill says so and
declines to write the file. Establishing one is a design decision with human ownership,
not something an agent commits quietly.

## Evals

Skills are evaluated with [Pioneer](https://github.com/rock3r/pioneer), which runs every
case in two arms — `baseline` without the skill and `with-skill` with it. A skill that
does not beat baseline is decoration, and this is the measurement that says so.

Two things the eval corpus is built to avoid:

- **Self-confirmation.** A finding the skill proposed cannot count toward its own recall,
  so every label records how it was discovered. Rejected findings are kept as well, since
  they are the precision denominator.
- **Leakage.** Staged fixture filenames are visible to the agent under test, so no path
  may describe what it contains. Variants live in separate batteries with identical
  filenames.

## Review structure

The review skill forms its motion judgment **before** it sees any mechanical findings, and
the two are produced in isolation from each other rather than in sequence in one context.

The reason is that gradeable findings drive out ungradeable ones. A reviewer who has
already been handed a list of concrete rule hits writes a tidy report about those hits,
and the expensive judgment — whether the motion is right at all — quietly does not happen.

This structure is taken from [Impeccable](https://github.com/pbakaus/impeccable)'s
`/impeccable critique` (Paul Bakaus, Apache-2.0), which splits an unanchored design review
from deterministic detector evidence, runs them as isolated subagents, and withholds the
detector output from synthesis until the review has returned. Where isolation is
unavailable it degrades to instructed ordering and says so in the report. We adopt the
structure; the rules, guidance and taste are our own, and Impeccable's detectors are
CSS-shaped with no Android analogue.

## Acknowledgements

- [Emil Kowalski](https://github.com/emilkowalski/skills) (MIT) — the archetypes this
  collection is built on, and the source of much of its taste.
- [Impeccable](https://github.com/pbakaus/impeccable) by Paul Bakaus (Apache-2.0) — the
  anti-anchoring review structure described above.
- Ivan Morgillo ([hamen](https://github.com/hamen)) — for the idea of an Android design
  skill collection, and for `material-3-skill`, which owns Material's specs so this
  repository does not have to.

## Licence

Apache-2.0.
