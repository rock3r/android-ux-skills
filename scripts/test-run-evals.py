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
check("charges a must-not-flag hit as a false positive", g["floor"]["false_positive"] == 1, g)

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
check("precision case penalises a finding on a declared-clean span",
      ev.grade(under, [], [{"path": "Nav.kt", "lines": [20, 40]}])["flagged_correct_code"] == 1)

print("baseline arm — rule ids not required")

# The contract tells an arm with no standards to invent an identifier. Grading baseline on
# our private ids measured whether it guessed our vocabulary, not whether it found the
# defect, and made the headline delta meaningless.
invented = ev.parse_findings("FINDINGS\nNav.kt:27-31 NAV-DEFAULT taste minor 700ms\n")
want = [{"path": "Nav.kt", "lines": [27, 31], "rule": "T-001", "class": "taste"}]
check("baseline credits the right defect under an invented id",
      ev.grade(invented, want, [], match_rule_ids=False)["taste"]["hit"] == 1)
check("with-skill still requires the real id",
      ev.grade(invented, want, [], match_rule_ids=True)["taste"]["hit"] == 0)
check("baseline still needs the right location",
      ev.grade(ev.parse_findings("FINDINGS\nNav.kt:200-210 X taste minor x\n"),
               want, [], match_rule_ids=False)["taste"]["hit"] == 0)
check("baseline still needs the right class",
      ev.grade(ev.parse_findings("FINDINGS\nNav.kt:27-31 X floor minor x\n"),
               want, [], match_rule_ids=False)["taste"]["hit"] == 0)

print("obligation is scored")

# An earlier version computed floor and taste only, so the one absence-class case produced
# identical numbers whether it passed or failed.
ob = [{"path": "S.kt", "lines": [19, 36], "rule": "O-002", "class": "obligation"}]
hit = ev.grade(ev.parse_findings("FINDINGS\nS.kt:19-36 O-002 obligation major x\n"), ob, [])
miss = ev.grade([], ob, [])
check("obligation hit is counted", hit["obligation"]["hit"] == 1, hit["obligation"])
check("obligation miss is counted", miss["obligation"]["missed"] == 1, miss["obligation"])
check("hit and miss are distinguishable", hit["obligation"] != miss["obligation"])

print("one finding, one disposition")

wide = ev.parse_findings("FINDINGS\nC.kt:25-105 T-026 taste minor whole screen\n")
g = ev.grade(wide, [{"path": "C.kt", "lines": [25, 34], "rule": "T-026", "class": "taste"}],
             [{"path": "C.kt", "lines": [35, 48]}])
check("a wide finding is not both a hit and a false positive",
      g["taste"]["hit"] == 1 and g["taste"]["false_positive"] == 0, g["taste"])

dupes = ev.parse_findings("FINDINGS\nA.kt:1-5 T-001 taste minor x\nA.kt:1-5 T-001 taste minor x\n")
g = ev.grade(dupes, [{"path": "A.kt", "lines": [1, 5], "rule": "T-001", "class": "taste"}], [])
check("duplicates collapse to one finding",
      g["taste"]["hit"] == 1 and g["taste"]["false_positive"] == 0, g["taste"])
check("duplicates are counted", g["duplicates"] == 1)

# Our labels are not a census of every defect in a fixture. Punishing a real finding we
# failed to anticipate would train the skill to stay quiet.
outside = ev.parse_findings("FINDINGS\nA.kt:200-210 F-008 floor major animated padding\n")
g = ev.grade(outside, [], [])
check("an unlabeled finding is not a false positive", g["floor"]["false_positive"] == 0, g["floor"])
check("an unlabeled finding is surfaced for adjudication", len(g["unlabeled"]) == 1, g["unlabeled"])

check("a finding on a must-not-flag span is still a false positive",
      ev.grade(outside, [], [{"path": "A.kt", "lines": [195, 215]}])["floor"]["false_positive"] == 1)

print("class mismatch")

g = ev.grade(ev.parse_findings("FINDINGS\nA.kt:1-10 T-026 obligation minor x\n"),
             [{"path": "A.kt", "lines": [1, 10], "rule": "T-026", "class": "taste"}], [])
check("a misclassed finding still counts as detection", g["taste"]["hit"] == 1)
check("but the class error is reported", g["wrong_class"] != [], g["wrong_class"])


print()
if failures:
    print(f"{len(failures)} failed: {', '.join(failures)}")
    sys.exit(1)
print("grader behaves as specified")
