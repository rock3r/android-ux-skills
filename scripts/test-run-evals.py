#!/usr/bin/env python3
"""Tests for the eval grader.

These live next to the code rather than inside the CI workflow. An earlier version was
inlined in check.yml, and when the finding format gained a severity column the workflow
kept asserting the old shape — it failed in CI while every local check passed. A test that
cannot be run locally is a test that drifts.

    ./scripts/test-run-evals.py
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location("ev", Path(__file__).parent / "run-evals.py")
ev = importlib.util.module_from_spec(spec)
sys.modules["ev"] = ev
spec.loader.exec_module(ev)

failures: list[str] = []


def check(name: str, cond: bool, detail: object = "") -> None:
    if cond:
        print(f"  ok    {name}")
    else:
        print(f"  FAIL  {name}  {detail}")
        failures.append(name)


print("parsing")

# Models wrap output in prose and bullet it. The parser takes the contract block and
# ignores the rest, because insisting on a bare response measures obedience, not judgment.
parsed = ev.parse_findings(
    "Here is what I found after reading the file.\n"
    "FINDINGS\n"
    "app/Nav.kt:27-31 T-001 taste minor left on the framework default\n"
    "- app/Feed.kt:88-96 F-001 floor major animated offset read in composition\n"
    "this line is commentary, not a finding\n"
)
check("extracts findings from surrounding prose", len(parsed) == 2, parsed)
check("captures severity", [f.severity for f in parsed] == ["minor", "major"], parsed)
check("captures class", [f.cls for f in parsed] == ["taste", "floor"], parsed)
check("normalises rule id case",
      ev.parse_findings("FINDINGS\na.kt:1-2 t-001 taste minor x\n")[0].rule == "T-001")
check("ignores a line missing severity",
      ev.parse_findings("FINDINGS\na.kt:1-2 T-001 taste no severity here\n") == [])
check("handles an empty report", ev.parse_findings("FINDINGS\nNONE\n") == [])

print("grading")

expected = [
    {"path": "Nav.kt", "lines": [27, 31], "rule": "T-001", "class": "taste", "severity": "minor"},
    {"path": "Other.kt", "lines": [10, 20], "rule": "T-009", "class": "taste", "severity": "major"},
]
negatives = [{"path": "Feed.kt", "lines": [80, 100]}]

g = ev.grade(parsed, expected, negatives)
check("credits the matched finding", g["taste"]["hit"] == 1, g)
check("counts the missed one", g["taste"]["missed"] == 1, g)
check("computes recall", g["taste"]["recall"] == 0.5, g)
check("counts a finding on a must-not-flag span", g["flagged_correct_code"] == 1, g)
check("charges it as a false positive", g["floor"]["false_positive"] == 1, g)

# The right rule in the wrong place is not a hit. Matching on rule id alone would credit a
# model that named a plausible rule and guessed at where it applied.
wrong_place = ev.parse_findings("FINDINGS\nNav.kt:200-210 T-001 taste minor x\n")
check("rejects a correct rule at the wrong line",
      ev.grade(wrong_place, expected, [])["taste"]["hit"] == 0)

# Severity is graded apart from detection: under-rating a real finding is a different
# failure from missing it, and is the one the MOTION.md batteries exist to expose.
under = ev.parse_findings("FINDINGS\nNav.kt:27-31 T-001 taste minor x\n")
g_major = ev.grade(under, [dict(expected[0], severity="major")], [])
check("detects under-rated severity", g_major["taste"]["hit"] == 1, g_major)
check("reports the severity mismatch",
      g_major["wrong_severity"] == [{"rule": "T-001", "expected": "major", "reported": "minor"}],
      g_major["wrong_severity"])
check("stays silent when severity agrees",
      ev.grade(under, [expected[0]], [])["wrong_severity"] == [])

# A precision case declares no expected findings at all; anything reported is spurious.
check("precision case penalises any finding",
      ev.grade(under, [], [{"path": "Nav.kt", "lines": [20, 40]}])["flagged_correct_code"] == 1)

print()
if failures:
    print(f"{len(failures)} failed: {', '.join(failures)}")
    sys.exit(1)
print("grader behaves as specified")
