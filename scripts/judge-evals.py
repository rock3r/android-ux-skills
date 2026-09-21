#!/usr/bin/env python3
"""Qualitative pass over saved eval transcripts, using a classifier rather than an LLM.

`run-evals.py` set-matches findings against hand-labelled spans. That catches whether the
right line was named, and nothing else. Most of what each case actually claims to test
lives in its `expectations` array — "names `offset { }` as the fix", "reports it against
the screen rather than a child", "does not cite MOTION.md content" — and the grader has
never read a word of it.

Why a classifier and not a judge model:

* An LLM judging two prose reviews rewards length, confidence, vocabulary and finding
  count, and the with-skill arm wins on all four before correctness enters. That is the
  reason `run-evals.py` refuses to score anything with a model.
* Jev cannot generate text. It takes state plus typed questions and returns a value from a
  set declared here, in advance. It has no way to prefer the longer review, because it has
  no way to say anything that is not in the schema.
* Every answer carries a calibrated probability, so a question this thing is unsure about
  becomes an abstention routed to a human, instead of a confident guess folded into a
  number.

None of that makes it correct. Schema-safety is not accuracy: a constrained model can be
confidently wrong about a valid option. So the calibration set runs first, every time, and
its output is withheld entirely if the classifier cannot answer questions whose answers we
already know.

    ./scripts/judge-evals.py --report report.json
    ./scripts/judge-evals.py --calibrate-only

Requires TYPESAFE_API_KEY. Results are reported beside the detection numbers and are never
folded into them.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENDPOINT = "https://api.typesafe.ai/v1/systemone"
MODEL = "jev-latest"

# A finding line carries the arm's vocabulary in its rule column: with-skill writes T-009,
# baseline writes whatever it invented. Left alone, that tells the classifier which arm it
# is reading. Normalising it does not make the arms indistinguishable — prose style still
# differs — but it removes the one token that identifies them outright.
RULE_COLUMN = re.compile(
    r"^(?P<loc>[^\s:]+:\d+(?:-\d+)?)\s+(?P<rule>\S+)\s+(?P<rest>floor|obligation|taste)\b",
    re.IGNORECASE | re.MULTILINE,
)


def normalise(transcript: str) -> str:
    return RULE_COLUMN.sub(lambda m: f"{m['loc']} RULE {m['rest']}", transcript)


KEY_FILE = Path(os.environ.get("TYPESAFE_API_KEY_FILE",
                               Path.home() / ".config/typesafe/key"))


def load_key() -> str:
    """The key, from the environment or a file — never from an argument.

    Not a CLI flag, deliberately: a flag puts the secret in the process table, in shell
    history, and in the terminal scrollback of whoever ran it. The file may instead hold a
    1Password secret reference (`op://vault/item/field`), in which case the secret itself
    never lands on this disk at all.
    """
    key = os.environ.get("TYPESAFE_API_KEY", "").strip()
    if not key and KEY_FILE.exists():
        key = KEY_FILE.read_text().strip()

    if key.startswith("op://"):
        if not shutil.which("op"):
            print(f"error: {KEY_FILE} holds a 1Password reference but `op` is not "
                  f"installed", file=sys.stderr)
            return ""
        proc = subprocess.run(["op", "read", key], capture_output=True, text=True)
        if proc.returncode != 0:
            print(f"error: op could not read that reference: "
                  f"{proc.stderr.strip()[:200]}", file=sys.stderr)
            return ""
        key = proc.stdout.strip()

    if not key:
        print(
            "error: no API key.\n"
            "  Run this yourself, in your own terminal — not through an agent, whose\n"
            "  command output is recorded:\n\n"
            "    mkdir -p ~/.config/typesafe && chmod 700 ~/.config/typesafe\n"
            "    (umask 077; read -rs -p 'Jev key: ' k && printf '%s' \"$k\" \\\n"
            "        > ~/.config/typesafe/key && unset k && echo)\n\n"
            "  read -rs does not echo and does not reach shell history.\n"
            "  With the 1Password CLI installed you can instead store only a reference:\n\n"
            "    printf '%s' 'op://Private/TypeSafe AI/credential' \\\n"
            "        > ~/.config/typesafe/key\n",
            file=sys.stderr,
        )
    return key


def ask(state: str, questions: dict, api_key: str, timeout: int = 60) -> dict:
    """One request, all questions. They are evaluated in parallel server-side."""
    body = json.dumps({"state": state, "model": MODEL, "questions": questions}).encode()
    req = urllib.request.Request(
        ENDPOINT,
        data=body,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:400]
        raise SystemExit(f"Jev returned {e.code}: {detail}") from e
    except urllib.error.URLError as e:
        raise SystemExit(f"could not reach {ENDPOINT}: {e.reason}") from e


def to_question(check: dict) -> dict:
    """The check as Jev's API wants it. `expect` and `min_confidence` stay on our side."""
    q = {"type": check["type"], "instructions": check["instructions"]}
    if "criteria" in check:
        q["criteria"] = check["criteria"]
    return q


