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
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
import roster  # noqa: E402


def _known_rules() -> dict[str, str]:
    """Rule id -> class, read from STANDARDS.md. The prefix encodes the class."""
    prefixes = {"F": "floor", "O": "obligation", "T": "taste"}
    text = (ROOT / "STANDARDS.md").read_text()
    return {
        m.group(1): prefixes[m.group(1)[0]]
        for m in re.finditer(r"^### ([FOT]-\d{3})", text, re.M)
    }


KNOWN_RULES = _known_rules()

# The shape every arm is asked to produce, appended to each case prompt so both arms are
# answering the same question in the same form.
OUTPUT_CONTRACT = """

Write your review however you normally would. Then, at the very end of your response, add a
machine-readable summary of it: the line FINDINGS on its own, then one line per finding in
exactly this form, and nothing after the last of them.

FINDINGS
<path>:<start>-<end> <rule-id> <floor|obligation|taste> <minor|major> <one line>

This block must repeat every finding your review made, and must not add any it did not.

Severity for a taste finding is relative to what this codebase has decided, not intrinsic
to the finding: contradicting a convention the project holds — written down, or followed
everywhere else in the code — is major; the same observation with no convention anywhere
is minor.

A floor or obligation finding is major regardless, whether or not the project has decided
anything. Those are about the software being wrong, not about it being inconsistent.

Use the rule ids from the standards if you have them. If you have no standards to draw on,
still use this shape and put your own short identifier in the rule-id column.
If you found nothing, write FINDINGS and then NONE."""

# The end of the range is optional: a one-line finding is naturally written "Nav.kt:27",
# and rejecting that form measured transcription, not judgment.
# Retries for an arm that exits 0 with nothing on stdout.
EMPTY_RETRIES = 2

