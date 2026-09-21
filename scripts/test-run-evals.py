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


def P(text: str) -> list:
    """Findings only. parse_findings also returns a count of malformed lines."""
    return ev.parse_findings(text)[0]


def check(name: str, cond: bool, detail: object = "") -> None:
    if cond:
        print(f"  ok    {name}")
    else:
        print(f"  FAIL  {name}  {detail}")
        failures.append(name)


print("parsing")

# Models wrap output in prose and bullet it. The parser takes the contract block and
# ignores the rest, because insisting on a bare response measures obedience, not judgment.
parsed = P(
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
      P("FINDINGS\na.kt:1-2 t-001 taste minor x\n")[0].rule == "T-001")
check("ignores a line missing severity",
      P("FINDINGS\na.kt:1-2 T-001 taste no severity here\n") == [])
check("handles an empty report", P("FINDINGS\nNONE\n") == [])

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
wrong_place = P("FINDINGS\nNav.kt:200-210 T-001 taste minor x\n")
check("rejects a correct rule at the wrong line",
      ev.grade(wrong_place, expected, [])["taste"]["hit"] == 0)

# Severity is graded apart from detection: under-rating a real finding is a different
# failure from missing it, and is the one the MOTION.md batteries exist to expose.
under = P("FINDINGS\nNav.kt:27-31 T-001 taste minor x\n")
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
invented = P("FINDINGS\nNav.kt:27-31 NAV-DEFAULT taste minor 700ms\n")
want = [{"path": "Nav.kt", "lines": [27, 31], "rule": "T-001", "class": "taste"}]
check("baseline credits the right defect under an invented id",
      ev.grade(invented, want, [], match_rule_ids=False)["taste"]["hit"] == 1)
check("with-skill still requires the real id",
      ev.grade(invented, want, [], match_rule_ids=True)["taste"]["hit"] == 0)
check("baseline still needs the right location",
      ev.grade(P("FINDINGS\nNav.kt:200-210 X taste minor x\n"),
               want, [], match_rule_ids=False)["taste"]["hit"] == 0)
check("baseline still needs the right class",
      ev.grade(P("FINDINGS\nNav.kt:27-31 X floor minor x\n"),
               want, [], match_rule_ids=False)["taste"]["hit"] == 0)

print("obligation is scored")

# An earlier version computed floor and taste only, so the one absence-class case produced
# identical numbers whether it passed or failed.
ob = [{"path": "S.kt", "lines": [19, 36], "rule": "O-002", "class": "obligation"}]
hit = ev.grade(P("FINDINGS\nS.kt:19-36 O-002 obligation major x\n"), ob, [])
miss = ev.grade([], ob, [])
check("obligation hit is counted", hit["obligation"]["hit"] == 1, hit["obligation"])
check("obligation miss is counted", miss["obligation"]["missed"] == 1, miss["obligation"])
check("hit and miss are distinguishable", hit["obligation"] != miss["obligation"])

print("one finding, one disposition")

wide = P("FINDINGS\nC.kt:25-105 T-026 taste minor whole screen\n")
g = ev.grade(wide, [{"path": "C.kt", "lines": [25, 34], "rule": "T-026", "class": "taste"}],
             [{"path": "C.kt", "lines": [35, 48]}])
check("a wide finding is not both a hit and a false positive",
      g["taste"]["hit"] == 1 and g["taste"]["false_positive"] == 0, g["taste"])

dupes = P("FINDINGS\nA.kt:1-5 T-001 taste minor x\nA.kt:1-5 T-001 taste minor x\n")
g = ev.grade(dupes, [{"path": "A.kt", "lines": [1, 5], "rule": "T-001", "class": "taste"}], [])
check("duplicates collapse to one finding",
      g["taste"]["hit"] == 1 and g["taste"]["false_positive"] == 0, g["taste"])
check("duplicates are counted", g["duplicates"] == 1)

