#!/usr/bin/env python3
"""Summarize UI-thread, RenderThread, and FrameTimeline jank from Perfetto traces.

Queries `Choreographer#doFrame` (and its `Recomposer:recompose`,
`AndroidOwner:measureAndLayout`, and `AndroidOwner:draw` child slices), `RenderThread`
(`DrawFrames`, `alpha caused saveLayer`, `CreateGraphicsPipeline-CompileAfterCacheMiss`),
and `actual_frame_timeline_slice` across explicit `--window NAME:START_SEC:END_SEC` ranges
or auto-detected interaction bursts separated by `--burst-gap-ms` (default 800 ms).

Usage:
    python3 scripts/analyze_motion_trace.py --process com.example.app.perf \\
        before_1.perfetto-trace after_1.perfetto-trace
"""

from __future__ import annotations

import argparse
import csv
import io
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Window:
    name: str
    start_sec: float
    end_sec: float


def parse_window(spec: str) -> Window:
    parts = spec.split(":")
    if len(parts) != 3:
        raise argparse.ArgumentTypeError(
            f"invalid --window '{spec}'; expected NAME:START_SEC:END_SEC"
        )
    try:
        start = float(parts[1])
        end = float(parts[2])
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"invalid window bounds in '{spec}'") from exc
    if end <= start:
        raise argparse.ArgumentTypeError(f"window end must exceed start in '{spec}'")
    return Window(name=parts[0], start_sec=start, end_sec=end)


def _find_trace_processor_shell() -> str | None:
    prebuilts = Path.home() / ".local/share/perfetto/prebuilts"
    candidates: list[Path] = []
    if prebuilts.is_dir():
        for p in sorted(
            prebuilts.glob("trace_processor_shell*"),
            key=lambda x: x.stat().st_mtime,
            reverse=True,
        ):
            if p.is_file() and not p.name.endswith(".sha256"):
                candidates.append(p)
    for name in ("trace_processor_shell", "trace_processor"):
        found = shutil.which(name)
        if found:
            candidates.append(Path(found))
    for c in candidates:
        if c.is_file():
            return str(c)
    return None


class SqlRunner:
    """Runs Perfetto SQL via `perfetto.trace_processor` or `trace_processor_shell`."""

    def __init__(self, trace_path: Path) -> None:
        self.trace_path = trace_path
        self._tp = None
        self._shell: str | None = None
        try:
            from perfetto.trace_processor import TraceProcessor  # type: ignore

            self._tp = TraceProcessor(trace=str(trace_path))
            return
        except ImportError:
            pass

        self._shell = _find_trace_processor_shell()
        if not self._shell:
            raise SystemExit(
                "error: neither the Python `perfetto` package nor `trace_processor_shell` "
                "was found.\nInstall with: pip install perfetto"
            )

    def query(self, sql: str) -> list[dict[str, str]]:
        if self._tp is not None:
            rows: list[dict[str, str]] = []
            for r in self._tp.query(sql):
                d = r.__dict__
                rows.append({k: str(v) if v is not None else "" for k, v in d.items()})
            return rows

        assert self._shell is not None
        proc = subprocess.run(
            [self._shell, "-Q", sql, str(self.trace_path)],
            capture_output=True,
            text=True,
            check=True,
        )
        reader = csv.DictReader(io.StringIO(proc.stdout))
        return [
            {k.strip('"'): (v.strip('"') if v is not None else "") for k, v in row.items()}
            for row in reader
        ]


def detect_bursts(
    runner: SqlRunner,
    process_substr: str,
    gap_sec: float,
    min_frames: int = 5,
) -> list[Window]:
    proc_filter = (
        f"AND p.name LIKE '%{process_substr}%'" if process_substr else ""
    )
    sql = f"""
    WITH bounds AS (SELECT start_ts FROM trace_bounds)
    SELECT (s.ts - (SELECT start_ts FROM bounds)) / 1e9 AS t_sec
    FROM slice s
    JOIN thread_track tt ON s.track_id = tt.id
    JOIN thread t USING (utid)
    JOIN process p USING (upid)
    WHERE t.is_main_thread = 1
      {proc_filter}
      AND s.name LIKE 'Choreographer#doFrame%'
      AND NOT EXISTS (
        SELECT 1 FROM slice p
        WHERE p.id = s.parent_id AND p.name LIKE 'Choreographer#doFrame%'
      )
    ORDER BY s.ts
    """
    times = [float(r["t_sec"]) for r in runner.query(sql)]
    bursts: list[list[float]] = []
    for t in times:
        if not bursts or (t - bursts[-1][-1]) > gap_sec:
            bursts.append([t])
        else:
            bursts[-1].append(t)

    windows: list[Window] = []
    idx = 1
    for b in bursts:
        if len(b) < min_frames:
            continue
        windows.append(
            Window(name=f"burst_{idx}", start_sec=max(0.0, b[0] - 0.02), end_sec=b[-1] + 0.05)
        )
        idx += 1
    return windows or [Window(name="full_trace", start_sec=0.0, end_sec=9999.0)]


