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
# Overridable so the plumbing can be exercised against a local stub without spending
# anything or depending on the network.
ENDPOINT = os.environ.get("TYPESAFE_ENDPOINT", "https://api.typesafe.ai/v1/systemone")
MODEL = os.environ.get("TYPESAFE_MODEL", "jev-latest")

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


def build_state(provided: list[str], transcript: str) -> str:
    """The review, prefixed by what the reviewer was actually handed.

    Without this, questions of the form "did it describe something it was not given"
    are unanswerable: the classifier sees only the review, so accurately quoting a
    staged file and inventing one whole cloth look identical. That is not a
    hypothetical — `fabricates_input` failed three reviews that were quoting a
    MOTION.md which had in fact been staged for them.

    Calibration states carry the same preamble, so the classifier is calibrated on the
    shape of input it will actually be asked about.
    """
    listed = "\n".join(f"- {f}" for f in provided) if provided else "- (nothing)"
    return (f"MATERIALS THE REVIEWER WAS GIVEN:\n{listed}\n\n"
            f"THE REVIEW:\n{transcript}")


KEY_FILE = Path(os.environ.get("TYPESAFE_API_KEY_FILE",
                               Path.home() / ".config/typesafe/key"))


HOW_TO_SUPPLY_A_KEY = """\
  No vault path is baked into this repo; you say where yours lives. A key *spec* goes in
  TYPESAFE_API_KEY_SPEC, or in a file (default ~/.config/typesafe/key, override with
  TYPESAFE_API_KEY_FILE), and takes one of three forms:

    op://Vault/Item/field      read with the 1Password CLI, at the moment it is needed
    !<any shell command>       run it; its first line of output is the key
    <the key itself>           a literal, for when you have nowhere better

  The first two keep the secret out of the filesystem entirely. Some examples:

    echo 'op://Private/TypeSafe/test api key'          > ~/.config/typesafe/key
    echo '!ssh coso op read "op://Private/Jev/cred"'   > ~/.config/typesafe/key
    echo '!pass show typesafe/jev'                     > ~/.config/typesafe/key

  The second is the one to use when the key only exists on another machine: the eval runs
  here, the vault stays there, and nothing is copied between them.

  TYPESAFE_API_KEY still works for a literal key in the environment. There is deliberately
  no --api-key flag: an argument is visible in the process table and in shell history."""


def load_key() -> str:
    """Resolve a key spec, which may name a vault or a command rather than hold a secret.

    Nothing here is specific to one person's vault layout: whoever runs the evals says
    where their key comes from, and for a remote vault the secret is never copied to the
    machine doing the running.
    """
    literal = os.environ.get("TYPESAFE_API_KEY", "").strip()
    if literal:
        return literal

    spec = os.environ.get("TYPESAFE_API_KEY_SPEC", "").strip()
    if not spec and KEY_FILE.exists():
        spec = KEY_FILE.read_text().strip()

    if not spec:
        print(f"error: no API key.\n{HOW_TO_SUPPLY_A_KEY}", file=sys.stderr)
        return ""

    if spec.startswith("op://"):
        if not shutil.which("op"):
            print("error: the key spec is a 1Password reference but `op` is not "
                  "installed. Install it, or use a `!` command that fetches the key "
                  "some other way.", file=sys.stderr)
            return ""
        cmd, shell = ["op", "read", spec], False
    elif spec.startswith("!"):
        cmd, shell = spec[1:].strip(), True
    else:
        return spec  # a literal key

    proc = subprocess.run(cmd, shell=shell, capture_output=True, text=True)
    if proc.returncode != 0:
        # Deliberately not echoing stdout: on failure it may still contain a partial secret.
        printable = cmd if isinstance(cmd, str) else " ".join(cmd)
        print(f"error: key command failed ({printable}):\n  "
              f"{proc.stderr.strip()[:300]}", file=sys.stderr)
        return ""

    key = proc.stdout.strip().splitlines()[0].strip() if proc.stdout.strip() else ""
    if not key:
        print("error: the key command succeeded but printed nothing", file=sys.stderr)
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