# Our labels are not a census of every defect in a fixture. Punishing a real finding we
# failed to anticipate would train the skill to stay quiet.
outside = P("FINDINGS\nA.kt:200-210 F-008 floor major animated padding\n")
g = ev.grade(outside, [], [])
check("an unlabeled finding is not a false positive", g["floor"]["false_positive"] == 0, g["floor"])
check("an unlabeled finding is surfaced for adjudication", len(g["unlabeled"]) == 1, g["unlabeled"])

check("a finding on a must-not-flag span is still a false positive",
      ev.grade(outside, [], [{"path": "A.kt", "lines": [195, 215]}])["floor"]["false_positive"] == 1)

print("class mismatch")

g = ev.grade(P("FINDINGS\nA.kt:1-10 T-026 obligation minor x\n"),
             [{"path": "A.kt", "lines": [1, 10], "rule": "T-026", "class": "taste"}], [])
check("a misclassed finding still counts as detection", g["taste"]["hit"] == 1)
check("but the class error is reported", g["wrong_class"] != [], g["wrong_class"])

print("severity is scored, not merely annotated")

# Severity is the payload of three of four batteries. It was collected and printed but
# entered no number, so a skill reporting "minor" everywhere was numerically identical to
# one whose severity moved with the staged MOTION.md — the thing battery B exists to test.
want_major = [dict(expected[0], severity="major")]
right = ev.grade(P("FINDINGS\nNav.kt:27-31 T-001 taste major x\n"), want_major, [])
wrong = ev.grade(P("FINDINGS\nNav.kt:27-31 T-001 taste minor x\n"), want_major, [])
check("correct severity scores", right["severity_right"] == 1 and right["severity_wrong"] == 0,
      right)
check("wrong severity scores", wrong["severity_right"] == 0 and wrong["severity_wrong"] == 1,
      wrong)

print("fabrication")

# The phantom battery's whole purpose. Its defining behaviours lived in prose expectations
# the grader never read, so a skill that invented a motion language and cited its tokens
# scored a clean pass on the only battery built to catch exactly that.
forb = ["AppMotion", "DECIDED"]
clean = ev.grade([], [], [], forbidden=forb,
                 raw="No MOTION.md was provided, so I cannot check conformance.")
made_up = ev.grade([], [], [], forbidden=forb,
                   raw="This contradicts the DECIDED AppMotion.destinationEnter token.")
check("an honest arm fabricates nothing", clean["fabricated"] == [], clean["fabricated"])
check("citing absent conventions is caught",
      made_up["fabricated"] == ["AppMotion", "DECIDED"], made_up["fabricated"])
check("fabrication is case-insensitive",
      ev.grade([], [], [], forbidden=["AppMotion"], raw="the appmotion tokens")["fabricated"]
      == ["AppMotion"])
check("no forbidden list means no fabrication field noise",
      ev.grade([], [], [], raw="anything at all")["fabricated"] == [])

print("malformed output is visible")

# Silently dropping unparseable lines made a badly formatted review indistinguishable from
# a clean one: zero findings, zero false positives, perfect precision.
found, unparsed = ev.parse_findings(
    "FINDINGS\n"
    "Nav.kt:27-31 T-001 taste minor properly formed\n"
    "Nav.kt:40-44 — T-002 (wrong shape entirely)\n"
)
check("a well-formed line still parses", len(found) == 1, found)
check("a malformed line is counted, not discarded", unparsed == 1, unparsed)
check("prose without line numbers is not counted as malformed",
      ev.parse_findings("FINDINGS\nI think the motion here is fine overall.\n")[1] == 0)

# A model that says "findings" in its preamble would otherwise lose everything before the
# real block.
check("the last FINDINGS marker wins",
      len(P("My findings are below.\nFINDINGS\nA.kt:1-2 T-001 taste minor x\n")) == 1)

print("shotgun findings")

