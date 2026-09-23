#!/usr/bin/env python3
"""Tests for the classifier verdict logic.

Pure functions only — no API key, no network, safe in CI. The calibration set tests the
classifier; this tests our reading of what it says back, which is where the one real bug
so far actually lived.

    ./scripts/test-judge-evals.py
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location("je", Path(__file__).parent / "judge-evals.py")
je = importlib.util.module_from_spec(spec)
sys.modules["je"] = je
spec.loader.exec_module(je)

failures: list[str] = []


def check(name: str, cond: bool, detail: object = "") -> None:
    if cond:
        print(f"  ok    {name}")
    else:
        print(f"  FAIL  {name}  {detail}")
        failures.append(name)


print("noul verdicts")

noul = {"id": "n", "type": "noul", "instructions": "...", "expect": True,
        "min_confidence": 0.7}
check("a confident true passes",
      je.verdict(noul, {"type": "noul", "noul": 0.95})[0] == "pass")
check("a confident false fails",
      je.verdict(noul, {"type": "noul", "noul": 0.02})[0] == "fail")
check("the undecided band abstains",
      je.verdict(noul, {"type": "noul", "noul": 0.5})[0] == "abstain")
check("expect false inverts it",
      je.verdict(dict(noul, expect=False), {"type": "noul", "noul": 0.02})[0] == "pass")

print("choice verdicts are about the acceptable SET, not the winner")

# The bug this file exists for. Asked how a review treats an unknowable fact, Jev answered
# asks 0.6 / scopes 0.4 / asserts 0.0 / silent 0.0 — every bit of mass on the two answers
# we accept, none on either we reject — and reported confidence 0.47, because confidence
# measures spread across all four options. Thresholding on it called a certain, correct
# answer an abstention, and did so worst exactly where several answers are deliberately
# acceptable.
choice = {"id": "c", "type": "choice", "instructions": "...",
          "criteria": {"asks": "", "scopes": "", "asserts": "", "silent": ""},
          "expect": ["asks", "scopes"], "min_confidence": 0.6}
split = {"type": "choice", "choice": "asks", "confidence": 0.47,
         "probabilities": {"asks": 0.6, "scopes": 0.4, "asserts": 0.0, "silent": 0.0}}
got, mass, why = je.verdict(choice, split)
check("mass split across two acceptable answers passes", got == "pass", (got, why))
check("and it is scored on the summed mass, not confidence", mass == 1.0, mass)

wrong = {"type": "choice", "choice": "asserts", "confidence": 0.9,
         "probabilities": {"asks": 0.05, "scopes": 0.05, "asserts": 0.9, "silent": 0.0}}
check("mass on an unacceptable answer fails", je.verdict(choice, wrong)[0] == "fail")

torn = {"type": "choice", "choice": "asks", "confidence": 0.3,
        "probabilities": {"asks": 0.45, "scopes": 0.0, "asserts": 0.55, "silent": 0.0}}
check("genuinely torn between acceptable and not abstains",
      je.verdict(choice, torn)[0] == "abstain", je.verdict(choice, torn))

# Without a distribution there is nothing to sum, so the point answer is all we have.
check("falls back to the point answer when no distribution is returned",
      je.verdict(choice, {"type": "choice", "choice": "asks", "confidence": 0.9})[0]
      == "pass")
check("and abstains on a low-confidence point answer",
      je.verdict(choice, {"type": "choice", "choice": "asks", "confidence": 0.1})[0]
      == "abstain")

print("score verdicts")

score = {"id": "s", "type": "score", "instructions": "...",
         "criteria": ["none", "minor", "major"], "expect": [1, 2], "min_confidence": 0.7}
check("mass inside the accepted range passes",
      je.verdict(score, {"type": "score", "score": 1.8, "confidence": 0.5,
                         "probabilities": {"0": 0.05, "1": 0.15, "2": 0.8}})[0] == "pass")
check("mass outside it fails",
      je.verdict(score, {"type": "score", "score": 0.1, "confidence": 0.9,
                         "probabilities": {"0": 0.95, "1": 0.05, "2": 0.0}})[0] == "fail")

print("transcript normalisation")

# with-skill writes T-009, baseline writes whatever it invented. That column is the one
# token that identifies the arm outright.
norm = je.normalise("Nav.kt:27-35 T-001 taste minor left on the default\n"
                    "Feed.kt:88-96 NAV-THING floor major something else\n")
check("rule ids are replaced", "T-001" not in norm and "NAV-THING" not in norm, norm)
check("locations survive", "Nav.kt:27-35" in norm and "Feed.kt:88-96" in norm, norm)
check("class and severity survive", "taste minor" in norm and "floor major" in norm, norm)
check("prose is untouched",
      "left on the default" in norm and "something else" in norm, norm)

print("every wired check is calibrated in both directions")

evals = Path(__file__).parent.parent / "skills/review-android-motion/evals"
cal = json.loads((evals / "judge-calibration.json").read_text())["items"]
coverage: dict[str, set[str]] = {}
for c in cal:
    coverage.setdefault(c["check"]["id"], set()).add(c["expect_verdict"])

wired = {c["id"] for c in
         json.loads((evals / "judge-checks.json").read_text())["universal"]}
for f in sorted(evals.glob("evals*.json")):
    for case in json.loads(f.read_text())["evals"]:
        wired.update(c["id"] for c in case.get("checks", []))

missing = sorted(i for i in wired if coverage.get(i) != {"pass", "fail"})
check("no check is wired without a pass AND a fail calibration state",
      not missing, missing)

print("checks that depend on what was staged")

# conformance_claim asks whether a review claims to know conventions it was not given.
# Asked of a review that WAS given a MOTION.md, "asserts" is the correct answer and the
# check would fail it — so it must not be asked there, and must still be asked in the
# phantom battery, whose prompt claims a MOTION.md that was never staged.
import importlib.util as _u
_s = _u.spec_from_file_location("jv", Path(__file__).parent / "judge-evals.py")
jv = _u.module_from_spec(_s); _s.loader.exec_module(jv)
asked = {}
def fake_ask(state, questions, key, samples):
    asked.setdefault(state.split("\n")[0], set()).update(questions)
    return {q: {"value": None, "probability": 0.0} for q in questions}
jv.ask_averaged = fake_ask
jv.verdict = lambda c, a: ("abstain", 0.0, "")
import tempfile
with tempfile.TemporaryDirectory() as tmp:
    t = Path(tmp) / "t.md"; t.write_text("FINDINGS\nNONE")
    report = [{"battery": b, "cases": [{"case": 10, "transcripts": {"with-skill": [str(t)]}}]}
              for b in ("established-language", "phantom-language")]
    results = jv.judge(report, "review-android-motion", "k")
by = {(r["battery"], r["check"]) for r in results}
check("not asked where a MOTION.md was staged",
      ("established-language", "conformance_claim") not in by, sorted(by))
check("still asked where one was only claimed",
      ("phantom-language", "conformance_claim") in by, sorted(by))

print()
if failures:
    print(f"{len(failures)} failed: {', '.join(failures)}")
    sys.exit(1)
print("verdict logic behaves as specified")
