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
<path>:<start>-<end> <rule-id> <floor|obligation|taste> <minor|major> <one line>

Severity is relative to what this codebase has decided, not intrinsic to the finding:
contradicting a convention the project has established is major; the same observation with
no convention established is minor.

Use the rule ids from the standards if you have them. If you have no standards to draw on,
still use this shape and put your own short identifier in the rule-id column.
If you find nothing, write FINDINGS and then NONE."""

FINDING_RE = re.compile(
    r"^(?P<path>[^\s:]+):(?P<start>\d+)-(?P<end>\d+)\s+"
    r"(?P<rule>\S+)\s+(?P<cls>floor|obligation|taste)\s+(?P<sev>minor|major)\b",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class Finding:
    path: str
    start: int
    end: int
    rule: str
    cls: str
    severity: str = ""

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
                    severity=m["sev"].lower(),
                )
            )
    return out


def grade(actual: list[Finding], expected: list[dict], negatives: list[dict],
          match_rule_ids: bool = True) -> dict:
    """Set-match actual findings against the case's labels.

    `match_rule_ids=False` is used for the baseline arm. The output contract tells an arm
    with no standards to invent its own identifiers, so requiring "T-001" from an arm that
    was never given the rule set measured vocabulary, not capability: a baseline naming the
    exact defect at the exact lines scored as a miss AND a false positive, and the headline
    delta could only ever flatter the skill. Baseline matches on location and class.

    Three further rules, each fixing a way the earlier version scored a right answer wrong:

    * A finding is counted once. It is either a hit, a false positive, or unlabeled — never
      two of those. A wide finding that covered an expected span and a must-not-flag span
      previously scored as both at the same time.
    * Duplicates collapse. Two identical lines are one finding, not a hit plus a spurious.
    * A correct finding outside every labeled span is **unlabeled**, not a false positive.
      Our labels are not a complete census of the defects in a fixture, and punishing a
      real finding we did not anticipate trains exactly the wrong behaviour. These surface
      for a human to adjudicate and fold back into the labels.
    """
    exp = [
        Finding(e["path"], e["lines"][0], e["lines"][1], e["rule"].upper(),
                e.get("class", "taste"), e.get("severity", ""))
        for e in expected
    ]
    neg = [Finding(n["path"], n["lines"][0], n["lines"][1], "", "") for n in negatives]

    # Collapse duplicates: same place, same rule, same class is one finding.
    seen, deduped, duplicates = set(), [], 0
    for a in actual:
        key = (Path(a.path).name, a.start, a.end, a.rule, a.cls)
        if key in seen:
            duplicates += 1
            continue
        seen.add(key)
        deduped.append(a)

    matched, unmatched, wrong_severity, wrong_class = set(), [], [], []
    for e in exp:
        def fits(a: Finding) -> bool:
            if id(a) in matched or not a.overlaps(e):
                return False
            return a.rule == e.rule if match_rule_ids else a.cls == e.cls

        hit = next((a for a in deduped if fits(a)), None)
        if hit:
            matched.add(id(hit))
            if e.severity and hit.severity and hit.severity != e.severity:
                wrong_severity.append(
                    {"rule": e.rule, "expected": e.severity, "reported": hit.severity}
                )
            if match_rule_ids and e.cls and hit.cls and hit.cls != e.cls:
                wrong_class.append(
                    {"rule": e.rule, "expected": e.cls, "reported": hit.cls}
                )
        else:
            unmatched.append(e)

    # Each remaining finding gets exactly one disposition.
    on_negative = [a for a in deduped
                   if id(a) not in matched and any(a.overlaps(n) for n in neg)]
    unlabeled = [a for a in deduped
                 if id(a) not in matched and a not in on_negative]

    def counts(cls: str) -> dict:
        tp = len([e for e in exp if e.cls == cls]) - len([e for e in unmatched if e.cls == cls])
        fn = len([e for e in unmatched if e.cls == cls])
        fp = len([a for a in on_negative if a.cls == cls])
        return {
            "hit": tp,
            "missed": fn,
            "false_positive": fp,
            "recall": round(tp / (tp + fn), 3) if tp + fn else None,
            "precision": round(tp / (tp + fp), 3) if tp + fp else None,
        }

    return {
        # Obligation is reported separately, never folded into taste. STANDARDS.md excludes
        # it from the taste *delta*; an earlier version excluded it from everything, so the
        # only absence-class case produced identical numbers whether it passed or failed.
        "floor": counts("floor"),
        "obligation": counts("obligation"),
        "taste": counts("taste"),
        "wrong_severity": wrong_severity,
        "wrong_class": wrong_class,
        "flagged_correct_code": len(on_negative),
        "unlabeled": [
            {"path": a.path, "lines": [a.start, a.end], "rule": a.rule, "class": a.cls}
            for a in unlabeled
        ],
        "duplicates": duplicates,
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


def validate(spec_path: Path, skill_dir: Path) -> list[str]:
    """Check a battery against its fixtures before anything is run.

    Line ranges are written by hand against files that then get edited. A range that has
    drifted off the construct it names does not fail loudly — the case simply stops
    measuring what it claims to, and keeps reporting a number.
    """
    problems: list[str] = []
    spec = json.loads(spec_path.read_text())
    where = spec_path.name

    seen_ids = set()
    for case in spec["evals"]:
        cid = case["id"]
        if cid in seen_ids:
            problems.append(f"{where}: duplicate case id {cid}")
        seen_ids.add(cid)

        staged: dict[str, Path] = {}
        for rel in case.get("files", []):
            src = (skill_dir / rel).resolve()
            if not src.exists():
                problems.append(f"{where} case {cid}: staged file missing — {rel}")
                continue
            staged[src.name] = src

        spans = []
        for kind in ("expect", "negatives"):
            for e in case.get(kind, []):
                src = staged.get(e["path"])
                if src is None:
                    problems.append(
                        f"{where} case {cid}: {kind} names {e['path']}, which is not staged"
                    )
                    continue
                total = len(src.read_text().splitlines())
                a, b = e["lines"]
                if a < 1 or a > b or b > total:
                    problems.append(
                        f"{where} case {cid}: {e['path']}:{a}-{b} is outside the file "
                        f"({total} lines)"
                    )
                else:
                    spans.append((kind, e["path"], a, b))

        # A span cannot be both the finding we want and a must-not-flag region.
        for i, (k1, p1, a1, b1) in enumerate(spans):
            for k2, p2, a2, b2 in spans[i + 1:]:
                if k1 != k2 and p1 == p2 and a1 <= b2 and a2 <= b1:
                    problems.append(
                        f"{where} case {cid}: {p1} lines {a1}-{b1} and {a2}-{b2} are both "
                        f"expected and must-not-flag"
                    )

    return problems


def run_battery(spec_path, skill_dir, skill, model, timeout_ms, dry) -> dict:
    """Prepare and run one battery. Each evals*.json in a skill is its own battery.

    Batteries exist because Pioneer's arms are fixed at baseline/with-skill, so a second
    factor — MOTION.md absent, established, stale, or claimed-but-missing — cannot be an
    arm. Expressing it as separate batteries also keeps it invisible to the agent: case
    ids, prompts and staged filenames are identical across them, and only the file
    contents differ.
    """
    spec = json.loads(spec_path.read_text())
    name = spec.get("battery", spec_path.stem)
    battery = ROOT / "batteries" / skill / name

    if not dry:
        if battery.exists():
            shutil.rmtree(battery)
        subprocess.run(
            ["pioneer", "eval", "prepare",
             "--skill", str(skill_dir),
             "--evals", str(spec_path),
             "--output", str(battery)],
            check=True,
        )

    cases = []
    for case in spec["evals"]:
        cid = case["id"]
        prompt = case["prompt"] + OUTPUT_CONTRACT
        case_dir = battery / "actor-runs" / f"eval-{cid}"
        print(f"  case {cid}: {case.get('title', '')}", file=sys.stderr)

        arms = {
            "baseline": run_arm(case_dir / "baseline", prompt, None,
                                model, timeout_ms, dry),
            "with-skill": run_arm(case_dir / "with-skill", prompt,
                                  case_dir / "with-skill" / "skills" / skill,
                                  model, timeout_ms, dry),
        }
        cases.append({
            "case": cid,
            "title": case.get("title", ""),
            "arms": {
                arm: {"error": r.error,
                      **grade(r.findings, case.get("expect", []), case.get("negatives", []),
                              match_rule_ids=(arm != "baseline"))}
                for arm, r in arms.items()
            },
        })

    return {"battery": name, "description": spec.get("description", ""), "cases": cases}


def summarize(results: list[dict]) -> None:
    def total(res, arm, cls, field):
        return sum(c["arms"][arm][cls][field] for c in res["cases"])

    print("\n" + "=" * 78, file=sys.stderr)
    for res in results:
        print(f"\n{res['battery']}", file=sys.stderr)
        for cls in ("floor", "obligation", "taste"):
            b_hit, s_hit = total(res, "baseline", cls, "hit"), total(res, "with-skill", cls, "hit")
            b_fp, s_fp = (total(res, "baseline", cls, "false_positive"),
                          total(res, "with-skill", cls, "false_positive"))
            if b_hit or s_hit or b_fp or s_fp:
                print(f"  {cls:>6}  hits {b_hit} -> {s_hit}   "
                      f"false positives {b_fp} -> {s_fp}", file=sys.stderr)

        sev = [s for c in res["cases"] for s in c["arms"]["with-skill"]["wrong_severity"]]
        if sev:
            for s in sev:
                print(f"  severity  {s['rule']}: expected {s['expected']}, "
                      f"reported {s['reported']}", file=sys.stderr)

        flagged = sum(c["arms"]["with-skill"]["flagged_correct_code"] for c in res["cases"])
        if flagged:
            print(f"  flagged correct code: {flagged}", file=sys.stderr)

        # Not scored either way. These are findings we did not label, which may be real
        # defects we missed rather than noise — they need a human, and they are how the
        # label set improves.
        unlabeled = [u for c in res["cases"] for u in c["arms"]["with-skill"]["unlabeled"]]
        if unlabeled:
            print(f"  unlabeled, needs adjudication: {len(unlabeled)}", file=sys.stderr)
            for u in unlabeled[:5]:
                print(f"    {u['path']}:{u['lines'][0]}-{u['lines'][1]} {u['rule']}",
                      file=sys.stderr)

    print("\n" + "-" * 78, file=sys.stderr)
    print("Read these three things, in order:", file=sys.stderr)
    print("  1. taste hits baseline -> with-skill. A flat delta means the skill is a "
          "linter.", file=sys.stderr)
    print("  2. false positives. A reviewer that flags correct code gets switched off.",
          file=sys.stderr)
    print("  3. severity across batteries. The same finding should be minor with no motion",
          file=sys.stderr)
    print("     language and major against a DECIDED one. If it does not move, the skill",
          file=sys.stderr)
    print("     is not reading MOTION.md, it is pattern-matching on code.", file=sys.stderr)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skill", required=True)
    ap.add_argument("--model", default="claude-code/claude-sonnet-4-6")
    ap.add_argument("--battery", default=None,
                    help="run one battery by name; default runs all")
    ap.add_argument("--timeout-ms", type=int, default=300_000)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--out", default=None, help="write the full JSON report here")
    args = ap.parse_args()

    skill_dir = ROOT / "skills" / args.skill
    specs = sorted((skill_dir / "evals").glob("evals*.json"))
    if not specs:
        print(f"error: no evals*.json under {skill_dir / 'evals'}", file=sys.stderr)
        return 1

    if args.battery:
        specs = [s for s in specs
                 if json.loads(s.read_text()).get("battery", s.stem) == args.battery]
        if not specs:
            print(f"error: no battery named {args.battery}", file=sys.stderr)
            return 1

    problems = [p for s in specs for p in validate(s, skill_dir)]
    if problems:
        print("battery validation failed:", file=sys.stderr)
        for p in problems:
            print(f"  {p}", file=sys.stderr)
        return 1
    print(f"{len(specs)} batteries validated against their fixtures", file=sys.stderr)

    results = []
    for spec_path in specs:
        name = json.loads(spec_path.read_text()).get("battery", spec_path.stem)
        print(f"\nbattery: {name}", file=sys.stderr)
        results.append(run_battery(spec_path, skill_dir, args.skill,
                                   args.model, args.timeout_ms, args.dry_run))

    report = json.dumps(results, indent=2)
    if args.out:
        Path(args.out).write_text(report)
        print(f"\nreport written to {args.out}", file=sys.stderr)
    else:
        print(report)

    summarize(results)
    return 0


if __name__ == "__main__":
    sys.exit(main())
