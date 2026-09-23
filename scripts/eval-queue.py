#!/usr/bin/env python3
"""A keyboard-driven queue for adjudicating eval findings. Deliberately disposable.

Every eval run produces findings that fall outside every labelled span. They are neither
rewarded nor punished, because our labels are not a census of what a fixture contains and
punishing a real finding we failed to anticipate would train the skill to stay quiet. They
need a human, and the alternative to this page is the human hand-editing JSON — which is
how two genuine fixture defects sat unnoticed until a model reported them twice.

    ./scripts/eval-queue.py /tmp/clean/report.*.json

Then open the printed URL. j/k to move, e/n/d to decide, u to undo. Decisions are applied
to the battery files on save, which are tracked by git, so a wrong call is one checkout
away from undone.

Not a dashboard. There are no metrics here on purpose: the numbers are six rows in a
terminal and they do not need a web page.
"""

from __future__ import annotations

import http.server
import json
import math
import re
import socketserver
import sys
import urllib.parse
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EVALS = ROOT / "skills/review-android-motion/evals"

FINDING = re.compile(
    r"^(?P<path>[^\s:]+):(?P<s>\d+)(?:-(?P<e>\d+))?\s+(?P<rule>\S+)\s+"
    r"(?P<cls>floor|obligation|taste)\s+(?P<sev>minor|major)\s*(?P<note>.*)",
    re.I | re.M,
)


def rule_text(rule: str) -> dict:
    """The rule's one-line title and its claim, kept apart."""
    body = (ROOT / "STANDARDS.md").read_text()
    m = re.search(rf"^### {re.escape(rule)} — (.+?)$(.*?)(?=^### |\Z)",
                  body, re.M | re.S)
    if not m:
        return {}
    claim = re.search(r"\*\*Claim\.\*\*\s*(.+?)(?=\n\n)", m.group(2), re.S)
    return {"title": m.group(1).strip(),
            "claim": " ".join(claim.group(1).split()) if claim else ""}


def transcript_note(path: str, rule: str, start: int) -> str:
    """What the model actually said, rather than our paraphrase of it."""
    f = Path(path)
    if not f.exists():
        return ""
    text = f.read_text()
    if "FINDINGS" in text:
        text = text.rsplit("FINDINGS", 1)[1]
    for m in FINDING.finditer(text):
        if m["rule"].upper() == rule.upper() and int(m["s"]) == start:
            return m["note"].strip()
    return ""


def source_lines(fixture: str, start: int, end: int, pad: int = 4) -> list[dict]:
    """The code under discussion. A finding is unreadable without it."""
    for candidate in EVALS.rglob(Path(fixture).name):
        lines = candidate.read_text().splitlines()
        lo, hi = max(1, start - pad), min(len(lines), end + pad)
        return [{"n": i, "text": lines[i - 1], "hot": start <= i <= end}
                for i in range(lo, hi + 1)]
    return []


# --------------------------------------------------------------------------------------
# What the spec actually does.
#
# "Is an expressive spring wrong on a star?" is a question about how the thing moves, and
# a reader who cannot see the motion is guessing. Compose's spring is a unit-mass damped
# harmonic oscillator, so its step response has a closed form: these curves are computed
# from the same constants the runtime uses, not eyeballed. What they cannot show is how it
# feels at 60fps on a 40dp icon — they show timing and overshoot, which is what the rules
# are actually about.
#
# (dampingRatio, stiffness) verbatim from ExpressiveMotionTokens.kt:21-34 and
# StandardMotionTokens.kt:19-32. The three effects springs are identical in both files,
# which is itself the point of T-004.
SCHEME_SPRINGS: dict[str, dict[str, tuple[float, float]]] = {
    "fastSpatialSpec": {"Expressive": (0.6, 800.0), "Standard": (0.9, 1400.0)},
    "defaultSpatialSpec": {"Expressive": (0.8, 380.0), "Standard": (0.9, 700.0)},
    "slowSpatialSpec": {"Expressive": (0.8, 200.0), "Standard": (0.9, 300.0)},
    "fastEffectsSpec": {"Either scheme": (1.0, 3800.0)},
    "defaultEffectsSpec": {"Either scheme": (1.0, 1600.0)},
    "slowEffectsSpec": {"Either scheme": (1.0, 800.0)},
}