# A finding spread over the composing code of one event — a panel's spec and its content's
# spec, say — is naturally written with several ranges, "Panel.kt:27-28,46-47". Rejecting it
# dropped exactly the composite findings class E exists to measure; it now spans from the
# first range's start to the last range's end.
FINDING_RE = re.compile(
    r"^(?P<path>[^\s:]+):(?P<ranges>\d+(?:-\d+)?(?:,\s*\d+(?:-\d+)?)*)\s+"
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
    unparsed: int = 0


def parse_findings(text: str) -> tuple[list[Finding], int]:
    """Parse the contract block. Tolerant of prose around it, strict about the lines.

    Returns the findings and a count of lines that looked like findings but did not
    parse. Silently dropping malformed lines made a badly formatted review
    indistinguishable from a clean one: zero findings, zero false positives, perfect
    precision.
    """
    out: list[Finding] = []
    unparsed = 0
    if "FINDINGS" in text:
        # rsplit, not split: a model that says the word "findings" in its preamble would
        # otherwise have everything after the first mention treated as the block.
        text = text.rsplit("FINDINGS", 1)[1]
    for line in text.splitlines():
        stripped = line.strip().lstrip("-* ")
        if not stripped or stripped.upper() == "NONE":
            continue
        m = FINDING_RE.match(stripped)
        if not m:
            # Looks like it was meant to be a finding: has a path:line somewhere. This
            # also catches the markdown-table shape, which is how a format conflict
            # between the contract and a skill's own report style shows up.
            if re.search(r"[^\s:]+:\d+(-\d+)?\b", stripped):
                unparsed += 1
            continue
        if m:
            bounds = [int(n) for n in re.findall(r"\d+", m["ranges"])]
            out.append(
                Finding(
                    path=m["path"],
                    start=min(bounds),
                    end=max(bounds),
                    rule=m["rule"].upper(),
                    cls=m["cls"].lower(),
                    severity=m["sev"].lower(),
                )
            )
    return out, unparsed


def grade(actual: list[Finding], expected: list[dict], negatives: list[dict],
          match_rule_ids: bool = True, forbidden: list[str] | None = None,
          raw: str = "") -> dict:
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
    # Some defects have more than one honest place to report them. O-002's subject is a
    # composable that plays a Lottie, but the missing marker is a fact about the .json, and
    # anchoring the finding there is not wrong. Without this the correct answer in the
    # wrong-but-reasonable file scored as a miss.
    alt: list[list[Finding]] = [
        [Finding(a["path"], a["lines"][0], a["lines"][1], "", "")
         for a in e.get("also_at", [])]
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
    severity_right = 0
    for e, e_alt in zip(exp, alt):
        def fits(a: Finding, e=e, e_alt=e_alt) -> bool:
            if id(a) in matched:
                return False
            if not (a.overlaps(e) or any(a.overlaps(x) for x in e_alt)):
                return False
            return a.rule == e.rule if match_rule_ids else a.cls == e.cls

        hit = next((a for a in deduped if fits(a)), None)
        if hit:
            matched.add(id(hit))
            if e.severity and hit.severity:
                if hit.severity == e.severity:
                    severity_right += 1
                else:
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

    # A matched finding can still be a shotgun: one span covering the expected defect AND
    # every must-not-flag region around it. Counting it once means it cannot also be a
    # false positive, so it would otherwise score as a clean hit — which rewards the
    # laziest possible answer, "something on this screen is wrong". Not scored, but
    # surfaced, and it disqualifies the hit from counting as precise.
    blanketing = [
        {"path": a.path, "lines": [a.start, a.end], "rule": a.rule,
         "covers_negatives": sum(1 for n in neg if a.overlaps(n))}
        for a in deduped
        if id(a) in matched and any(a.overlaps(n) for n in neg)
    ]

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
        "severity_right": severity_right,
        "severity_wrong": len(wrong_severity),
        "wrong_severity": wrong_severity,
        "wrong_class": wrong_class,
        "flagged_correct_code": len(on_negative),
        "blanketing": blanketing,
        "unlabeled": [
            {"path": a.path, "lines": [a.start, a.end], "rule": a.rule, "class": a.cls}
            for a in unlabeled
        ],
        "duplicates": duplicates,
        "total_reported": len(actual),
        # Fabrication had been the entire point of the phantom battery and the one thing
        # it did not measure: every defining behaviour ("does not cite MOTION.md content")
        # lived in prose the grader never read, so a skill that invented a motion language
        # scored a clean pass. These strings appear nowhere in the staged input — validate()
        # enforces that — so naming one cannot be a quote. Any hit fails the case.
        "fabricated": sorted({f for f in (forbidden or []) if f.lower() in raw.lower()}),
    }


def mean_grades(grades: list[dict]) -> dict:
    """Average n runs of one arm into one grade-shaped dict.

    A single sample cannot tell a capability gap from sampling noise, and these models are
    not deterministic. Scalars are averaged so the summary reads the same at n=1; the
    diagnostic lists are concatenated, because a false positive that appears in one run of
    five is still a false positive worth reading.
    """
    if len(grades) == 1:
        return grades[0]

    out: dict = {}
    for key, sample in grades[0].items():
        if isinstance(sample, dict):  # floor / obligation / taste
            out[key] = {
                k: (None if all(g[key][k] is None for g in grades)
                    else round(sum(g[key][k] or 0 for g in grades) / len(grades), 3))
                for k in sample
            }
        elif isinstance(sample, list):
            out[key] = [item for g in grades for item in g[key]]
        elif isinstance(sample, (int, float)):
            out[key] = round(sum(g[key] for g in grades) / len(grades), 3)
        else:
            out[key] = sample
    return out


def resolve_actor(command: str) -> tuple[str, list[str]]:
    """The actor's real path, plus directories the sandbox must be allowed to read.

    Two separate problems, neither visible until you hit them, and together they make the
    actor fail to start with an error about a missing module:

    * Pioneer materialises the command at the path you gave it. `pi` on PATH is a symlink
      into a node package, so Node resolves the bundle's sibling `chunks/` relative to the
      *bin* directory, where nothing of the sort exists. Passing the resolved path fixes
      what Node thinks the script's directory is.
    * The chunks then resolve correctly and still cannot be opened, because the sandbox was
      never told the package is readable. Hence the matching `--runtime-read` grant.
    """
    found = shutil.which(command)
    if not found:
        raise SystemExit(
            f"error: {command!r} is not on PATH.\n"
            f"  If it is installed under nvm, the shell running this script may not have "
            f"loaded nvm — non-interactive shells usually have not."
        )
    real = Path(found).resolve()
    grants = [str(p) for p in real.parents if (p / "package.json").exists()][:1]
    return str(real), grants


def run_arm(run_dir: Path, prompt: str, skill_path: Path | None, model: str,
            timeout_ms: int, dry: bool, actor: tuple[str, list[str]] | None = None,
            thinking: str = "") -> ArmResult:
    arm = run_dir.name
    # A dry run only prints the command, so the bare name will do; resolving it would
    # make the plan fail wherever pi is not installed, which is CI.
    actor_path, grants = actor or (("pi", []) if dry else resolve_actor("pi"))
    cmd = [
        "pioneer", "eval", "run",
        "--run-dir", str(run_dir),
        "--timeout-ms", str(timeout_ms),
        "--deny-read-probe", str(ROOT / "skills"),  # answer keys must be unreachable
    ]
    for g in grants:
        cmd += ["--runtime-read", g]
    cmd += ["--", actor_path, "--model", model]
    # A separate flag, not a ":level" suffix on the model: pi accepts the suffix only
    # for a bare id, and rejects "provider/id:level" as an unknown model.
    if thinking:
        cmd += ["--thinking", thinking]
    if skill_path:
        cmd += ["--skill", str(skill_path)]
    cmd += ["--print", prompt]

    if dry:
        print("  would run:", " ".join(cmd[:8]), "…", file=sys.stderr)
        return ArmResult(arm=arm, raw="", error="dry-run")

    # Some models intermittently exit 0 with an empty body — reproduced with an unchanged
    # prompt returning nothing on one attempt and a full review on the next. That is a
    # transient failure rather than an answer, so it is retried. Note this retries an
    # empty response only: a review that genuinely found nothing still writes its
    # FINDINGS/NONE block, so it is never mistaken for one of these.
    for attempt in range(EMPTY_RETRIES + 1):
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
        except FileNotFoundError:
            return ArmResult(arm=arm, error="pioneer not found on PATH")
        if proc.returncode != 0 or proc.stdout.strip():
            break
        if attempt < EMPTY_RETRIES:
            print(f"    {arm}: empty response, retrying "
                  f"({attempt + 1}/{EMPTY_RETRIES})", file=sys.stderr)

    if proc.returncode != 0:
        # The TAIL of stderr, not the head: pioneer prints a multi-line contract
        # preamble before anything runs, so truncating from the front reliably keeps
        # the boilerplate and discards the actual failure.
        return ArmResult(arm=arm, raw=proc.stdout,
                         error=proc.stderr.strip()[-600:])
    if not proc.stdout.strip():
        # Exit 0 and nothing on stdout is not a clean review, it is a review that never
        # happened. Left alone it scores as "looked and found nothing": zero misses
        # attributable to anything, zero false positives, perfect precision — and it is
        # indistinguishable from a genuinely clean fixture. Observed on two cases where a
        # model returned success with an empty body, which cost the skill both floor
        # findings in that run.
        return ArmResult(arm=arm, raw="",
                         error=f"[EMPTY_OUTPUT] exited 0 with no output after "
                               f"{EMPTY_RETRIES + 1} attempts")

    found, unparsed = parse_findings(proc.stdout)
    return ArmResult(arm=arm, raw=proc.stdout, findings=found, unparsed=unparsed)


def validate(spec_path: Path, skill_dir: Path) -> list[str]:
    """Check a battery against its fixtures before anything is run.

    Line ranges are written by hand against files that then get edited. A range that has
    drifted off the construct it names does not fail loudly — the case simply stops
    measuring what it claims to, and keeps reporting a number.
    """
    problems: list[str] = []
    spec = json.loads(spec_path.read_text())
    where = spec_path.name

    # Universal checks run against every transcript, so they are validated here too — an
    # uncalibrated one would otherwise reach every case at once.
    checks_path = skill_dir / "evals" / "judge-checks.json"
    universal_checks = (
        json.loads(checks_path.read_text())["universal"] if checks_path.exists() else []
    )

    # check id -> the set of verdicts its calibration items cover.
    calibration_coverage: dict[str, set[str]] = {}
    cal_path = skill_dir / "evals" / "judge-calibration.json"
    if cal_path.exists():
        for item in json.loads(cal_path.read_text())["items"]:
            calibration_coverage.setdefault(item["check"]["id"], set()).add(
                item["expect_verdict"]
            )

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
            # Pioneer flattens to the basename in prompts and we match findings on it, so
            # two fixtures sharing one would silently shadow each other in both places.
            if src.name in staged:
                problems.append(
                    f"{where} case {cid}: two staged files share the basename {src.name}"
                )
            staged[src.name] = src

        # A forbidden string the arm can legitimately read is a trap, not a check —
        # and the with-skill arm can read the whole skill, including every reference
        # doc. Omitting that is how "DECIDED" got onto a forbidden list and failed a
        # run for correctly reporting that a file was absent.
        blob = "\n".join(p.read_text() for p in staged.values()) + case["prompt"]
        for doc in skill_dir.rglob("*.md"):
            if "evals" not in doc.parts:
                blob += "\n" + doc.read_text()
        for s in case.get("forbidden_strings", []):
            if s.lower() in blob.lower():
                problems.append(
                    f"{where} case {cid}: forbidden string {s!r} appears in the staged "
                    f"input, so citing it would not be fabrication"
                )

        spans = []
        for kind in ("expect", "negatives"):
            entries = []
            for e in case.get(kind, []):
                entries.append(e)
                # Alternate anchors are real spans and drift like any other.
                entries.extend(e.get("also_at", []))
            for e in entries:
                src = staged.get(e["path"])
                if src is None:
                    problems.append(
                        f"{where} case {cid}: {kind} names {e['path']}, which is not staged"
                    )
                    continue
                text = src.read_text().splitlines()
                total = len(text)
                a, b = e["lines"]
                if a < 1 or a > b or b > total:
                    problems.append(
                        f"{where} case {cid}: {e['path']}:{a}-{b} is outside the file "
                        f"({total} lines)"
                    )
                    continue
                # A span drawn around a construct starts and ends on code. One that begins
                # or ends on a blank line has almost always slid when the file above it
                # changed — an added import moves everything below by one, and the range
                # still fits inside the file.
                if not text[a - 1].strip() or not text[b - 1].strip():
                    problems.append(
                        f"{where} case {cid}: {e['path']}:{a}-{b} starts or ends on a blank "
                        f"line, so it has probably drifted off its construct"
                    )
                spans.append((kind, e["path"], a, b))

        # A span cannot be both the finding we want and a must-not-flag region.
        for i, (k1, p1, a1, b1) in enumerate(spans):
            for k2, p2, a2, b2 in spans[i + 1:]:
                if p1 != p2 or not (a1 <= b2 and a2 <= b1):
                    continue
                if k1 != k2:
                    problems.append(
                        f"{where} case {cid}: {p1} lines {a1}-{b1} and {a2}-{b2} are both "
                        f"expected and must-not-flag"
                    )
                elif k1 == "negatives":
                    # Interlocking negatives make it ambiguous which declared-clean region
                    # a finding landed on, and usually mean a span has swallowed the next
                    # declaration's header.
                    problems.append(
                        f"{where} case {cid}: negative spans {p1}:{a1}-{b1} and {a2}-{b2} "
                        f"overlap"
                    )
                else:
                    # Overlapping expects make matching order-dependent: one finding could
                    # satisfy either, and which it lands on decides whether the other is a
                    # miss. Keeping them disjoint removes the ambiguity structurally.
                    problems.append(
                        f"{where} case {cid}: expected spans {p1}:{a1}-{b1} and {a2}-{b2} "
                        f"overlap"
                    )

        # A check is only worth its output if the classifier has been shown it can answer
        # that exact question on states whose reading is already settled — in BOTH
        # directions. Calibrating only on states that should pass would be passed by a
        # classifier that answers "pass" to everything.
        for chk in list(case.get("checks", [])) + universal_checks:
            for field in ("id", "type", "instructions", "expect"):
                if field not in chk:
                    problems.append(
                        f"{where} case {cid}: check is missing {field!r}"
                    )
            if chk.get("type") not in ("noul", "choice", "score"):
                problems.append(
                    f"{where} case {cid}: check {chk.get('id')!r} has unknown type "
                    f"{chk.get('type')!r}"
                )
            if chk.get("type") == "choice":
                want = chk["expect"] if isinstance(chk["expect"], list) else [chk["expect"]]
                unknown = set(want) - set(chk.get("criteria", {}))
                if unknown:
                    problems.append(
                        f"{where} case {cid}: check {chk['id']!r} expects "
                        f"{sorted(unknown)}, which is not among its criteria"
                    )
            covered = calibration_coverage.get(chk.get("id"), set())
            if not covered:
                problems.append(
                    f"{where} case {cid}: check {chk.get('id')!r} has no calibration item"
                )
            elif covered != {"pass", "fail"}:
                problems.append(
                    f"{where} case {cid}: check {chk['id']!r} is calibrated only for "
                    f"{sorted(covered)} — it needs a state that should fail it too"
                )

        # A rule id that no longer exists means the case is testing nothing.
        for e in case.get("expect", []):
            if e["rule"].upper() not in KNOWN_RULES:
                problems.append(
                    f"{where} case {cid}: expects {e['rule']}, which is not in STANDARDS.md"
                )
            elif KNOWN_RULES[e["rule"].upper()] != e.get("class", "taste"):
                problems.append(
                    f"{where} case {cid}: {e['rule']} is class "
                    f"{KNOWN_RULES[e['rule'].upper()]} in STANDARDS.md, "
                    f"but the case declares {e.get('class', 'taste')}"
                )

    return problems


def work_root() -> Path:
    """Where prepared batteries and transcripts go. Never inside the repo.

    Two reasons, one of which is not optional. Pioneer refuses a run directory under a
    protected root — `/srv` among them — and this checkout is reached through a symlink
    into `/srv`, so no path inside it can ever be a valid run directory. Battery output is
    also bulky and disposable, and does not belong in a source tree.
    """
    base = os.environ.get("ANDROID_UX_SKILLS_WORK_DIR") or os.environ.get(
        "XDG_CACHE_HOME", str(Path.home() / ".cache")
    )
    root = Path(base)
    return root if "ANDROID_UX_SKILLS_WORK_DIR" in os.environ else root / "android-ux-skills"


def run_battery(spec_path, skill_dir, skill, model, timeout_ms, dry, runs=1,
                work_dir: Path | None = None, actor_command: str = "pi",
                tag: str = "", thinking: str = "") -> dict:
    """Prepare and run one battery. Each evals*.json in a skill is its own battery.

    Batteries exist because Pioneer's arms are fixed at baseline/with-skill, so a second
    factor — MOTION.md absent, established, stale, or claimed-but-missing — cannot be an
    arm. Expressing it as separate batteries also keeps it invisible to the agent: case
    ids, prompts and staged filenames are identical across them, and only the file
    contents differ.
    """
    spec = json.loads(spec_path.read_text())
    name = spec.get("battery", spec_path.stem)
    # Namespaced by model: without this a sweep's second model overwrites the first
    # model's transcripts, and the reading pass silently reads the wrong run.
    battery = (work_dir or work_root()) / "batteries" / skill / (tag or "single") / name

    if not dry:
        if battery.exists():
            shutil.rmtree(battery)
        # Pioneer resolves --output's parent and fails if it does not exist. Left to
        # check=True this surfaced as a CalledProcessError traceback with pioneer's actual
        # message nowhere in it.
        battery.parent.mkdir(parents=True, exist_ok=True)
        prep = subprocess.run(
            ["pioneer", "eval", "prepare",
             "--skill", str(skill_dir),
             "--evals", str(spec_path),
             "--output", str(battery)],
            capture_output=True, text=True,
        )
        if prep.returncode != 0:
            detail = (prep.stderr or prep.stdout).strip()
            raise SystemExit(f"pioneer eval prepare failed for {name}:\n  {detail}")

    actor = None if dry else resolve_actor(actor_command)

    cases = []
    for case in spec["evals"]:
        cid = case["id"]
        prompt = case["prompt"] + OUTPUT_CONTRACT
        case_dir = battery / "actor-runs" / f"eval-{cid}"
        print(f"  case {cid}: {case.get('title', '')}", file=sys.stderr)

        # Transcripts are kept. The grader reduces a review to a handful of counts, and
        # when a case scores badly those counts do not tell you why — the reasoning, the
        # near-misses, and everything the labels do not cover were being thrown away with
        # the process output. They are also the input any later qualitative pass needs.
        transcripts = battery / "transcripts" / f"eval-{cid}"
        if not dry:
            transcripts.mkdir(parents=True, exist_ok=True)
            (transcripts / "prompt.md").write_text(prompt)

        # Pioneer prepares one directory per arm. Each repeat needs its own, copied from
        # that pristine one before any run touches it: without this every repeat ran in a
        # directory that did not exist, so --runs 2 failed every arm and reported nothing.
        if runs > 1 and not dry:
            for arm in ("baseline", "with-skill"):
                for n in range(runs):
                    shutil.copytree(case_dir / arm, case_dir / f"{arm}-run{n + 1}",
                                    symlinks=True)

        arms: dict[str, list[ArmResult]] = {"baseline": [], "with-skill": []}
        saved: dict[str, list[str]] = {"baseline": [], "with-skill": []}
        for n in range(runs):
            suffix = "" if runs == 1 else f"-run{n + 1}"
            for arm, skill_path in (
                ("baseline", None),
                ("with-skill", case_dir / f"with-skill{suffix}" / "skills" / skill),
            ):
                r = run_arm(case_dir / f"{arm}{suffix}", prompt, skill_path,
                            model, timeout_ms, dry, actor, thinking)
                arms[arm].append(r)
                if not dry:
                    f = transcripts / f"{arm}{suffix}.md"
                    f.write_text(r.raw or f"(no output — {r.error or 'empty'})")
                    saved[arm].append(str(f))

        graded = {
            arm: [grade(r.findings, case.get("expect", []), case.get("negatives", []),
                        match_rule_ids=(arm != "baseline"),
                        forbidden=case.get("forbidden_strings", []), raw=r.raw)
                  for r in rs]
            for arm, rs in arms.items()
        }
        cases.append({
            "transcripts": saved,
            "case": cid,
            "title": case.get("title", ""),
            "runs": runs,
            "arms": {
                arm: {
                    "error": next((r.error for r in rs if r.error), None),
                    # An arm that never ran is not an arm that found nothing. A transient
                    # 503 produced zero findings and zero false positives, which scores as
                    # flawless precision — the most flattering possible result for a run
                    # that never happened.
                    "failed": all(r.error for r in rs),
                    "unparsed": round(sum(r.unparsed for r in rs) / len(rs), 3),
                    **mean_grades(graded[arm]),
                    # The mean alone cannot say whether a delta is larger than the noise;
                    # the spread across repeats can. None marks a repeat that never ran.
                    "per_run": [
                        None if r.error else {
                            **{cls: g[cls]["hit"] for cls in ("floor", "obligation", "taste")},
                            "flagged_correct_code": g["flagged_correct_code"],
                        }
                        for r, g in zip(rs, graded[arm])
                    ],
                }
                for arm, rs in arms.items()
            },
        })

    return {"battery": name, "model": model, "thinking": thinking,
            "description": spec.get("description", ""), "cases": cases}


def summarize(results: list[dict]) -> None:
    def total(res, arm, cls, field):
        return sum(c["arms"][arm][cls][field] for c in res["cases"]
                   if not c["arms"][arm].get("failed"))

    print("\n" + "=" * 78, file=sys.stderr)
    for res in results:
        print(f"\n{res['battery']}", file=sys.stderr)

        # Loudly, and before any number: everything below is computed over the cases that
        # actually ran.
        failed = [(c["case"], arm) for c in res["cases"] for arm in c["arms"]
                  if c["arms"][arm].get("failed")]
        if failed:
            print(f"  !! {len(failed)} arm(s) DID NOT RUN and are excluded from the "
                  f"numbers below:", file=sys.stderr)
            for cid, arm in failed[:6]:
                err = next(c["arms"][arm]["error"] for c in res["cases"]
                           if c["case"] == cid)
                short = (err or "").replace("\n", " ")[-120:]
                print(f"       case {cid} {arm}: …{short}", file=sys.stderr)
        for cls in ("floor", "obligation", "taste"):
            b_hit, s_hit = total(res, "baseline", cls, "hit"), total(res, "with-skill", cls, "hit")
            b_fp, s_fp = (total(res, "baseline", cls, "false_positive"),
                          total(res, "with-skill", cls, "false_positive"))
            if b_hit or s_hit or b_fp or s_fp:
                print(f"  {cls:>6}  hits {b_hit} -> {s_hit}   "
                      f"false positives {b_fp} -> {s_fp}", file=sys.stderr)

        # With repeats, the range across them — the error bar the means above do not have.
        # A delta that fits inside it is not a delta.
        if max((c.get("runs", 1) for c in res["cases"]), default=1) > 1:
            n = max(c.get("runs", 1) for c in res["cases"])
            for arm in ("baseline", "with-skill"):
                # Every repeat is summed over the same cases. A case where any repeat failed
                # is left out of all of them: counting it in some repeats and not others
                # would widen the range with a difference that is not the model's.
                whole = [c["arms"][arm]["per_run"] for c in res["cases"]
                         if len(c["arms"][arm].get("per_run", [])) == n
                         and None not in c["arms"][arm]["per_run"]]
                if not whole:
                    continue
                spread = {}
                for key in ("floor", "obligation", "taste", "flagged_correct_code"):
                    totals = [sum(runs[i][key] for runs in whole) for i in range(n)]
                    spread[key] = f"{min(totals)}–{max(totals)}"
                dropped = len(res["cases"]) - len(whole)
                print(f"  per-run range {arm:>10}: "
                      + "  ".join(f"{k.replace('flagged_correct_code', 'FPs')} {v}"
                                  for k, v in spread.items())
                      + (f"  ({dropped} case(s) with a failed repeat left out)"
                         if dropped else ""), file=sys.stderr)

        # Severity is the payload of three of four batteries, so it is scored, not just
        # annotated, and shown for both arms — the question is whether it MOVES with the
        # staged MOTION.md, which a single arm cannot answer.
        for arm in ("baseline", "with-skill"):
            right = sum(c["arms"][arm]["severity_right"] for c in res["cases"])
            wrong = sum(c["arms"][arm]["severity_wrong"] for c in res["cases"])
            if right or wrong:
                print(f"  severity  {arm:>10}: {right} right, {wrong} wrong", file=sys.stderr)

        blanket = [b for c in res["cases"] for b in c["arms"]["with-skill"]["blanketing"]]
        if blanket:
            print(f"  shotgun findings (hit, but blanket declared-clean code): "
                  f"{len(blanket)}", file=sys.stderr)

        # Loud, and not folded into any rate: inventing a convention is a different kind of
        # failure from missing one, and a skill that does it is worse than no skill.
        for arm in ("baseline", "with-skill"):
            for c in res["cases"]:
                fab = c["arms"][arm].get("fabricated") or []
                if fab:
                    print(f"  FABRICATION  case {c['case']} {arm}: cited "
                          f"{', '.join(fab)} — absent from everything it was given",
                          file=sys.stderr)

        unparsed = sum(c["arms"]["with-skill"].get("unparsed", 0) for c in res["cases"])
        if unparsed:
            print(f"  unparsed finding lines: {unparsed} — output may be malformed",
                  file=sys.stderr)

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
    ap.add_argument("--model", default=None,
                    help="model(s) to run, comma-separated, each optionally "
                         "model:thinking. Omit to take the first reachable entries "
                         "of --tier. One model alone needs --allow-single: its "
                         "habits are indistinguishable from what is being measured")
    ap.add_argument("--tier", default=None, choices=("arms", "sota"),
                    help="run every reachable model in this roster tier, one "
                         "report each")
    ap.add_argument("--allow-single", action="store_true")
    ap.add_argument("--allow-metered", action="store_true",
                    help="permit a provider billed per token; see model-roster.json")
    ap.add_argument("--battery", default=None,
                    help="run one battery by name; default runs all")
    ap.add_argument("--timeout-ms", type=int, default=300_000)
    ap.add_argument("--runs", type=int, default=1,
                    help="repeat each arm n times and average; these models are not "
                         "deterministic and n=1 cannot separate a capability gap from "
                         "sampling noise")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--actor", default="pi",
                    help="the coding agent each arm runs as")
    ap.add_argument("--work-dir", default=None,
                    help="where prepared batteries and transcripts go. Must not be "
                         "inside the repo: pioneer refuses a run directory under a "
                         "protected root, and this checkout resolves into /srv")
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

    models = roster.resolve(args.model, args.tier or "arms", 2,
                            args.allow_single, check_reachable=not args.dry_run,
                            allow_metered=args.allow_metered)
    if len(models) > 1:
        print(f"sweeping {len(models)} models: "
              f"{', '.join(m['model'] for m in models)}", file=sys.stderr)

    for entry in models:
        tag = roster.label(entry)
        model = entry["model"]
        if len(models) > 1:
            print(f"\n===== {entry['model']} =====", file=sys.stderr)

        results = []
        for spec_path in specs:
            name = json.loads(spec_path.read_text()).get("battery", spec_path.stem)
            print(f"\nbattery: {name}", file=sys.stderr)
            results.append(run_battery(spec_path, skill_dir, args.skill,
                                       model, args.timeout_ms, args.dry_run,
                                       runs=args.runs,
                                       work_dir=Path(args.work_dir) if args.work_dir
                                       else None, actor_command=args.actor,
                                       tag=tag, thinking=entry.get("thinking", "")))

        report = json.dumps(results, indent=2)
        if args.out:
            # One file per model. The report schema is unchanged, so judge-evals and
            # read-evals consume each of them exactly as before.
            out = Path(args.out)
            # os.devnull takes no suffix — CI and the pre-push hook write the plan
            # there, and a sweep would otherwise try to create /dev/null.<model>.
            dest = (out if len(models) == 1 or str(out) == os.devnull
                    else out.with_name(f"{out.stem}.{tag}{out.suffix}"))
            dest.write_text(report)
            print(f"\nreport written to {dest}", file=sys.stderr)
        else:
            print(report)

        summarize(results)
    return 0


if __name__ == "__main__":
    sys.exit(main())