def verdict(check: dict, answer: dict) -> tuple[str, float, str]:
    """(pass | fail | abstain, probability, why).

    Abstention is a first-class outcome, not a rounding error. A question the classifier is
    genuinely unsure about is one a human should read, and turning that into a pass or a
    fail on a coin-flip is how an unreliable number gets into a report.
    """
    floor = check.get("min_confidence", 0.7)

    if check["type"] == "noul":
        p = answer["noul"]
        want = check["expect"]
        if p >= floor:
            got = True
        elif p <= 1 - floor:
            got = False
        else:
            return "abstain", p, f"{p:.2f} is inside the undecided band around {floor}"
        return ("pass" if got is want else "fail"), p, f"read as {got}, wanted {want}"

    if check["type"] == "choice":
        choice, conf = answer["choice"], answer.get("confidence", 0.0)
        want = check["expect"]
        want = want if isinstance(want, list) else [want]
        if conf < floor:
            return "abstain", conf, f"chose {choice!r} at only {conf:.2f}"
        return ("pass" if choice in want else "fail"), conf, f"chose {choice!r}"

    if check["type"] == "score":
        score, conf = answer["score"], answer.get("confidence", 0.0)
        lo, hi = check["expect"]
        if conf < floor:
            return "abstain", conf, f"scored {score} at only {conf:.2f}"
        return ("pass" if lo <= score <= hi else "fail"), conf, f"scored {score}"

    raise SystemExit(f"unknown check type {check['type']!r}")


def calibrate(api_key: str, path: Path, floor: float = 0.9) -> bool:
    """Answer questions whose answers we already know, before trusting any we do not.

    Each item is a hand-written response with an unambiguous reading. If the classifier
    cannot separate these, nothing it says about a real transcript is worth printing.
    """
    if not path.exists():
        print(f"no calibration set at {path}", file=sys.stderr)
        return False

    items = json.loads(path.read_text())["items"]
    print(f"calibrating against {len(items)} known answers", file=sys.stderr)

    failures = 0
    for item in items:
        check = item["check"]
        answers = ask(item["state"], {check["id"]: to_question(check)}, api_key)
        got, p, why = verdict(check, answers["answers"][check["id"]])
        want = item["expect_verdict"]
        ok = got == want
        failures += not ok
        print(f"  {'ok  ' if ok else 'FAIL'}  {item['name']:<44} {got:<7} ({why})",
              file=sys.stderr)

    accuracy = 1 - failures / len(items)
    if failures:
        # Not all-or-nothing. A constrained model can be confidently wrong about a valid
        # option, and one borderline item is a known, accepted cost rather than grounds to
        # throw away the rest. Below the floor, though, the numbers are noise.
        print(f"\n  calibration accuracy {accuracy:.0%} ({failures} of {len(items)} wrong)",
              file=sys.stderr)
        if accuracy < floor:
            print(f"  below the {floor:.0%} floor — judge output withheld. A classifier "
                  f"that cannot answer settled questions cannot be trusted with open "
                  f"ones.\n", file=sys.stderr)
            return False
        print(f"  above the {floor:.0%} floor — continuing, but treat the checks above "
              f"as unreliable.\n", file=sys.stderr)
        return True
    print("calibration passed\n", file=sys.stderr)
    return True


