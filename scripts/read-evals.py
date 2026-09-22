#!/usr/bin/env python3
"""Read the transcripts the classifier would not decide, and say what they mean.

Three passes now sit over an eval run, each doing only what it is suited to:

    run-evals.py     did it name the right lines          deterministic set-matching
    judge-evals.py   was the review sensible work         a classifier, typed answers
    read-evals.py    what does the unclear case mean      a language model, prose only

This is the third. It exists because the first two share a limit: neither can explain
itself. Span-matching says a finding missed and cannot say whether the review nearly had
it; the classifier says 0.62 and cannot say what it was looking at. Both failures land on a
human, and reading transcripts by hand is how an eval suite stops being run.

What it is NOT allowed to do is score anything. Everything here is prose for a person to
read, and nothing it produces feeds a number, because a model comparing prose reviews
rewards length, confidence and vocabulary — which is the whole reason `run-evals.py` refuses
to let a model near its grading.

It is told nothing about which arm produced a transcript, and rule ids are normalised out
before it sees them. Not because it would be tempted to flatter the skill — it scores
nothing — but because an explanation that starts from "this is the one with the skill"
is an explanation of our expectations rather than of the text.

    ./scripts/read-evals.py --report report.json --judge judge.json --out reading.md
    ./scripts/read-evals.py --report report.json --judge judge.json --full
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

_spec = importlib.util.spec_from_file_location("je", Path(__file__).parent / "judge-evals.py")
je = importlib.util.module_from_spec(_spec)
sys.modules["je"] = je
_spec.loader.exec_module(je)


ADJUDICATE = """\
You are settling one undecided question about a code review. A small classifier was asked \
a fixed question about the review below and could not answer it confidently, so it has been \
passed to you.

Do not score anything and do not produce a verdict table. Write prose.

The question put to the classifier:
  {instructions}
Answers that would be considered acceptable: {expect}
What it settled on: {why}

The review, in full, between the markers:
--- BEGIN REVIEW ---
{transcript}
--- END REVIEW ---

Answer three things, briefly and in this order:

1. Which way should this question go for this review, and what exact words in the review
   decide it? Quote them.
2. Why was this hard? Choose whichever of these is true, and do not assume it must be
   the question's fault:
     (a) the review is genuinely borderline and the question is fine as posed;
     (b) the question is badly posed, or quietly asks two things at once so no single
         answer fits — if so, say what it should have asked instead;
     (c) the question is fine but its list of acceptable answers is missing a case that
         this review legitimately falls into.
   A well-posed question meeting an ambiguous review is the common case. Say so when it is.
3. Anything else in this review a reader should know that the question did not ask about.

Be concise. No preamble."""

READ = """\
You are reading one code review and reporting on its quality as a piece of work. It was \
produced by an automated reviewer asked to review the motion and animation in some Android \
code.

Do not score anything and do not produce a table. Write prose, at most 200 words.

The review, between the markers:
--- BEGIN REVIEW ---
{transcript}
--- END REVIEW ---

Cover only what is worth a reader's attention:
- Is the reasoning sound, or is it right for the wrong reason? Reaching a correct conclusion
  from a wrong premise matters more than being wrong outright, because it will not repeat.
- Does anything important sit buried under something trivial?
- Would an engineer receiving this act on it, argue with it, or ignore it? Why?

If the review is simply fine, say so in one line rather than manufacturing criticism.
No preamble."""


def run_model(prompt: str, model: str, timeout: int = 300) -> str:
    if not shutil.which("pi"):
        raise SystemExit(
            "error: 'pi' is not on PATH.\n"
            "  If it is installed under nvm, this shell has not loaded it."
        )
    proc = subprocess.run(
        ["pi", "--model", model, "--no-session", "--print", prompt],
        capture_output=True, text=True, timeout=timeout,
    )
    if proc.returncode != 0:
        return f"_(the reading model failed: {proc.stderr.strip()[:200]})_"
    return proc.stdout.strip()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", required=True, help="JSON from run-evals.py")
    ap.add_argument("--judge", help="JSON from judge-evals.py --out")
    ap.add_argument("--model", default="claude-code/claude-sonnet-4-6")
    ap.add_argument("--full", action="store_true",
                    help="also read every transcript, not only the undecided ones")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    report = json.loads(Path(args.report).read_text())
    verdicts = json.loads(Path(args.judge).read_text()) if args.judge else []

    # Anything the classifier would not settle, plus anything it settled against us. Both
    # need a human; this drafts what that human would otherwise have to write.
    unsettled = [v for v in verdicts if v["verdict"] in ("abstain", "fail")]

    checks = {c["id"]: c for c in je.universal_checks("review-android-motion")}
    for p in sorted((ROOT / "skills/review-android-motion/evals").glob("evals*.json")):
        for case in json.loads(p.read_text())["evals"]:
            for c in case.get("checks", []):
                checks.setdefault(c["id"], c)

    out: list[str] = ["# Reading of an eval run", ""]
    if not unsettled and not args.full:
        out += ["The classifier settled every check. Nothing needed a second opinion.", ""]

    if unsettled:
        out += ["## Undecided checks", ""]
        print(f"reading {len(unsettled)} undecided check(s)", file=sys.stderr)
    for v in unsettled:
        chk = checks.get(v["check"], {})
        transcript = Path(v["transcript"])
        if not transcript.exists():
            continue
        body = run_model(ADJUDICATE.format(
            instructions=chk.get("instructions", v["check"]),
            expect=chk.get("expect", "?"),
            why=v["why"],
            transcript=je.normalise(transcript.read_text()),
        ), args.model)
        out += [f"### {battery_name(v)} · case {v['case']} · `{v['check']}`", "",
                f"Classifier: **{v['verdict']}** — {v['why']}", "", body, ""]

    if args.full:
        out += ["## Every review, read", ""]
        seen: set[str] = set()
        for battery in report:
            for case in battery["cases"]:
                for paths in case.get("transcripts", {}).values():
                    for path in paths:
                        if path in seen or not Path(path).exists():
                            continue
                        seen.add(path)
                        print(f"reading {Path(path).name}", file=sys.stderr)
                        body = run_model(
                            READ.format(transcript=je.normalise(Path(path).read_text())),
                            args.model)
                        out += [f"### {battery['battery']} · case {case['case']}", "",
                                body, ""]

    text = "\n".join(out)
    if args.out:
        Path(args.out).write_text(text)
        print(f"reading written to {args.out}", file=sys.stderr)
    else:
        print(text)
    return 0


def battery_name(v: dict) -> str:
    return v.get("battery", "?")


if __name__ == "__main__":
    sys.exit(main())
