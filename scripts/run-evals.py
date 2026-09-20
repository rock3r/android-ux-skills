#!/usr/bin/env python3
"""Controller for Pioneer skill evals.

Pioneer is an isolation primitive, not a grading framework: it prepares two arms per case
(`baseline` without the skill, `with-skill` with it), runs a command under sandbox, and
passes stdout through. It deliberately does not schedule cases, grade output, or aggregate.
This script is that missing half.

Design constraints, and why:

* **The grader is deterministic.** An LLM judging prose rewards length, confidence, rule
  vocabulary and finding count — with-skill wins on all four before correctness enters. So
  the skill emits structured findings and we set-match them. No model scores anything.

* **The output contract lives in the case prompt, not the skill.** Otherwise baseline is
  penalised for not knowing a format it was never told, and we measure formatting rather
  than judgment.

* **Floor and taste are reported separately, never averaged.** Floor findings are mechanical
  and a capable model finds many of them unaided; taste is the part that is supposed to
  justify the skill. Averaging lets a flat taste delta hide behind a strong floor delta,
  which is exactly how this collection would quietly become a linter.

* **False positives are weighted at least as heavily as misses.** A reviewer that flags
  correct code trains people to ignore it. Without this, "flag everything" wins.

Usage:
    ./scripts/run-evals.py --skill review-android-motion --model claude-code/claude-sonnet-4-6
    ./scripts/run-evals.py --skill review-android-motion --dry-run
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# The shape every arm is asked to produce, appended to each case prompt so both arms are
# answering the same question in the same form.
OUTPUT_CONTRACT = """

Report every finding as one line in exactly this form, and nothing else after the marker:

FINDINGS
<path>:<start>-<end> <rule-id> <floor|taste> <one line>

