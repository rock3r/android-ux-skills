# Plan template

Write one plan file per accepted issue. Each plan must be self-contained so an agent with
**no memory of the audit session** can execute it directly.

Because the executing agent has not seen the audit conversation, never write references
like "use the spec discussed above", leave ambiguity about which of several call sites to
edit, or rely on the executor to guess which adjacent issues to leave alone.

---

````markdown
# <short title>

Commit: <sha the plan was written against>
Rule: <rule id from STANDARDS.md>
Class: floor | obligation | taste
Scope: <exact files and symbols. Do not modify anything outside this list.>

## What is wrong now

<Quote the current code verbatim so the executor can locate the exact block.>

```kotlin
<current code, exactly as it appears in the file>
```

## What it should be

```kotlin
<target code with every token symbol and import resolved; no placeholders>
```

## Why

<One short paragraph citing the rule ID from STANDARDS.md and the reason for the change,
so an executor encountering minor surrounding edits can check whether the fix still
applies.>

## Conventions to match

<Imports, motion token object name, file placement, naming, and test conventions. Name an
existing file in the repository to follow as an example.>

## Steps

1. <ordered, concrete implementation steps>
2. ...

## Out of scope

<List any nearby issues in the same file that the executor will see and must leave
untouched, along with the reason.>

## Verification

Mechanical:
- <build, lint, and test commands that must pass>

On hardware (release build):
- <what a human must verify on a physical device running a release build, and what the
  expected motion looks like (`F-009`)>

## Stop conditions

Stop and report back instead of applying changes if:
- the quoted `What is wrong now` block no longer matches the file;
- the change would require editing files or symbols outside `Scope`;
- completing the fix requires a design decision not settled in this plan.
````

---

## Authoring checklist

- **Resolve every token symbol:** Never write "use the spring from the sheet animation".
  Write the exact symbol name. If the token does not exist yet, adding it to the token
  object is Step 1 of the plan.
- **Quote source code verbatim:** The executing agent matches against the quoted code
  block. Cleaning up formatting or eliding lines in the quote causes the match to fail or
  hit the wrong call site.
- **Keep one issue per plan:** Bundling unrelated motion changes into one plan makes review
  and rollback harder.
- **Always fill in `Out of scope`:** Without an explicit exclusion list, a capable agent
  will fix neighboring issues it notices in the same file and expand the diff beyond what
  was approved.
- **State what requires device verification:** Code checks cannot verify animation feel.
  Always note what must be checked on a physical device running a release build (`F-009`).
