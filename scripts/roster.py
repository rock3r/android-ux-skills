"""Shared model-roster handling: which models to use, and which are actually reachable.

Imported by run-evals.py and read-evals.py so the rule that a pass uses at least two
models lives in one place rather than being re-asserted, differently, in each.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ROSTER = ROOT / "scripts" / "model-roster.json"


def load(tier: str = "arms") -> tuple[list[dict], int]:
    spec = json.loads(ROSTER.read_text())
    if tier not in spec:
        raise SystemExit(f"error: no tier {tier!r} in {ROSTER.name}")
    return spec[tier], spec.get("min_models_per_pass", 2)


def available_ids() -> set[str]:
    """Everything `pi` can currently reach, as provider/id.

    A roster entry is an intention. Credentials expire, providers run out of credit, and a
    family that works on one machine 403s on another — discovering that here is better than
    discovering it halfway through a paid run.
    """
    if not shutil.which("pi"):
        raise SystemExit(
            "error: 'pi' is not on PATH.\n"
            "  If it is installed under nvm, this shell has not loaded it."
        )
    proc = subprocess.run(["pi", "--list-models"], capture_output=True, text=True)
    if proc.returncode != 0:
        return set()

    ids: set[str] = set()
    for line in proc.stdout.splitlines()[1:]:
        parts = line.split()
        if len(parts) >= 2:
            ids.add(f"{parts[0]}/{parts[1]}")
    return ids


def resolve(requested: str | None, tier: str, want: int,
            allow_single: bool = False, check_reachable: bool = True) -> list[dict]:
    """The models to use: an explicit list, or the first reachable ones from a tier.

    Refuses to proceed with one model unless told to. A single model's habits are
    indistinguishable from the thing being measured, and a lone reading is one opinion
    wearing the clothes of a conclusion.
    """
    entries, minimum = load(tier)

    if requested:
        chosen = []
        for item in [m.strip() for m in requested.split(",") if m.strip()]:
            model, _, thinking = item.partition(":")
            chosen.append({"model": model, "thinking": thinking or "high",
                           "family": model})
    elif not check_reachable:
        # A plan runs nothing, so what this machine can reach is beside the point. CI has
        # no pi at all, and asking it failed every push from the day this was added.
        chosen = list(entries)[:want or minimum]
    else:
        reachable = available_ids()
        chosen = [e for e in entries if e["model"] in reachable][:want or minimum]
        skipped = [e["model"] for e in entries if e["model"] not in reachable]
        if skipped:
            print(f"roster: {len(skipped)} entry(ies) not reachable here — "
                  f"{', '.join(skipped[:3])}{'…' if len(skipped) > 3 else ''}",
                  file=sys.stderr)

    # One family twice is one opinion twice.
    seen, unique = set(), []
    for e in chosen:
        if e.get("family", e["model"]) in seen:
            continue
        seen.add(e.get("family", e["model"]))
        unique.append(e)

    if len(unique) < minimum and not allow_single:
        raise SystemExit(
            f"error: only {len(unique)} model(s) available from the {tier} tier, and a "
            f"pass uses at least {minimum}.\n"
            f"  Measuring against one model measures that model's habits as much as the "
            f"thing under test.\n"
            f"  Name models explicitly, or pass --allow-single if you accept that."
        )
    return unique


def label(entry: dict) -> str:
    """A filename-safe tag, so one run's outputs do not overwrite another's."""
    return entry["model"].replace("~", "").replace("/", "-").replace(":", "-")
