# The `MOTION.md` contract

`MOTION.md` records a project's motion decisions at the repository root. Every skill in
this package reads it before applying default rules.

## Shared ownership between design and engineering

A project's motion spec must stay readable to designers who do not read Kotlin, while
still binding to real code tokens so numeric values live in one place. Each entry in
`MOTION.md` splits into two fields with separate owners:

```markdown
### Sheets and surfaces that expand

- **Intent** — settles without bounce. Confident, not playful.
- **Binding** — `AppMotion.surfaceExpand`
- **Tag** — `OBSERVED`
```

Entries use a bulleted list rather than whitespace-aligned columns so standard Markdown
linters in the host repository pass without warnings.

- **Intent (owned by design):** Written in plain language describing how the transition
  should feel and behave, without API names or raw numbers.
- **Binding (owned by engineering):** Names a token symbol in code (such as
  `AppMotion.surfaceExpand` or `MaterialTheme.motionScheme.defaultSpatialSpec()`), never a
  literal `tween(300)` or `spring(...)`. If the symbol stops resolving in code, that is a
  bug.

## Provenance tags

| Tag | Meaning | Written by | How skills treat it |
|---|---|---|---|
| `DECIDED` | Ratified by a human on the team | **A human only** | Follow directly; flag contradictions as major findings. |
| `OBSERVED` | Used consistently in code, not yet ratified | `improve-android-motion` | Follow for consistency, and note in the PR description. |
| `OPEN` | No consistent pattern, or conflicting usage | `improve-android-motion` | Stop and ask the user before choosing. |

An agent must never write `DECIDED`. If an agent generated `DECIDED` entries, merging the
initial pull request would ratify every existing code habit without human review. Write
`OBSERVED` in the file and suggest promotions in the pull request description.

An `OBSERVED` tag requires **at least an 80% share of its category and at least 5 call
sites**. Anything below either threshold must be marked `OPEN`.

## Template

```markdown
# Motion language — <product>

## Design system
<What governs this product's motion: Material 3 Expressive, Material 3 with named
customizations, or a custom design system. One or two sentences.>

## Fallback
<What happens where both this file and the design system are silent. Defaults to Material 3
Expressive. Teams that prefer to be asked every time can state that here.>

## Specs

### <intent name>

- **Intent** — <plain language>
- **Binding** — `<token symbol>`
- **Tag** — `DECIDED` | `OBSERVED` | `OPEN`

## Exceptions
- `<symbol>` — <why it differs, and any condition under which the exception expires>

## Frequency map

- **Never animate** — <surfaces>
- **Standard** — <surfaces>
- **Delight allowed** — <surfaces>

## Gestures and haptics
<Conventions for velocity handoff, drag thresholds, and haptic feedback.>

## Reduced motion
<How the app behaves when system animations are disabled, and whether an in-app toggle
exists.>

## Not in this codebase
- <patterns this product has explicitly ruled out, and why>
```

## Constraints

- **Decisions, not file inventories:** Never include call-site counts or lists of file
  paths. Those go stale as code changes and can be found with search tools on demand.
- **Symbol-scoped exceptions:** Every exception must name the composable or symbol it
  applies to (`<symbol> — <reason>`). If that symbol is deleted or the stated condition
  no longer holds, the exception expires automatically.
- **80-line maximum:** Keep `MOTION.md` to 80 lines or fewer so the team can read and
  maintain it easily.
- **Human commit only:** Present the draft to the user and let a human commit it.

## When a codebase has no consistent motion language

If an audited codebase has scattered literals and no consistent motion patterns, do not
write `MOTION.md`. Report the findings, show the breakdown of existing specs, and ask the
user how they want to establish a baseline before creating the file.