def ask_averaged(state: str, questions: dict, api_key: str, samples: int = 3) -> dict:
    """Ask the same questions several times and average the distributions.

    Jev is not deterministic. Measured here on one unchanged calibration state, the same
    question came back at 0.67 on one call and above 0.70 on the next — enough to flip a
    verdict across a threshold, and enough to make the calibration gate itself flap between
    runs. A single sample near a boundary is a coin toss dressed as a number.

    Averaging the probabilities is the right operation rather than voting on the verdicts,
    because the probability is the quantity being thresholded. It is affordable because all
    questions for one state travel in a single request and each round trip is fast.
    """
    if samples <= 1:
        return ask(state, questions, api_key)["answers"]

    runs = [ask(state, questions, api_key)["answers"] for _ in range(samples)]
    merged: dict = {}
    for name in questions:
        answers = [r[name] for r in runs]
        kind = answers[0]["type"]
        out: dict = {"type": kind}

        if kind == "noul":
            out["noul"] = sum(a["noul"] for a in answers) / len(answers)
        else:
            keys = {k for a in answers for k in (a.get("probabilities") or {})}
            if keys:
                out["probabilities"] = {
                    k: sum((a.get("probabilities") or {}).get(k, 0.0) for a in answers)
                    / len(answers)
                    for k in keys
                }
            if kind == "choice":
                # The winner of the averaged distribution, not a vote of per-run winners.
                out["choice"] = (max(out["probabilities"], key=out["probabilities"].get)
                                 if keys else answers[0]["choice"])
            else:
                out["score"] = sum(a["score"] for a in answers) / len(answers)
                if "legend" in answers[0]:
                    out["legend"] = answers[0]["legend"]
        out["confidence"] = sum(a.get("confidence", 0.0) for a in answers) / len(answers)
        merged[name] = out
    return merged


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

    # For choice and score the question being asked is "is the answer in the acceptable
    # set", so threshold on the mass that set holds — not on `confidence`, which measures
    # spread across ALL options and is therefore lower the more options there are.
    #
    # This is not hypothetical. Given a review that plainly asks a question, Jev returned
    # asks 0.6, scopes 0.4, asserts 0.0, silent 0.0 — every bit of mass on the two
    # acceptable answers, none on either wrong one — with confidence 0.47. It was certain
    # the answer was acceptable and merely undecided which label fitted best, and the old
    # logic recorded that as an abstention. The failure was worst exactly where several
    # answers are deliberately acceptable, which is the subtlest class of question here.
    if check["type"] in ("choice", "score"):
        probs = answer.get("probabilities") or {}

        if check["type"] == "choice":
            want = check["expect"]
            want = want if isinstance(want, list) else [want]
            got, picked = answer["choice"], repr(answer["choice"])
            acceptable = set(want)
        else:
            lo, hi = check["expect"]
            got = answer["score"]
            picked = f"score {got}"
            acceptable = {k for k in probs if lo <= float(k) <= hi}

        if not probs:  # no distribution to reason about; fall back to the point answer
            conf = answer.get("confidence", 0.0)
            in_set = got in acceptable if check["type"] == "choice" else (
                check["expect"][0] <= got <= check["expect"][1])
            if conf < floor:
                return "abstain", conf, f"{picked} at only {conf:.2f}, no distribution"
            return ("pass" if in_set else "fail"), conf, picked

        mass = sum(v for k, v in probs.items() if k in acceptable)
        if mass >= floor:
            return "pass", mass, f"{picked}; {mass:.2f} on acceptable answers"
        if mass <= 1 - floor:
            return "fail", mass, f"{picked}; only {mass:.2f} on acceptable answers"
        return "abstain", mass, f"{picked}; {mass:.2f} is inside the undecided band"

    raise SystemExit(f"unknown check type {check['type']!r}")