def specs_by_case(skill: str) -> dict[tuple[str, int], dict]:
    """(battery, case id) -> case, so the report can be matched back to its checks."""
    out = {}
    for p in sorted((ROOT / "skills" / skill / "evals").glob("evals*.json")):
        spec = json.loads(p.read_text())
        for case in spec["evals"]:
            out[(spec.get("battery", p.stem), case["id"])] = case
    return out


def judge(report: list[dict], skill: str, api_key: str) -> list[dict]:
    specs = specs_by_case(skill)
    results = []

    for battery in report:
        bname = battery["battery"]
        for case in battery["cases"]:
            spec = specs.get((bname, case["case"]))
            checks = (spec or {}).get("checks", [])
            if not checks:
                continue

            for arm, paths in case.get("transcripts", {}).items():
                for path in paths:
                    f = ROOT / path
                    if not f.exists():
                        print(f"  missing transcript {path}", file=sys.stderr)
                        continue
                    state = normalise(f.read_text())
                    answers = ask(
                        state, {c["id"]: to_question(c) for c in checks}, api_key
                    )["answers"]
                    for c in checks:
                        got, p, why = verdict(c, answers[c["id"]])
                        results.append({
                            "battery": bname, "case": case["case"], "arm": arm,
                            "check": c["id"], "verdict": got,
                            "probability": round(p, 3), "why": why,
                            "transcript": path,
                        })
    return results


def summarize(results: list[dict]) -> None:
    if not results:
        print("no checks defined on any case in this report", file=sys.stderr)
        return

    print("=" * 78, file=sys.stderr)
    for battery in sorted({r["battery"] for r in results}):
        print(f"\n{battery}", file=sys.stderr)
        for arm in ("baseline", "with-skill"):
            rows = [r for r in results if r["battery"] == battery and r["arm"] == arm]
            if not rows:
                continue
            tally = {v: sum(r["verdict"] == v for r in rows) for v in
                     ("pass", "fail", "abstain")}
            print(f"  {arm:>10}: {tally['pass']} pass, {tally['fail']} fail, "
                  f"{tally['abstain']} abstain", file=sys.stderr)
            for r in rows:
                if r["verdict"] != "pass":
                    print(f"      {r['verdict']:<7} case {r['case']} {r['check']} "
                          f"— {r['why']}", file=sys.stderr)

    abstained = [r for r in results if r["verdict"] == "abstain"]
    if abstained:
        print(f"\n{len(abstained)} abstention(s) need a human. Open the transcript:",
              file=sys.stderr)
        for r in abstained[:5]:
            print(f"  {r['transcript']}  ({r['check']})", file=sys.stderr)

    print("\nThese are reported beside the detection numbers, never added to them.",
          file=sys.stderr)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", help="JSON written by run-evals.py --out")
    ap.add_argument("--skill", default="review-android-motion")
    ap.add_argument("--calibration", default=None)
    ap.add_argument("--calibrate-only", action="store_true")
    ap.add_argument("--calibration-floor", type=float, default=0.9,
                    help="withhold judge output below this calibration accuracy")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    api_key = load_key()
    if not api_key:
        return 1

    calibration = Path(args.calibration) if args.calibration else (
        ROOT / "skills" / args.skill / "evals" / "judge-calibration.json"
    )
    if not calibrate(api_key, calibration, args.calibration_floor):
        return 1
    if args.calibrate_only:
        return 0

    if not args.report:
        print("error: --report is required unless --calibrate-only", file=sys.stderr)
        return 1

    results = judge(json.loads(Path(args.report).read_text()), args.skill, api_key)
    if args.out:
        Path(args.out).write_text(json.dumps(results, indent=2))
        print(f"judge results written to {args.out}", file=sys.stderr)
    summarize(results)
    return 0


if __name__ == "__main__":
    sys.exit(main())