# One span covering the defect and every clean region around it counts once, so it cannot
# also be a false positive — which would make "something on this screen is wrong" the
# highest-scoring answer available.
g = ev.grade(P("FINDINGS\nC.kt:1-500 T-026 taste minor whole screen\n"),
             [{"path": "C.kt", "lines": [25, 34], "rule": "T-026", "class": "taste"}],
             [{"path": "C.kt", "lines": [36, 47]}, {"path": "C.kt", "lines": [50, 58]}])
check("a blanket finding is reported as such", len(g["blanketing"]) == 1, g["blanketing"])
check("and names how much clean code it covered",
      g["blanketing"][0]["covers_negatives"] == 2, g["blanketing"])

print("single-line findings")

# A one-line defect is naturally written "Nav.kt:27". Rejecting that measured
# transcription, not judgment.
one = P("FINDINGS\nNav.kt:27 T-001 taste minor single line\n")
check("a bare line number parses", len(one) == 1, one)
check("it becomes a one-line span", (one[0].start, one[0].end) == (27, 27), one)
check("and still matches an expected range that contains it",
      ev.grade(one, [{"path": "Nav.kt", "lines": [25, 31], "rule": "T-001",
                      "class": "taste"}], [])["taste"]["hit"] == 1)

# The skill's own report format is a markdown table. If that is all an arm emits, the
# contract block is missing and the run must not look like a clean review.
table = ev.parse_findings(
    "## Findings\n| Rule | Where | Class |\n| T-009 | Feed.kt:88-96 | taste |\n"
)
check("a table row yields no finding", table[0] == [], table[0])
check("but is counted as malformed rather than ignored", table[1] >= 1, table[1])

print("alternate anchors")

# The missing marker is a fact about the .json as much as about the composable that plays
# it. Both are honest places to report it; only one used to count.
marker = [{"path": "SyncStatus.kt", "lines": [16, 28], "rule": "O-002",
           "class": "obligation",
           "also_at": [{"path": "sync_complete.json", "lines": [1, 54]}]}]
check("the primary anchor still matches",
      ev.grade(P("FINDINGS\nSyncStatus.kt:16-28 O-002 obligation major x\n"),
               marker, [])["obligation"]["hit"] == 1)
check("the alternate anchor also matches",
      ev.grade(P("FINDINGS\nsync_complete.json:20-30 O-002 obligation major x\n"),
               marker, [])["obligation"]["hit"] == 1)
check("an unrelated file still misses",
      ev.grade(P("FINDINGS\nOther.kt:16-28 O-002 obligation major x\n"),
               marker, [])["obligation"]["missed"] == 1)
check("one finding cannot satisfy the same expect twice",
      ev.grade(P("FINDINGS\nSyncStatus.kt:16-28 O-002 obligation major x\n"),
               marker, [])["obligation"]["hit"] == 1)

print("averaging across runs")

# n=1 cannot separate a capability gap from sampling noise.
want = [{"path": "Nav.kt", "lines": [27, 31], "rule": "T-001", "class": "taste",
         "severity": "minor"}]
found_it = ev.grade(P("FINDINGS\nNav.kt:27-31 T-001 taste minor x\n"), want, [])
missed_it = ev.grade([], want, [])
avg = ev.mean_grades([found_it, missed_it, found_it, found_it])
check("a single run is passed through unchanged", ev.mean_grades([found_it]) is found_it)
check("hits are averaged", avg["taste"]["hit"] == 0.75, avg["taste"])
check("misses are averaged", avg["taste"]["missed"] == 0.25, avg["taste"])
check("severity is averaged", avg["severity_right"] == 0.75, avg["severity_right"])
check("diagnostic lists are kept whole, not averaged",
      isinstance(avg["unlabeled"], list), avg["unlabeled"])

# A rate that is undefined in every run stays undefined rather than becoming zero.
empty = ev.grade([], [], [])
check("an undefined rate does not become 0.0",
      ev.mean_grades([empty, empty])["taste"]["recall"] is None)

print()
if failures:
    print(f"{len(failures)} failed: {', '.join(failures)}")
    sys.exit(1)
print("grader behaves as specified")