def analyze_window(
    runner: SqlRunner,
    process_substr: str,
    window: Window,
    budget_ms: float,
    top_n: int,
) -> None:
    proc_filter = (
        f"AND p.name LIKE '%{process_substr}%'" if process_substr else ""
    )
    ui_sql = f"""
    WITH bounds AS (SELECT start_ts FROM trace_bounds)
    SELECT
      s.id AS id,
      (s.ts - (SELECT start_ts FROM bounds)) / 1e9 AS t_sec,
      s.dur / 1e6 AS dur_ms,
      s.track_id AS track_id,
      s.ts AS ts,
      s.dur AS dur
    FROM slice s
    JOIN thread_track tt ON s.track_id = tt.id
    JOIN thread t USING (utid)
    JOIN process p USING (upid)
    WHERE t.is_main_thread = 1
      {proc_filter}
      AND s.name LIKE 'Choreographer#doFrame%'
      AND NOT EXISTS (
        SELECT 1 FROM slice p
        WHERE p.id = s.parent_id AND p.name LIKE 'Choreographer#doFrame%'
      )
      AND (s.ts - (SELECT start_ts FROM bounds)) / 1e9
          BETWEEN {window.start_sec} AND {window.end_sec}
    ORDER BY s.dur DESC
    """
    frames = runner.query(ui_sql)
    durs = [float(r["dur_ms"]) for r in frames]
    over_budget = sum(1 for d in durs if d > budget_ms)
    over_16 = sum(1 for d in durs if d > 16.67)
    max_ui = max(durs, default=0.0)

    rt_sql = f"""
    WITH bounds AS (SELECT start_ts FROM trace_bounds)
    SELECT
      COUNT(CASE WHEN s.name LIKE 'DrawFrame%' THEN 1 END) AS draw_count,
      COUNT(CASE WHEN s.name LIKE 'DrawFrame%' AND s.dur / 1e6 > {budget_ms} THEN 1 END) AS rt_over_budget,
      COALESCE(MAX(CASE WHEN s.name LIKE 'DrawFrame%' THEN s.dur / 1e6 END), 0) AS max_rt_ms,
      COUNT(CASE WHEN s.name LIKE '%alpha caused saveLayer%' THEN 1 END) AS save_layers,
      COUNT(CASE WHEN s.name LIKE 'CreateGraphicsPipeline-CompileAfterCacheMiss%' THEN 1 END) AS shader_misses,
      COALESCE(SUM(CASE WHEN s.name LIKE 'CreateGraphicsPipeline-CompileAfterCacheMiss%' THEN s.dur / 1e6 END), 0) AS shader_ms,
      COALESCE(MAX(CASE WHEN s.name LIKE 'dequeueBuffer%' THEN s.dur / 1e6 END), 0) AS max_dequeue_ms
    FROM slice s
    JOIN thread_track tt ON s.track_id = tt.id
    JOIN thread t USING (utid)
    JOIN process p USING (upid)
    WHERE t.name = 'RenderThread'
      {proc_filter}
      AND (s.ts - (SELECT start_ts FROM bounds)) / 1e9
          BETWEEN {window.start_sec} AND {window.end_sec}
    """
    rt_rows = runner.query(rt_sql)
    rt = rt_rows[0] if rt_rows else {}

    sf_sql = f"""
    WITH bounds AS (SELECT start_ts FROM trace_bounds)
    SELECT
      COUNT(*) AS sf_frames,
      SUM(CASE WHEN a.jank_type GLOB '*App Deadline Missed*' THEN 1 ELSE 0 END) AS app_jank,
      SUM(CASE WHEN a.jank_type != 'None' AND a.jank_type != 'Buffer Stuffing' THEN 1 ELSE 0 END) AS any_jank,
      SUM(CASE WHEN a.on_time_finish = 0 THEN 1 ELSE 0 END) AS late
    FROM actual_frame_timeline_slice a
    JOIN process p USING (upid)
    WHERE 1 = 1
      {proc_filter}
      AND (a.ts - (SELECT start_ts FROM bounds)) / 1e9
          BETWEEN {window.start_sec} AND {window.end_sec}
    """
    sf_rows = runner.query(sf_sql)
    sf = sf_rows[0] if sf_rows else {}

    print(
        f"  [{window.name} {window.start_sec:.2f}..{window.end_sec:.2f}s] "
        f"UI: {len(durs)} frames, >{budget_ms:.1f}ms={over_budget}, >16.7ms={over_16}, "
        f"max={max_ui:.2f}ms | "
        f"RT: max={float(rt.get('max_rt_ms') or 0):.2f}ms, "
        f">{budget_ms:.1f}ms={rt.get('rt_over_budget', '0')}, "
        f"saveLayers={rt.get('save_layers', '0')}, "
        f"shaderMisses={rt.get('shader_misses', '0')} "
        f"({float(rt.get('shader_ms') or 0):.2f}ms), "
        f"maxDequeue={float(rt.get('max_dequeue_ms') or 0):.2f}ms | "
        f"SF: frames={sf.get('sf_frames') or '0'}, "
        f"appJank={sf.get('app_jank') or '0'}, "
        f"anyJank={sf.get('any_jank') or '0'}, "
        f"late={sf.get('late') or '0'}"
    )

    for r in frames[:top_n]:
        dur_ms = float(r["dur_ms"])
        if dur_ms <= budget_ms:
            break
        t_sec = float(r["t_sec"])
        track_id = r["track_id"]
        ts = r["ts"]
        dur = r["dur"]
        sub_sql = f"""
        SELECT name, SUM(dur) / 1e6 AS total_ms
        FROM slice
        WHERE track_id = {track_id}
          AND ts >= {ts}
          AND ts + dur <= {int(ts) + int(dur)}
          AND name IN (
            'Recomposer:recompose',
            'AndroidOwner:measureAndLayout',
            'AndroidOwner:draw',
            'relayoutWindow#first=true'
          )
        GROUP BY name
        """
        subs = {sr["name"]: float(sr["total_ms"]) for sr in runner.query(sub_sql)}
        recomp = subs.get("Recomposer:recompose", 0.0)
        measure = subs.get("AndroidOwner:measureAndLayout", 0.0)
        draw = subs.get("AndroidOwner:draw", 0.0)
        print(
            f"    t={t_sec:.3f}s doFrame={dur_ms:.2f}ms "
            f"(recompose={recomp:.2f}ms, measure={measure:.2f}ms, draw={draw:.2f}ms)"
        )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("traces", nargs="+", type=Path, help="Perfetto trace files")
    parser.add_argument(
        "--process",
        default="",
        help="Process name substring filter (for example com.example.app.perf)",
    )
    parser.add_argument(
        "--window",
        action="append",
        type=parse_window,
        default=[],
        help="Time window NAME:START_SEC:END_SEC (repeatable; auto-detects bursts when omitted)",
    )
    parser.add_argument(
        "--burst-gap-ms",
        type=float,
        default=800.0,
        help="Idle gap in ms used to split auto-detected bursts (default: 800)",
    )
    parser.add_argument(
        "--budget-ms",
        type=float,
        default=8.33,
        help="Frame budget in milliseconds (default: 8.33 for 120 Hz)",
    )
    parser.add_argument(
        "--top",
        type=int,
        default=3,
        help="Max over-budget UI frames to expand per window (default: 3)",
    )
    args = parser.parse_args()

    for trace in args.traces:
        if not trace.is_file():
            raise SystemExit(f"error: trace file not found: {trace}")
        print(f"=== {trace.name} ===")
        runner = SqlRunner(trace)
        windows = args.window or detect_bursts(
            runner, args.process, args.burst_gap_ms / 1000.0
        )
        for w in windows:
            analyze_window(runner, args.process, w, args.budget_ms, args.top)


if __name__ == "__main__":
    main()