def calibrate(api_key: str, path: Path, floor: float = 0.9, samples: int = 3) -> bool:
    """Answer questions whose answers we already know, before trusting any we do not.

    Each item is a hand-written response with an unambiguous reading. If the classifier
    cannot separate these, nothing it says about a real transcript is worth printing.
    """
    if not path.exists():
        print(f"no calibration set at {path}", file=sys.stderr)
        return False

    items = json.loads(path.read_text())["items"]
    print(f"calibrating against {len(items)} known answers", file=sys.stderr)

    # Three outcomes, not two. Answering the opposite of a settled reading is a different
    # and far worse failure than declining to answer: the first means the classifier cannot
    # be trusted, the second only means it is cautious near this boundary. Counting them
    # together made the gate flap between runs on a single item sitting either side of a
    # threshold, while telling us nothing about whether it was ever actually wrong.
    wrong, unsure = 0, 0
    for item in items:
        check = item["check"]
        state = build_state(item.get("provided", []), item["state"])
        answers = ask_averaged(state, {check["id"]: to_question(check)},
                               api_key, samples)
        got, p, why = verdict(check, answers[check["id"]])
        want = item["expect_verdict"]

        if got == want:
            label = "ok    "
        elif got == "abstain":
            label = "unsure"
            unsure += 1
        else:
            label = "WRONG "
            wrong += 1
        print(f"  {label}  {item['name']:<44} {got:<7} ({why})", file=sys.stderr)

    if unsure:
        print(f"\n  {unsure} of {len(items)} undecided — cautious here, not incorrect",
              file=sys.stderr)

    accuracy = 1 - wrong / len(items)
    if wrong:
        # Not all-or-nothing. A constrained model can be confidently wrong about a valid
        # option, and one borderline item is a known, accepted cost rather than grounds to
        # throw away the rest. Below the floor, though, the numbers are noise.
        print(f"\n  calibration accuracy {accuracy:.0%} ({wrong} of {len(items)} wrong)",
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


def universal_checks(skill: str) -> list[dict]:
    """Checks every transcript answers, whatever case it belongs to.

    Kept apart from a case's own checks because they are a different question. A case
    check asks whether this review found the thing we planted. These ask whether it is a
    sensible piece of work at all — and are phrased without reference to any rule id or to
    the existence of a skill, so the classifier cannot tell which arm it is reading and a
    good answer does not depend on sharing our vocabulary.
    """
    f = ROOT / "skills" / skill / "evals" / "judge-checks.json"
    return json.loads(f.read_text())["universal"] if f.exists() else []


def specs_by_case(skill: str) -> dict[tuple[str, int], dict]:
    """(battery, case id) -> case, so the report can be matched back to its checks."""
    out = {}
    for p in sorted((ROOT / "skills" / skill / "evals").glob("evals*.json")):
        spec = json.loads(p.read_text())
        for case in spec["evals"]:
            out[(spec.get("battery", p.stem), case["id"])] = case
    return out


def judge(report: list[dict], skill: str, api_key: str,
          budget_report: list | None = None, samples: int = 3) -> list[dict]:
    specs = specs_by_case(skill)
    universal = universal_checks(skill)
    budget_report = budget_report if budget_report is not None else []
    results = []

    for battery in report:
        bname = battery["battery"]
        for case in battery["cases"]:
            spec = specs.get((bname, case["case"]))
            checks = universal + (spec or {}).get("checks", [])
            if not checks:
                continue

            for arm, paths in case.get("transcripts", {}).items():
                for path in paths:
                    f = ROOT / path
                    if not f.exists():
                        print(f"  missing transcript {path}", file=sys.stderr)
                        continue
                    provided = [Path(x).name for x in (spec or {}).get("files", [])]
                    state = build_state(provided, normalise(f.read_text()))
                    # Tracked because a locally-hosted classifier has a far smaller
                    # budget than the hosted one, and the ones worth considering
                    # truncate the END of an overlong state — which is exactly where
                    # the findings block sits.
                    budget_report.append((len(state) // 4, path))
                    answers = ask_averaged(
                        state, {c["id"]: to_question(c) for c in checks}, api_key,
                        samples
                    )
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
    ap.add_argument("--samples", type=int, default=3,
                    help="calls per question, averaged. The classifier is not "
                         "deterministic and a single sample near a threshold is a "
                         "coin toss")
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
    if not calibrate(api_key, calibration, args.calibration_floor, args.samples):
        return 1
    if args.calibrate_only:
        return 0

    if not args.report:
        print("error: --report is required unless --calibrate-only", file=sys.stderr)
        return 1

    sizes: list[tuple[int, str]] = []
    results = judge(json.loads(Path(args.report).read_text()), args.skill, api_key,
                    sizes, args.samples)
    if sizes:
        biggest, where = max(sizes)
        print(f'\nlargest state classified: ~{biggest} tokens ({Path(where).name})',
              file=sys.stderr)
        if biggest > 700:
            print('  note: beyond the state budget of every currently released local\n'
                  '  decision model, which truncate the END of an overlong state — the\n'
                  '  findings block. A hosted model with a large context is fine; a\n'
                  '  local one would need the transcript split per check.',
                  file=sys.stderr)
    if args.out:
        Path(args.out).write_text(json.dumps(results, indent=2))
        print(f"judge results written to {args.out}", file=sys.stderr)
    summarize(results)
    return 0


if __name__ == "__main__":
    sys.exit(main())