# androidx.compose.animation.core.Spring
SPRING_CONST = {
    "DampingRatioNoBouncy": 1.0, "DampingRatioLowBouncy": 0.75,
    "DampingRatioMediumBouncy": 0.5, "DampingRatioHighBouncy": 0.2,
    "StiffnessHigh": 10_000.0, "StiffnessMedium": 1500.0,
    "StiffnessMediumLow": 400.0, "StiffnessLow": 200.0, "StiffnessVeryLow": 50.0,
}
EASINGS = {
    "FastOutSlowInEasing": (0.4, 0.0, 0.2, 1.0),
    "LinearOutSlowInEasing": (0.0, 0.0, 0.2, 1.0),
    "FastOutLinearInEasing": (0.4, 0.0, 1.0, 1.0),
    "LinearEasing": (0.0, 0.0, 1.0, 1.0),
}
# Spring.DefaultDisplacementThreshold, against a normalised 0→1 change. Compose ends a
# spring when |value - target| <= visibilityThreshold; there is no velocity term.
THRESHOLD = 0.01

SPEC_CALL = re.compile(r"\b((?:fast|default|slow)(?:Spatial|Effects)Spec)\s*\(\s*\)")
SPRING_LIT = re.compile(r"\bspring\s*(?:<[^>]*>)?\s*\(([^)]*)\)")
TWEEN_LIT = re.compile(r"\btween\s*(?:<[^>]*>)?\s*\(([^)]*)\)")


def _spring_at(zeta: float, omega: float, t: float) -> float:
    """Step response of x'' + 2ζωx' + ω²x = 0 from 0 to 1, released at rest."""
    if zeta < 1.0:
        wd = omega * math.sqrt(1.0 - zeta * zeta)
        return 1.0 - math.exp(-zeta * omega * t) * (
            math.cos(wd * t) + (zeta * omega / wd) * math.sin(wd * t))
    if abs(zeta - 1.0) < 1e-9:
        return 1.0 - math.exp(-omega * t) * (1.0 + omega * t)
    s = omega * math.sqrt(zeta * zeta - 1.0)
    r1, r2 = -zeta * omega + s, -zeta * omega - s
    return 1.0 - (r2 * math.exp(r1 * t) - r1 * math.exp(r2 * t)) / (r2 - r1)


def _bezier_at(p1x: float, p1y: float, p2x: float, p2y: float, x: float) -> float:
    """y for a given x on a cubic Bézier through (0,0) and (1,1)."""
    def bez(a: float, b: float, t: float) -> float:
        u = 1 - t
        return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t
    lo, hi = 0.0, 1.0
    for _ in range(40):
        mid = (lo + hi) / 2
        if bez(p1x, p2x, mid) < x:
            lo = mid
        else:
            hi = mid
    return bez(p1y, p2y, (lo + hi) / 2)


