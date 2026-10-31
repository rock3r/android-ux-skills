# Perfetto measurement workflow for Compose motion

Use this workflow before and after any motion performance change. Every claim about frame
drops or smoothness must come from at least three release-build runs on a physical device.

For general Perfetto recording (`record_android_trace`, `cpu_profile`, heap dumps), warm
`trace_processor` daemon sessions, and system-wide triage (Binder stalls, thermal
throttling, LMK, waker chains), use [`android/skills` →
`profilers/android-profiler`](https://github.com/android/skills/tree/main/profilers/android-profiler).
This guide covers the Compose-specific build isolation, transition windowing, and
`RenderThread` slice attribution that layer on top of `android-profiler`.

## Contents

1. [Isolate the test application ID and compile for perf
   A/Bs](#1-isolate-the-test-application-id-and-compile-for-perf-abs)
2. [Separate frame-measurement runs from cause-finding
   runs](#2-separate-frame-measurement-runs-from-cause-finding-runs)
3. [Extract FrameTimeline, UI-thread, and RenderThread
   metrics](#3-extract-frametimeline-ui-thread-and-renderthread-metrics)
4. [Guard against common measurement
   traps](#4-guard-against-common-measurement-traps)
5. [Read the dominant slice in each slow
   frame](#5-read-the-dominant-slice-in-each-slow-frame)

## 1. Isolate the test application ID and compile for perf A/Bs

First-run transitions, onboarding flows, and cold GPU pipeline tests require `adb shell pm
clear`, which wipes app data. On a shared development phone, use a `benchmark` build
variant or pass a temporary Gradle `--init-script` that hooks `finalizeDsl` to append
`.perf` after the module's `android {}` block is evaluated:

```groovy
// /tmp/perf-id.gradle — passed via ./gradlew assembleRelease --init-script /tmp/perf-id.gradle
allprojects {
    plugins.withId("com.android.application") {
        extensions.getByName("androidComponents").finalizeDsl { ext ->
            ext.buildTypes.named("release") {
                it.applicationIdSuffix = "${it.applicationIdSuffix ?: ""}.perf"
                it.signingConfig = ext.signingConfigs.named("debug").get()
            }
        }
    }
}
```

Never commit the init script or hardcode the `.perf` suffix in tracked build files. Note
that plain `extensions.configure(ApplicationExtension)` in an init script runs when the
plugin is applied, before the module's own `build.gradle.kts`, so the module's DSL block
silently overwrites any scalar flags set there (`applicationId`, `isMinifyEnabled`,
`isDebuggable`). Always mutate DSL properties inside `androidComponents.finalizeDsl` (or
via `-P` project properties) and verify the packaged application ID (`aapt2 dump
packagename <apk>`) before installing or clearing app data.

Fresh `adb install` runs in `verify` mode (`nterp` interpreter), adding `30–40%` to cold
start and first-time screen opens. For **performance A/B runs only** (never normal
development or functional test runs, where AOT slows the build-and-run loop), compile the
package ahead of time before recording:

```bash
adb shell cmd package compile -m speed com.example.app.perf
```

To ensure production users get compiled code on first launch, generate and ship an app
Baseline Profile (`baseline-prof.txt`) using the `androidx.baselineprofile` Gradle plugin
and `BaselineProfileRule`. The plugin runs against `nonMinifiedRelease` (release flags, R8
off so ART records unobfuscated symbol names). Never record a profile on a debug build.

## 2. Separate frame-measurement runs from cause-finding runs

AndroidX Tracing 2 (`androidx.tracing:tracing-wire` +
`androidx.compose.runtime:runtime-tracing`) emits thousands of composable slices during a
screen transition. That tracing overhead slows composition and skews frame durations.
Always use two distinct trace modes:

- **Frame-measurement mode (for A/B numbers):** Record a lightweight Perfetto trace with
  `sched`, `gfx`, `view`, `wm`, `input`, and `android.surfaceflinger.frametimeline`, with
  in-process Compose tracing turned off (`APP_TRACE=0` and no `track_event` data source).
- **Cause-finding mode (for attribution only):** Enable AndroidX Tracing 2 via
  `ConnectedProfilerTracingReceiver` broadcasts (`START`, `FLUSH_TRACES_GET_PATH`, `STOP`)
  and append the pulled `CLOCK_BOOTTIME` trace to the system trace. Alternatively, sample
  callstacks with `linux.perf` on an unobfuscated R8 release build (`-dontobfuscate`).

Create a lightweight `trace.pbtx` for frame-measurement runs:

```protobuf
buffers: { size_kb: 65536 fill_policy: RING_BUFFER }
buffers: { size_kb: 4096  fill_policy: RING_BUFFER }
data_sources: {
  config {
    name: "linux.ftrace"
    ftrace_config {
      ftrace_events: "sched/sched_switch"
      ftrace_events: "sched/sched_wakeup"
      ftrace_events: "power/cpu_frequency"
      atrace_categories: "gfx"
      atrace_categories: "view"
      atrace_categories: "wm"
      atrace_categories: "input"
      atrace_categories: "am"
      atrace_categories: "binder_driver"
      atrace_apps: "*"
    }
  }
}
data_sources: { config { name: "android.surfaceflinger.frametimeline" } }
duration_ms: 12000
```

Script the interaction so every transition starts at a known offset from the trace start.
Leave `1.5–2.0 s` between scripted taps so spring tails and background prewarm work finish
inside their own time window:

```bash
#!/usr/bin/env bash
set -euo pipefail
PKG="com.example.app.perf"
ACT="com.example.app.MainActivity"

for run in 1 2 3; do
  adb shell pm clear "$PKG" >/dev/null
  adb push trace.pbtx /data/local/tmp/trace.pbtx >/dev/null
  adb shell perfetto --txt -c /data/local/tmp/trace.pbtx \
    -o /data/misc/perfetto-traces/run.perfetto-trace &
  TRACE_PID=$!
  sleep 0.5

  adb shell am start -W -n "$PKG/$ACT" >/dev/null
  sleep 1.8
  adb shell input tap 540 2180   # Window 1: t=2.3..3.8s
  sleep 1.8
  adb shell input tap 540 2180   # Window 2: t=4.1..5.6s
  wait "$TRACE_PID"
  adb pull /data/misc/perfetto-traces/run.perfetto-trace "before_${run}.perfetto-trace"
done
```

## 3. Extract FrameTimeline, UI-thread, and RenderThread metrics

Run the bundled `android-ux trace` analyzer across the baseline and post-fix trace files
(requires Perfetto's standalone `trace_processor_shell` v58+; verify host setup with `sh
"$SKILL_PATH/scripts/android-ux" doctor --for trace`). Pass `--window name:start:end` for
each scripted interaction window, or omit `--window` to auto-detect interaction bursts:

```bash
SKILL_PATH=/path/to/skills/optimize-android-motion
sh "$SKILL_PATH/scripts/android-ux" trace \
  --process com.example.app.perf \
  --window "Step1_to_Step2:2.2:3.8" \
  --window "Step2_to_Step3:4.0:5.6" \
  --compare before_1.perfetto-trace before_2.perfetto-trace before_3.perfetto-trace \
  -- after_1.perfetto-trace after_2.perfetto-trace after_3.perfetto-trace
```

At `120 Hz`, a frame budget is `8.33 ms`; at `60 Hz`, the budget is `16.67 ms`. Compare
SurfaceFlinger `FrameTimeline` jank counts (`app_jank`, `any_jank` excluding `Buffer
Stuffing`, and `late` frames) across interleaved A/B runs (`A B A B`). Also compare UI and
`RenderThread` frames over `8.33 ms` along with median and `p90` durations.

## 4. Guard against common measurement traps

1. **Verify animation scales and foreground focus before and after every run:** UI-test
   runners or concurrent sessions can leave `animator_duration_scale`,
   `transition_animation_scale`, or `window_animation_scale` at `0`. Check all three equal
   `1.0` and `dumpsys window | grep mCurrentFocus` matches the target package before and
   after every trace.
2. **Match all `upid`s for the package and filter track events by `upid`:** Never select
   the target process with `ORDER BY upid DESC LIMIT 1`; that drops earlier processes
   across cold starts. In merged AndroidX Tracing 2 files, filter `slice` rows by
   `coalesce(t.upid, pt.upid)` to exclude other processes.
3. **Arm `ConnectedProfilerTracingReceiver` before launching the Activity:**
   `ConnectedProfilerTracingInitializer` installs the recording tracer when the process
   starts. Always run `am force-stop <pkg>`, send the
   `androidx.tracing.profiler.action.START` broadcast (which persists the enabled flag),
   and then run `am start -W` so composition tracing records from Frame 1.
4. **Do not use `dumpsys gfxinfo` percentiles or single-run `uiMax` at `120 Hz`:**
   `gfxinfo` uses `1 ms` pipeline buckets (`p50 ≈ 10 ms` on a smooth `120 Hz` fling), and
   `uiMax` varies by `±10 ms` across identical runs. Stepping idle loops to `60 fps` also
   shifts total frame counts; judge changes by `FrameTimeline` jank counts instead.
5. **Treat small `linux.perf` sample counts as hypotheses, not cost estimates:** In a
   short interaction (`30–50` samples), a leaf function taking `10–30%` of samples can
   still yield `0 ms` change in an A/B trace. Read leaf frames rather than R8-merged
   lambda hosts (`ExternalSyntheticLambda`), and verify candidates with `-m speed` A/B
   runs.
6. **Require `trace_processor` v58+ on Android 16/17 traces:** Older prebuilts (such as
   v54) fail on Android 17 `AndroidMessageQueue` proto fields.
7. **Avoid first-install shader noise, `uiautomator dump`, and buffer overflow:**
   Reinstalling an APK clears the Vulkan pipeline cache, causing one-time
   `CreateGraphicsPipeline` misses on the first open. Never run `uiautomator dump` during
   a traced run: it attaches an accessibility `UiAutomation` session that forces
   `AndroidComposeView` to walk and serialize the semantics tree (`AccessibilityNodeInfo`
   allocation and Binder IPC on the UI thread) and blocks on window-idle checks, skewing
   frame timings. Look up tap coordinates once before the measurement loop, then drive
   traced runs with plain `input tap` / `input swipe`. Keep phone traces under `40 s`
   (`~3 MB/s` overflows a `128 MB` ring buffer).

## 5. Read the dominant slice in each slow frame

Use the dominant child slice inside `Choreographer#doFrame` and `DrawFrames` to pick the
fix category:

| Slice in Perfetto | Thread | Meaning and next action |
|---|---|---|
| `Recomposer:recompose` | UI thread | Synchronous data work, wide recomposition from state reads, or first-time subtree mount. Move data prep out of composition and narrow state reads; as a last resort on bounded flows, precompose the target step. |
| `AndroidOwner:measureAndLayout` | UI thread | Animated size/padding in composition, per-frame `SubcomposeLayout` (such as `BoxWithConstraints`), or changing constraints across a shared container. |
| `AndroidOwner:draw` | UI thread | Object initialization or allocation inside a per-frame draw lambda (such as `Path`, `Morph`, or `Brush`), an invalidated `drawWithCache` scope, or hundreds of individual draw calls. |
| `alpha caused saveLayer` / `flush layers` | `RenderThread` | Offscreen layer allocated or toggled mid-animation (for example, an overshooting spring crossing `alpha = 1f`). Use non-overshooting effects springs for alpha and hold `CompositingStrategy.Offscreen` across translucent subtrees. |
| `CreateGraphicsPipeline-CompileAfterCacheMiss` | `RenderThread` | First-time Vulkan shader compilation (such as complex paths, gradients, or non-uniform scale matrices). Simplify primitives or hold `CompositingStrategy.Offscreen`; as a last resort, prewarm on a covered frame. |
| `relayoutWindow#first=true` | UI thread | New platform window (such as `Dialog`, `ModalBottomSheet` — [issuetracker 574117772](https://issuetracker.google.com/issues/574117772), or `Popup`) attaching on frame 1. Keep initial sheet/dialog content lightweight and skip off-screen canvas draws while hidden. |
