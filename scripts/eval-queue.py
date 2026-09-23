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


def rule_text(rule: str) -> str:
    """The rule's claim from STANDARDS.md, so a decision can be made without leaving."""
    body = (ROOT / "STANDARDS.md").read_text()
    m = re.search(rf"^### {re.escape(rule)} — (.+?)$(.*?)(?=^### |\Z)",
                  body, re.M | re.S)
    if not m:
        return ""
    claim = re.search(r"\*\*Claim\.\*\*\s*(.+?)(?=\n\n)", m.group(2), re.S)
    return f"{m.group(1).strip()}\n\n{' '.join(claim.group(1).split()) if claim else ''}"


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
        it["source"] = source_lines(it["path"], it["start"], it["end"])
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
  .models { color: var(--ink-soft); font-size: 15px; margin: 0 0 28px; }
  h3 {
    font-size: 15px; font-weight: 600; margin: 32px 0 10px;
  }
  blockquote {
    margin: 0; padding: 0 0 0 16px; border-left: 2px solid var(--line);
    color: var(--ink); max-width: 68ch;
  }
  .rule { color: var(--ink-soft); max-width: 68ch; }
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
    <p class="where">${esc(it.battery)} · case ${it.case} · ${esc(it.title)}</p>
    <h2>${esc(it.rule)} <span class="cls">${esc(it.class)}</span></h2>
    <p class="models">${esc(it.path)}:${it.start}-${it.end} · reported by
      ${esc(it.models.join(', '))}${v ? ` · <span class="verdict ${v}">${
        v === 'expect' ? 'marked expected' :
        v === 'negative' ? 'marked must-not-flag' : 'dismissed'}</span>` : ''}</p>
    ${it.note ? `<h3>What the reviewer said</h3><blockquote>${esc(it.note)}</blockquote>` : ''}
    <h3>The code</h3>
    <pre>${it.source.map(l =>
      `<span class="ln${l.hot ? ' hot' : ''}"><span class="num">${l.n}</span>${esc(l.text)}</span>`
    ).join('')}</pre>
    ${it.rule_text ? `<h3>${esc(it.rule)} says</h3><p class="rule">${esc(it.rule_text)}</p>` : ''}
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


def main() -> int:
    args = sys.argv[1:]
    arms = ("baseline", "with-skill") if "--all-arms" in args else ("with-skill",)
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

    with socketserver.TCPServer(("127.0.0.1", 0), Handler) as srv:
        url = f"http://127.0.0.1:{srv.server_address[1]}/"
        print(f"open {url}   (ctrl-c when done)", file=sys.stderr)
        try:
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