Use the rule ids from the standards if you have them. If you have no standards to draw on,
still use this shape and put your own short identifier in the rule-id column.
If you find nothing, write FINDINGS and then NONE."""

FINDING_RE = re.compile(
    r"^(?P<path>[^\s:]+):(?P<start>\d+)-(?P<end>\d+)\s+(?P<rule>\S+)\s+(?P<cls>floor|taste)\b",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class Finding:
    path: str
    start: int
    end: int
    rule: str
    cls: str

    def overlaps(self, other: "Finding") -> bool:
        return (
            Path(self.path).name == Path(other.path).name
            and self.start <= other.end
            and other.start <= self.end
        )


@dataclass
class ArmResult:
    arm: str
    findings: list[Finding] = field(default_factory=list)
    raw: str = ""
    error: str | None = None


def parse_findings(text: str) -> list[Finding]:
    """Parse the contract block. Tolerant of prose around it, strict about the lines."""
    out: list[Finding] = []
    if "FINDINGS" in text:
        text = text.split("FINDINGS", 1)[1]
    for line in text.splitlines():
        m = FINDING_RE.match(line.strip().lstrip("-* "))
        if m:
            out.append(
                Finding(
                    path=m["path"],
                    start=int(m["start"]),
                    end=int(m["end"]),
                    rule=m["rule"].upper(),
                    cls=m["cls"].lower(),
                )
            )
    return out


def grade(actual: list[Finding], expected: list[dict], negatives: list[dict]) -> dict:
    """Set-match actual findings against the case's labels.

    A hit requires the same rule id AND an overlapping line range. Matching on rule id
    alone would credit a finding that named the right rule in the wrong place.
    """
    exp = [
        Finding(e["path"], e["lines"][0], e["lines"][1], e["rule"].upper(), e.get("class", "taste"))
        for e in expected
    ]
    neg = [Finding(n["path"], n["lines"][0], n["lines"][1], "", "") for n in negatives]

    matched, unmatched = set(), []
    for e in exp:
        hit = next(
            (a for a in actual if a.rule == e.rule and a.overlaps(e) and id(a) not in matched),
            None,
        )
        if hit:
            matched.add(id(hit))
        else:
            unmatched.append(e)

    # A finding landing on a span declared correct is the expensive kind of wrong.
    on_negative = [a for a in actual if any(a.overlaps(n) for n in neg)]
    spurious = [a for a in actual if id(a) not in matched and a not in on_negative]

    def counts(cls: str) -> dict:
        tp = len([e for e in exp if e.cls == cls]) - len([e for e in unmatched if e.cls == cls])
        fn = len([e for e in unmatched if e.cls == cls])
        fp = len([a for a in on_negative + spurious if a.cls == cls])
        return {
            "hit": tp,
            "missed": fn,
            "false_positive": fp,
            "recall": round(tp / (tp + fn), 3) if tp + fn else None,
            "precision": round(tp / (tp + fp), 3) if tp + fp else None,
        }

    return {
        "floor": counts("floor"),
        "taste": counts("taste"),
        "flagged_correct_code": len(on_negative),
        "total_reported": len(actual),
    }


def run_arm(run_dir: Path, prompt: str, skill_path: Path | None, model: str,
            timeout_ms: int, dry: bool) -> ArmResult:
    arm = run_dir.name
    cmd = [
        "pioneer", "eval", "run",
        "--run-dir", str(run_dir),
        "--timeout-ms", str(timeout_ms),
        "--deny-read-probe", str(ROOT / "skills"),  # answer keys must be unreachable
        "--", "pi", "--model", model,
    ]
    if skill_path:
        cmd += ["--skill", str(skill_path)]
    cmd += ["--print", prompt]

    if dry:
        print("  would run:", " ".join(cmd[:8]), "…", file=sys.stderr)
        return ArmResult(arm=arm, raw="", error="dry-run")

    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    except FileNotFoundError:
        return ArmResult(arm=arm, error="pioneer not found on PATH")
    if proc.returncode != 0:
        return ArmResult(arm=arm, raw=proc.stdout, error=proc.stderr.strip()[:400])
    return ArmResult(arm=arm, raw=proc.stdout, findings=parse_findings(proc.stdout))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skill", required=True)
    ap.add_argument("--model", default="claude-code/claude-sonnet-4-6")
    ap.add_argument("--battery", default=None, help="prepared battery dir; prepared if absent")
    ap.add_argument("--timeout-ms", type=int, default=300_000)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    skill_dir = ROOT / "skills" / args.skill
    evals_file = skill_dir / "evals" / "evals.json"
    if not evals_file.exists():
        print(f"error: {evals_file} not found", file=sys.stderr)
        return 1

    spec = json.loads(evals_file.read_text())
    battery = Path(args.battery) if args.battery else ROOT / "batteries" / args.skill

    if not args.dry_run:
        if battery.exists():
            shutil.rmtree(battery)
        subprocess.run(
            ["pioneer", "eval", "prepare",
             "--skill", str(skill_dir),
             "--evals", str(evals_file),
             "--output", str(battery)],
            check=True,
        )

    report = []
    for case in spec["evals"]:
        cid = case["id"]
        prompt = case["prompt"] + OUTPUT_CONTRACT
        case_dir = battery / "actor-runs" / f"eval-{cid}"
        print(f"case {cid}: {case.get('title', '')}", file=sys.stderr)

        arms = {
            "baseline": run_arm(case_dir / "baseline", prompt, None,
                                args.model, args.timeout_ms, args.dry_run),
            "with-skill": run_arm(case_dir / "with-skill", prompt,
                                  case_dir / "with-skill" / "skills" / args.skill,
                                  args.model, args.timeout_ms, args.dry_run),
        }
        report.append({
            "case": cid,
            "title": case.get("title", ""),
            "arms": {
                name: {"error": a.error, **grade(a.findings, case.get("expect", []),
                                                 case.get("negatives", []))}
                for name, a in arms.items()
            },
        })

    print(json.dumps(report, indent=2))

    # The headline number, split so a flat taste delta cannot hide behind the floor.
    for cls in ("floor", "taste"):
        base = sum(c["arms"]["baseline"][cls]["hit"] for c in report)
        skilled = sum(c["arms"]["with-skill"][cls]["hit"] for c in report)
        fp_base = sum(c["arms"]["baseline"][cls]["false_positive"] for c in report)
        fp_skill = sum(c["arms"]["with-skill"][cls]["false_positive"] for c in report)
        print(
            f"{cls:>6}  hits {base} → {skilled}   "
            f"false positives {fp_base} → {fp_skill}",
            file=sys.stderr,
        )
    print("\nA flat taste delta means the skill is a linter. That is the number to watch.",
          file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
