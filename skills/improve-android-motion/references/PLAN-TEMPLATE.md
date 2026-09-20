# Plan template

One plan per accepted issue. Written to be executed by an agent with **no memory of the
session that produced it**, possibly a much cheaper one.

That constraint drives every rule below. The executor was not in the room. It cannot
resolve "the spec discussed above", cannot infer which of three similar call sites you
meant, and cannot tell an intentional outlier from a defect. Everything it needs is in the
file or the plan is broken.

---

````markdown
# <short title>

Commit: <sha the plan was written against>
Rule: <rule id from STANDARDS.md>
Class: floor | taste
Scope: <exact files and symbols. Nothing outside this list may change.>

## What is wrong now

<Quote the current code verbatim. Do not paraphrase it, and do not "clean it up" in the
quote — the executor matches on this.>

```kotlin
<current code, exactly as it appears>
```

## What it should be

```kotlin
<target code, exactly. Every value resolved. No placeholders.>
```

## Why

<One paragraph. The rule id and the claim behind it. Enough that an executor who finds the
situation slightly different can tell whether the reasoning still applies.>

## Conventions to match

<Imports, token object name, file placement, naming, test style. Everything the executor
would otherwise guess at. Name a neighbouring file to copy the style from.>

## Steps

1. <ordered, mechanical>
2. ...

## Out of scope

<Explicitly. Adjacent defects the executor will notice and must not fix, with a reason.
This section is what stops a plan turning into an unreviewable diff.>

## Verification

Mechanical:
- <commands that must pass — build, lint, tests>

By eye, on hardware:
- <what must be checked on a release build on a physical device, and what "right" looks
  like. State plainly that this cannot be verified by reading code.>

## Stop conditions

Stop and report instead of proceeding if:
- the quoted code does not match what is in the file;
- the change would touch anything outside Scope;
- the fix requires a decision not settled here.
````

---

## Rules for the author

**Exact values, always.** Never "use the spring from the sheet animation". Name the
symbol. If the binding does not exist yet, creating it is step 1 of the plan.

**Quote verbatim.** The executor matches on the quoted block. A tidied quote means a
failed match, and a failed match is the best outcome — a *near* match is worse, because it
edits the wrong thing confidently.

**One issue per plan.** Two issues in one plan produce a diff nobody can review and a
rollback nobody can perform.

**Out of scope is not optional.** A competent executor will notice adjacent problems.
Without this section it will fix them, and the review will be about the unrequested
changes.

**Say what only a human can check.** Most motion cannot be verified by reading. A plan
that implies otherwise will be marked complete when it is not. `F-009` applies to the
executor too: a timing judgment from a debug build is not evidence.