def _spring_trace(name: str, zeta: float, stiffness: float) -> dict:
    omega = math.sqrt(stiffness)
    samples, settle, peak, peak_t = [], 0, 0.0, 0
    for ms in range(0, 4001):
        x = _spring_at(zeta, omega, ms / 1000.0)
        samples.append((ms, x))
        if x > peak:
            peak, peak_t = x, ms
        if abs(x - 1.0) > THRESHOLD:
            settle = ms + 1
        elif ms > settle + 250:
            break
    # Overshoot below the visibility threshold is real in the maths and invisible on
    # screen; calling 0.2% "bouncy" would be the plot lying to look informative.
    over = max(0.0, peak - 1.0)
    facts = (f"ζ {zeta:g}, stiffness {stiffness:g} · settles {settle} ms · "
             + (f"overshoots {over * 100:.1f}% at {peak_t} ms"
                if over > THRESHOLD else "no visible overshoot"))
    tail = settle + max(30, settle // 5)
    return {"name": name, "samples": samples[:tail + 1], "settle": settle,
            "peak": peak, "facts": facts}


def _tween_trace(name: str, ms: int, easing: tuple) -> dict:
    samples = [(t, _bezier_at(*easing, t / ms) if ms else 1.0)
               for t in range(0, ms + 1)]
    return {"name": name, "samples": samples, "settle": ms, "peak": 1.0,
            "facts": f"{ms} ms, fixed — arrives on a clock, not on physics"}


def _svg(traces: list[dict]) -> str:
    """One plot, one trace per scheme. Time across, value up, target dashed at 1."""
    w, h = 620, 168
    pad_l, pad_r, pad_t, pad_b = 34, 12, 14, 24
    t_end = max(max(s[0] for s in tr["samples"]) for tr in traces)
    y_hi = max(1.06, max(tr["peak"] for tr in traces) + 0.06)
    y_lo = min(-0.04, min(min(s[1] for s in tr["samples"]) for tr in traces) - 0.04)

    def px(t: float) -> float:
        return pad_l + (w - pad_l - pad_r) * t / t_end

    def py(v: float) -> float:
        return pad_t + (h - pad_t - pad_b) * (y_hi - v) / (y_hi - y_lo)

    step = 100 if t_end <= 1000 else 200 if t_end <= 2400 else 500
    grid = "".join(
        f'<line x1="{px(t):.1f}" y1="{pad_t}" x2="{px(t):.1f}" y2="{h - pad_b}" '
        f'class="g"/><text x="{px(t):.1f}" y="{h - 8}" class="tick">{t}</text>'
        for t in range(step, int(t_end) + 1, step))
    rest = (f'<line x1="{pad_l}" y1="{py(1):.1f}" x2="{w - pad_r}" y2="{py(1):.1f}" '
            f'class="target"/><text x="{pad_l - 6}" y="{py(1) + 4:.1f}" '
            f'class="tick end">1.0</text>'
            f'<text x="{pad_l - 6}" y="{py(0) + 4:.1f}" class="tick end">0</text>')
    strokes = []
    for i, tr in enumerate(traces):
        every = max(1, len(tr["samples"]) // 300)
        pts = " ".join(f"{px(t):.1f},{py(v):.1f}"
                       for t, v in tr["samples"][::every])
        strokes.append(f'<polyline points="{pts}" class="c c{i}"/>')
    return (f'<svg class="curve" viewBox="0 0 {w} {h}" width="100%" '
            f'role="img" aria-label="{traces[0]["name"]} step response">'
            f'{grid}{rest}{"".join(strokes)}'
            f'<text x="{w - pad_r}" y="{h - 8}" class="tick end">ms</text></svg>')


def motion_specs(source: list[dict]) -> list[dict]:
    """Every animation spec named in the lines the finding points at."""
    text = "\n".join(line["text"] for line in source if line["hot"])
    out: list[dict] = []

    for token in dict.fromkeys(SPEC_CALL.findall(text)):
        variants = SCHEME_SPRINGS[token]
        traces = [_spring_trace(scheme, *pair) for scheme, pair in variants.items()]
        out.append({
            "label": f"{token}()",
            "note": ("Spatial springs differ by scheme and no fixture pins one, so both "
                     "are drawn: the same call is a different animation under each."
                     if len(traces) > 1 else
                     "Effects springs are identical in both schemes — swapping scheme "
                     "to change a fade does nothing."),
            "svg": _svg(traces),
            "facts": [f'{t["name"]}: {t["facts"]}' for t in traces],
        })

    for args in dict.fromkeys(SPRING_LIT.findall(text)):
        def arg(key: str, default: float) -> float | None:
            m = re.search(rf"{key}\s*=\s*([A-Za-z0-9_.]+)", args)
            if not m:
                return default if key not in args else None
            raw = m.group(1).split(".")[-1]
            if raw in SPRING_CONST:
                return SPRING_CONST[raw]
            try:
                return float(raw.rstrip("fF"))
            except ValueError:
                return None
        zeta, stiff = arg("dampingRatio", 1.0), arg("stiffness", 1500.0)
        if zeta is None or stiff is None:
            continue
        tr = _spring_trace("This spring", zeta, stiff)
        out.append({"label": f"spring({args.strip()})",
                    "note": "Written at the call site, so this is the whole definition.",
                    "svg": _svg([tr]), "facts": [tr["facts"]]})

    for args in dict.fromkeys(TWEEN_LIT.findall(text)):
        m = re.search(r"(?:durationMillis\s*=\s*)?(\d+)", args)
        if not m:
            continue
        ez = next((e for e in EASINGS if e in args), "FastOutSlowInEasing")
        tr = _tween_trace(f"tween · {ez}", int(m.group(1)), EASINGS[ez])
        out.append({"label": f"tween({args.strip()})",
                    "note": f"Easing {ez}" + (" (the default)"
                                              if ez == "FastOutSlowInEasing" else "."),
                    "svg": _svg([tr]), "facts": [tr["facts"]]})
    return out


def case_context(battery: str, case_id: int) -> dict:
    """What this case already says it is testing, and what it already covers.

    The question being asked is not "is this finding true" in the abstract. It is "should
    our labels for THIS case include it" — unanswerable without seeing the labels.
    """
    for p in EVALS.glob("evals*.json"):
        spec = json.loads(p.read_text())
        if spec.get("battery") != battery:
            continue
        case = next((c for c in spec["evals"] if c["id"] == case_id), None)
        if case is None:
            continue
        # The documents the reviewer was handed, in full. A finding that argues from
        # "MOTION.md says X" cannot be judged without reading whether it does.
        docs = []
        for rel in case.get("files", []):
            src = (EVALS.parent / rel).resolve()
            if src.suffix.lower() in (".md", ".json") and src.exists():
                docs.append({"name": src.name, "body": src.read_text()})
        return {
            "prompt": case.get("prompt", ""),
            "cls": case.get("class", ""),
            "docs": docs,
            "staged": [Path(f).name for f in case.get("files", [])],
            "expect": [f'{e["rule"]} {e["class"]} {Path(e["path"]).name}:'
                       f'{e["lines"][0]}-{e["lines"][1]}' for e in case.get("expect", [])],
            "negatives": [f'{Path(n["path"]).name}:{n["lines"][0]}-{n["lines"][1]} — '
                          f'{n.get("note", "")}' for n in case.get("negatives", [])],
        }
    return {}


def collect(reports: list[Path], arms: tuple[str, ...] = ("with-skill",)) -> list[dict]:
    """Findings outside every label, from the arms worth adjudicating.

    Defaults to the skill arm. The baseline arm is told to invent its own identifiers,
    so its unlabelled findings arrive as DESTINATION-MOTION-BINDING and OFFSET-VALUE-READ
    — real observations, but in a vocabulary that cannot be matched against our rules or
    written back into a battery file. Pass --all-arms to read them anyway.
    """
    items: dict[tuple, dict] = {}
    for rp in reports:
        for battery in json.loads(rp.read_text()):
            model = battery.get("model", rp.stem)
            for case in battery["cases"]:
                for arm, res in case["arms"].items():
                    if arm not in arms:
                        continue
                    for u in res.get("unlabeled", []):
                        key = (battery["battery"], case["case"], u["rule"],
                               Path(u["path"]).name, u["lines"][0], u["lines"][1])
                        it = items.setdefault(key, {
                            "battery": battery["battery"], "case": case["case"],
                            "rule": u["rule"], "class": u["class"],
                            "path": Path(u["path"]).name,
                            "start": u["lines"][0], "end": u["lines"][1],
                            "models": [], "note": "", "title": case.get("title", ""),
                        })
                        tag = f"{model} ({arm})"
                        if tag not in it["models"]:
                            it["models"].append(tag)
                        if not it["note"]:
                            for t in case.get("transcripts", {}).get(arm, []):
                                it["note"] = transcript_note(t, u["rule"], u["lines"][0])
                                if it["note"]:
                                    break
    out = []
    for it in items.values():
        it["rule_text"] = rule_text(it["rule"])
        it["ctx"] = case_context(it["battery"], it["case"])
        it["source"] = source_lines(it["path"], it["start"], it["end"])
        it["specs"] = motion_specs(it["source"])
        out.append(it)
    # Findings several models agree on are the ones most likely to be real.
    out.sort(key=lambda i: (-len(i["models"]), i["battery"], i["case"]))
    return out


def apply(decisions: list[dict]) -> list[str]:
    """Write the decisions into the battery files. Git is the undo of last resort."""
    log = []
    by_file: dict[Path, list[dict]] = {}
    for d in decisions:
        if d["verdict"] == "dismiss":
            continue
        for p in EVALS.glob("evals*.json"):
            spec = json.loads(p.read_text())
            if spec.get("battery") == d["battery"]:
                by_file.setdefault(p, []).append(d)
                break

    for p, ds in by_file.items():
        spec = json.loads(p.read_text())
        for d in ds:
            case = next((c for c in spec["evals"] if c["id"] == d["case"]), None)
            if case is None:
                continue
            entry = {"path": d["path"], "lines": [d["start"], d["end"]]}
            if d["verdict"] == "expect":
                case.setdefault("expect", []).append(
                    {**entry, "rule": d["rule"], "class": d["class"],
                     "severity": d.get("severity", "minor")})
                log.append(f"{p.name} case {d['case']}: + expect {d['rule']} "
                           f"{d['path']}:{d['start']}-{d['end']}")
            else:
                case.setdefault("negatives", []).append(
                    {**entry, "note": d.get("why") or "Adjudicated as correct code."})
                log.append(f"{p.name} case {d['case']}: + must-not-flag "
                           f"{d['path']}:{d['start']}-{d['end']}")
        p.write_text(json.dumps(spec, indent=2, ensure_ascii=False) + "\n")
    return log


PAGE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Eval queue</title>
<style>
  :root {
    --ink: #1a1c1e;
    --ink-soft: #55595e;
    --line: #d8d5cf;
    --page: #f7f5f2;
    --card: #fffefc;
    --hot: #fdf3d4;
    --keep: #17603a;
    --reject: #8a2e20;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--page);
    color: var(--ink);
    font: 16px/1.6 ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  header {
    display: flex; align-items: baseline; gap: 16px;
    padding: 20px 32px; border-bottom: 1px solid var(--line);
  }
  h1 { font-size: 17px; font-weight: 600; margin: 0; letter-spacing: -0.01em; }
  .count { color: var(--ink-soft); font-size: 15px; }
  main { max-width: 860px; margin: 0 auto; padding: 32px; }
  .where { color: var(--ink-soft); font-size: 15px; margin: 0 0 6px; }
  h2 { font-size: 26px; line-height: 1.25; margin: 0 0 4px; letter-spacing: -0.02em; }
  h2 .cls { color: var(--ink-soft); font-weight: 400; }
  .models { color: var(--ink-soft); font-size: 15px; margin: 0 0 20px; }
  h3 {
    font-size: 15px; font-weight: 600; margin: 32px 0 10px;
  }
  blockquote {
    margin: 0; padding: 0 0 0 16px; border-left: 2px solid var(--line);
    color: var(--ink); max-width: 68ch;
  }
  .rule { color: var(--ink-soft); max-width: 68ch; }
  .lede { max-width: 68ch; margin: 0 0 8px; }
  .labels, .choices { max-width: 68ch; padding-left: 20px; margin: 0; }
  details.doc { margin: 28px 0 0; }
  details.doc summary {
    font-size: 15px; font-weight: 600; cursor: pointer; padding: 4px 0;
  }
  .doc-body {
    margin-top: 10px; max-height: 22em; overflow: auto;
    font: 14px/1.7 ui-monospace, "SF Mono", Menlo, monospace;
    padding: 16px; white-space: pre-wrap; word-break: break-word;
  }
  .labels li, .choices li { margin-bottom: 8px; }
  .labels { color: var(--ink-soft); }
  .choices li b { font-weight: 600; }
  pre {
    margin: 0; padding: 16px 0; background: var(--card);
    border: 1px solid var(--line); border-radius: 6px; overflow-x: auto;
    font: 14px/1.7 ui-monospace, "SF Mono", Menlo, monospace;
  }
  .ln { display: block; padding: 0 16px; white-space: pre; }
  .ln.hot { background: var(--hot); }
  .ln .num {
    display: inline-block; width: 3.5ch; margin-right: 16px;
    color: var(--ink-soft); text-align: right; user-select: none;
  }
  .spec { margin: 14px 0 0; }
  .spec-head {
    font: 14px/1.6 ui-monospace, "SF Mono", Menlo, monospace; margin: 0 0 2px;
  }
  .spec-note { color: var(--ink-soft); font-size: 15px; margin: 0 0 8px; max-width: 68ch; }
  svg.curve {
    display: block; background: var(--card); border: 1px solid var(--line);
    border-radius: 6px;
  }
  svg.curve .g { stroke: var(--line); stroke-width: 1; }
  svg.curve .target {
    stroke: var(--ink-soft); stroke-width: 1; stroke-dasharray: 3 4; opacity: 0.7;
  }
  svg.curve .c { fill: none; stroke-width: 1.75; stroke-linejoin: round; }
  svg.curve .c0 { stroke: var(--ink); }
  svg.curve .c1 { stroke: var(--ink-soft); stroke-dasharray: 5 4; }
  svg.curve .tick {
    font: 11px ui-monospace, Menlo, monospace; fill: var(--ink-soft);
    text-anchor: middle;
  }
  svg.curve .tick.end { text-anchor: end; }
  .facts { margin: 8px 0 0; padding: 0; list-style: none; max-width: 68ch; }
  .facts li {
    font: 14px/1.7 ui-monospace, "SF Mono", Menlo, monospace; color: var(--ink-soft);
    padding-left: 26px; text-indent: -26px;
  }
  .facts li .t0::before,
  .facts li .t1::before {
    content: ""; display: inline-block; width: 18px; height: 0;
    border-top: 2px solid var(--ink); margin: 0 8px 4px 0; vertical-align: middle;
  }
  .facts li .t1::before { border-top-style: dashed; border-color: var(--ink-soft); }
  footer {
    position: sticky; bottom: 0; background: var(--page);
    border-top: 1px solid var(--line); padding: 14px 32px;
    display: flex; gap: 24px; flex-wrap: wrap;
    font-size: 15px; color: var(--ink-soft);
  }
  kbd {
    font: 600 13px/1 ui-monospace, Menlo, monospace; color: var(--ink);
    border: 1px solid var(--line); border-bottom-width: 2px; border-radius: 4px;
    padding: 3px 6px; background: var(--card);
  }
  .verdict { font-weight: 600; }
  .verdict.expect { color: var(--keep); }
  .verdict.negative { color: var(--reject); }
  .verdict.dismiss { color: var(--ink-soft); }
  .done { max-width: 68ch; }
  .done li { margin-bottom: 6px; }
</style>
</head>
<body>
<header>
  <h1>Eval queue</h1>
  <span class="count" id="count"></span>
  <span class="count" id="saved"></span>
</header>
<main id="main"></main>
<footer>
  <span><kbd>j</kbd> <kbd>k</kbd> move</span>
  <span><kbd>e</kbd> expected finding</span>
  <span><kbd>n</kbd> must not flag</span>
  <span><kbd>d</kbd> dismiss</span>
  <span><kbd>u</kbd> undo</span>
  <span><kbd>s</kbd> save &amp; apply</span>
</footer>
<script>
const ITEMS = __ITEMS__;
let at = 0;
const verdicts = new Array(ITEMS.length).fill(null);
const history = [];

const esc = s => String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));

function render() {
  const main = document.getElementById('main');
  document.getElementById('count').textContent =
    ITEMS.length ? `${at + 1} of ${ITEMS.length}` : 'nothing to adjudicate';
  const decided = verdicts.filter(Boolean).length;
  document.getElementById('saved').textContent =
    decided ? `${decided} decided` : '';

  if (!ITEMS.length) {
    main.innerHTML = '<p class="rule">No findings fell outside the labels in these ' +
      'reports. Either the fixtures hold or the models had a quiet day.</p>';
    return;
  }
  const it = ITEMS[at];
  const v = verdicts[at];
  main.innerHTML = `
    <p class="where">${esc(it.battery)} · case ${it.case}</p>
    <h2>Should ${esc(it.rule)} be a label on this case?</h2>
    <p class="lede">A reviewer reported <b>${esc(it.rule)}</b> at
      <b>${esc(it.path)}:${it.start}-${it.end}</b>. This case says nothing about that
      line, so the finding counts neither for nor against it. You are deciding whether it
      should.${v ? ` <span class="verdict ${v}">Currently: ${
        v === 'expect' ? 'required' : v === 'negative' ? 'must not flag' : 'left alone'
      }.</span>` : ''}</p>

    <h3>What this case is for</h3>
    <p class="rule"><i>${esc(it.title)}</i></p>
    <p class="rule">Asked: “${esc(it.ctx.prompt || '')}”${
      it.ctx.staged && it.ctx.staged.length
        ? ` Given: ${it.ctx.staged.map(esc).join(', ')}.` : ''}</p>
    <ul class="labels">
      <li><b>Must find:</b> ${it.ctx.expect && it.ctx.expect.length
        ? it.ctx.expect.map(esc).join('; ') : 'nothing — this case is precision only'}</li>
      <li><b>Must not flag:</b> ${it.ctx.negatives && it.ctx.negatives.length
        ? it.ctx.negatives.map(n => esc(n.split(' — ')[0])).join('; ') : 'nothing declared'}</li>
    </ul>

    ${(it.ctx.docs || []).map(d => `
      <details class="doc" open>
        <summary>What <b>${esc(d.name)}</b> told the reviewer</summary>
        <pre class="doc-body">${esc(d.body)}</pre>
      </details>`).join('')}

    <h3>What the reviewer said</h3>
    ${it.note ? `<blockquote>${esc(it.note)}</blockquote>`
              : '<p class="rule">No note captured for this finding.</p>'}

    <h3>The code it points at</h3>
    <pre>${it.source.map(l =>
      `<span class="ln${l.hot ? ' hot' : ''}"><span class="num">${l.n}</span>${esc(l.text)}</span>`
    ).join('')}</pre>

    ${(it.specs || []).length ? `
      <h3>How that moves</h3>
      <p class="rule">Computed from the same damping and stiffness the runtime uses, so
        the timing and the overshoot are exact. How it <i>feels</i> on a 40dp icon is
        still yours to judge.</p>
      ${it.specs.map(s => `
        <div class="spec">
          <p class="spec-head"><b>${esc(s.label)}</b></p>
          <p class="spec-note">${esc(s.note)}</p>
          ${s.svg}
          <ul class="facts">${s.facts.map((f, i) =>
            `<li><span class="t${i}"></span>${esc(f)}</li>`).join('')}</ul>
        </div>`).join('')}` : ''}

    ${it.rule_text && it.rule_text.title ? `
      <h3>${esc(it.rule)} — ${esc(it.rule_text.title)}</h3>
      <p class="rule">${esc(it.rule_text.claim)}</p>` : `
      <h3>${esc(it.rule)}</h3>
      <p class="rule">Not a rule in STANDARDS.md. If the reviewer invented this id, that is
      itself worth knowing — dismiss it here and raise it separately.</p>`}

    <h3>Your call</h3>
    <ul class="choices">
      <li><kbd>e</kbd> <b>It is right and every reviewer should find it.</b>
        Becomes a required finding: missing it counts as a miss from now on.</li>
      <li><kbd>n</kbd> <b>It is wrong; this code is fine.</b>
        Becomes a must-not-flag span: reporting it counts as a false positive.</li>
      <li><kbd>d</kbd> <b>Defensible, but not something to require or forbid.</b>
        Nothing changes; it stays unlabelled and unscored.</li>
    </ul>
  `;
  window.scrollTo(0, 0);
}

function decide(v) {
  if (!ITEMS.length) return;
  history.push([at, verdicts[at]]);
  verdicts[at] = v;
  if (at < ITEMS.length - 1) at++;
  render();
}

async function save() {
  const payload = ITEMS
    .map((it, i) => verdicts[i] ? {...it, verdict: verdicts[i]} : null)
    .filter(Boolean);
  const res = await fetch('/apply', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(payload)
  });
  const out = await res.json();
  document.getElementById('main').innerHTML =
    `<h2>Applied</h2><ul class="done">${
      out.log.length ? out.log.map(l => `<li>${esc(l)}</li>`).join('')
                     : '<li>Nothing to write — every item was dismissed.</li>'
    }</ul><p class="rule">Battery files rewritten. Check the diff before committing;
    run the validator with <code>--dry-run</code> to confirm the new spans land where
    you meant them.</p>`;
}

addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey) return;
  const k = e.key.toLowerCase();
  if (k === 'j' || e.key === 'ArrowDown') { at = Math.min(at + 1, ITEMS.length - 1); render(); }
  else if (k === 'k' || e.key === 'ArrowUp') { at = Math.max(at - 1, 0); render(); }
  else if (k === 'e') decide('expect');
  else if (k === 'n') decide('negative');
  else if (k === 'd') decide('dismiss');
  else if (k === 'u') { const h = history.pop(); if (h) { [at, verdicts[at]] = [h[0], h[1]]; render(); } }
  else if (k === 's') save();
  else return;
  e.preventDefault();
});
render();
</script>
</body>
</html>
"""


def _lan_ip() -> str:
    """Best guess at the address another machine should use."""
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("192.0.2.1", 9))  # TEST-NET-1, routes nowhere
        return s.getsockname()[0]
    except Exception:
        return socket.gethostname()
    finally:
        s.close()


def main() -> int:
    args = sys.argv[1:]
    arms = ("baseline", "with-skill") if "--all-arms" in args else ("with-skill",)
    # Fixed by default so an ssh tunnel command stays the same between runs.
    port = 8765
    # Loopback by default: this page rewrites battery files, so it is not something to
    # expose by accident. --lan binds every interface for reviewing from another machine.
    host = "0.0.0.0" if "--lan" in args else "127.0.0.1"
    for a in args:
        if a.startswith("--port="):
            port = int(a.split("=", 1)[1])
        elif a.startswith("--host="):
            host = a.split("=", 1)[1]
    paths = [Path(p) for p in args if not p.startswith("--")]
    if not paths:
        print(__doc__.strip().splitlines()[0], file=sys.stderr)
        print("\nusage: ./scripts/eval-queue.py <report.json> [more.json ...]",
              file=sys.stderr)
        return 64

    items = collect([p for p in paths if p.exists()], arms)
    print(f"{len(items)} finding(s) to adjudicate", file=sys.stderr)
    body = PAGE.replace("__ITEMS__", json.dumps(items)).encode()

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            n = int(self.headers.get("Content-Length", 0))
            decisions = json.loads(self.rfile.read(n) or b"[]")
            log = apply(decisions)
            for line in log:
                print("  " + line, file=sys.stderr)
            out = json.dumps({"log": log}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(out)))
            self.end_headers()
            self.wfile.write(out)

        def log_message(self, *a):
            pass

    socketserver.TCPServer.allow_reuse_address = True
    try:
        srv = socketserver.TCPServer((host, port), Handler)
    except OSError:
        srv = socketserver.TCPServer((host, 0), Handler)
        print(f"port {port} busy, using another", file=sys.stderr)
    with srv:
        shown = "127.0.0.1" if host in ("127.0.0.1", "localhost") else _lan_ip()
        url = f"http://{shown}:{srv.server_address[1]}/"
        print(f"open {url}   (ctrl-c when done)", file=sys.stderr)
        try:
            if host in ("127.0.0.1", "localhost"):
                webbrowser.open(url)
        except Exception:
            pass
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            print("\nstopped", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
