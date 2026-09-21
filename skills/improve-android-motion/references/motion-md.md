# The MOTION.md contract

`MOTION.md` records what a product decided about motion. It is a design artefact that
happens to live in a repository, and it is read by every motion skill before anything
else.

## Two audiences

It must be approvable and maintainable by whoever owns design, and most designers do not
read Kotlin. It must also bind to token symbols rather than literal values, or the numbers
acquire a second home and drift.

Both hold because every entry has two halves with different owners:

```markdown
### Sheets and surfaces that expand

- **Intent** — settles without bounce. Confident, not playful.
- **Binding** — `AppMotion.surfaceExpand`
- **Tag** — `OBSERVED`
```

A list rather than aligned columns, deliberately: column alignment needs runs of spaces,
which common Markdown linters flag, and this file lives in someone else's repository under
their rules. It should not make their build noisy.

**Intent** — design owns. Plain language. What it should feel like, and what it should
not. No API names, no numbers. Changing this is a design conversation.

**Binding** — engineering owns. A token symbol: `AppMotion.surfaceExpand`,
`MaterialTheme.motionScheme.defaultSpatialSpec()`. Never a literal. A binding that no
longer resolves is a defect, not a discussion.

## Provenance tags

| Tag | Meaning | Written by | How skills treat it |
|---|---|---|---|
| `DECIDED` | A human ratified it | **A human only** | Conform silently. Deviation is a finding. |
| `OBSERVED` | Dominant, unratified | The audit skill | Conform, but report as inconsistency — never as wrong |
| `OPEN` | No convention, or contradictory | The audit skill | Stop and ask. Do not pick. |

An agent may never write `DECIDED`. If it could, merging the pull request that introduced
the file would ratify every entry by accident, and the distinction would be worthless from
day one. Propose promotions in the PR body; write `OBSERVED` in the file.

`OBSERVED` requires at least **80% share of its intent class and at least 5 call sites**.
Below either threshold it is `OPEN`. A pattern repeated thirty times because it was
copy-pasted is an accident with a quorum, not a decision.

## Required shape

```markdown
# Motion language — <product>

## Design system
<What governs this product's motion: M3 Expressive, M3 with named customisations, or a
custom system. One or two sentences.>

## Fallback
<What happens where this file and the design system are both silent. Default is pragmatic
M3 Expressive. A team that would rather be asked says so here, and that is sufficient.>

## Specs

### <intent name>

- **Intent** — <plain language>
- **Binding** — `<token symbol>`
- **Tag** — `DECIDED` | `OBSERVED` | `OPEN`

## Exceptions
- <symbol> — <why it differs>

## Frequency map

- **Never animate** — <surfaces>
- **Standard** — <surfaces>
- **Delight allowed** — <surfaces>

## Gestures and haptics
<Conventions for velocity handoff, drag thresholds, where haptics fire.>

## Reduced motion
<What happens when animations are switched off. Whether an in-app toggle exists.>

## Not in this codebase
- <patterns this product has decided against, and why>
```

## Rules for the file itself

**Decisions, not inventory.** Never call-site counts, never path lists. Anything a grep
can answer is derived on demand. Those are the parts that rot first while still looking
authoritative.

**Exceptions name a symbol.** An exception is a standing approval, and approvals outlive
the code that earned them. `<symbol> — <why>` lets a reviewer check the symbol still
exists and void the exception when it does not. An exception whose symbol is gone is void,
not inherited.

**80 lines, hard cap.** Longer than that and nobody maintains it, which is worse than not
having one — a stale file is trusted exactly as much as a current one.

**Never committed by an agent.** Present it and stop. A motion language is a product
decision with human ownership.

## When a codebase has none

Do not write the file. Report the evidence, say plainly that no coherent language exists,
offer a starting point if wanted, and hand the decision to a human. Fabricating a motion
language and then enforcing it is the worst available outcome: it manufactures a standard
nobody agreed to and everybody must then live with.
