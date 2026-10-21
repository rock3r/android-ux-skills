---
name: optimize-android-motion
description: >
  Trace, diagnose, and fix dropped frames, first-visit stutters, and per-frame
  measurement or GPU stalls in Android Jetpack Compose animations and transitions.
  Use when a screen transition, reveal, shape morph, expandable surface, or bottom
  sheet lags or drops frames on device.
license: Apache-2.0
tags:
  - motion
  - android
  - compose
  - performance
  - perfetto
metadata:
  version: "0.1.0"
---

# Optimizing Android motion

## Initial response

When invoked with no target or trace, reply with this sentence:

> Share the transition composable or Perfetto trace you want to optimize.

## Scope

This skill diagnoses and fixes frame drops in Jetpack Compose animations, screen
transitions, shape morphs, expandable panes, and sheets. It enforces the mechanical floor
rules in `references/standards.md` (`F-001`, `F-002`, `F-005`, `F-008`, `F-009`) and
covers the layout, subcomposition, and `RenderThread` bottlenecks that remain after code
already uses lambda modifiers.

Route other questions to the matching skill:

| Question | Skill |
|---|---|
| Should this element animate, and with which token spec? | `animate-compose` |
| Does this pull request follow `MOTION.md` and `STANDARDS.md`? | `review-android-motion` |
| What motion conventions exist across this repository? | `improve-android-motion` |
| Static Compose checks (stability, `computedStateOf`, lazy `key`/`contentType`, `Modifier.Node`) | [`android/skills` → `jetpack-compose-performance`](https://github.com/android/skills/tree/main/jetpack-compose/jetpack-compose-performance) |
| General Perfetto recording, heap/CPU profiles, Binder/LMK/thermal triage, and SQL stdlib | [`android/skills` → `android-profiler`](https://github.com/android/skills/tree/main/profilers/android-profiler) |

## Hard rules

1. **Measure before and after on a release build (`F-009`).** Capture at least three
   Perfetto runs on a physical device before editing code and three runs after. For
   performance A/B checks only (not normal development), run `adb shell cmd package
   compile -m speed <pkg>` first to remove JIT noise. Keep Compose composition tracing off
   during frame-timing runs.
2. **Isolate the test build's application ID on shared devices.** Use a benchmark build
   variant or a temporary Gradle `--init-script` that appends `.perf` to `applicationId`.
   This keeps installed user data untouched during `pm clear` or scripted UI loops.
3. **Separate UI-thread stalls, `RenderThread` stalls, and GPU buffer starvation.** A `40
   ms` frame where `Choreographer#doFrame` takes `2 ms` and `DrawFrames` takes `38 ms` is
   a GPU pipeline or `saveLayer` stall on `RenderThread`. When `doFrame` blocks in
   `postAndWait` and `RenderThread` blocks in `dequeueBuffer`, the GPU is starving the
   buffer queue.
4. **Reduce destination composition cost at the source.** Never stagger non-lazy sibling
   sections across active transition frames or keep every top-level screen permanently
   composed. Keep ViewModels and UI models warm, hoist heavy allocations, and make long
   scrollable content lazy.
5. **Preserve disabled-animation behavior and accessibility (`O-001`, `F-005`).** Hidden
   precomposed surfaces must block TalkBack semantics, pointer input, and focus.
   Self-timed prewarm or shader loops must read `MotionDurationScale`.

## Diagnose from the trace signature

Pair every symptom with the thread and slice that take the most time in the slow frame:

| Symptom or Perfetto signature | Root cause | Fix and reference |
|---|---|---|
| First visit to a step or tab drops `15–40 ms` in `Recomposer:recompose` + `measureAndLayout` | The incoming step mounts, measures text (`Minikin` cold miss), and builds paths on frame 1 of the transition. | Precompose bounded steps in one `Layout`, keep inactive steps off-screen and inert, and warm them one per idle frame. See `references/transition-and-layout-patterns.md`. |
| First-run morph or `SeekableTransitionState` cuts straight to the middle of the motion | The transition clock advances on the frame the target mounts, before its bounds exist. | Gate clock advancement until the incoming target completes one layout pass. See `references/transition-and-layout-patterns.md`. |
| `20–30` consecutive frames `> 8.3 ms` while a search bar, keyboard, or header folds | Parent `Layout` passes animated height in `Constraints` to a precomposed deck, or `BoxWithConstraints` runs `subcompose()` each frame. | Measure the deck at constant `Constraints.fixed(width, height)` and apply the animated inset in `Modifier.layout` only on the active step. See `references/transition-and-layout-patterns.md`. |
| `25–35 ms` UI-thread spike when pressing Back to close inline search or an expanded pane | `AnimatedVisibility` or `AnimatedContent` disposed folded nodes on open and recreates them on Back, or focus clear and collapse split across two frames. | Keep folded slots composed in a `FoldingSlot` (`inertWhen` folded) and coalesce `focusManager.clearFocus()` with state updates in one `SideEffect`. See `references/transition-and-layout-patterns.md`. |
| Root screen recomposes on frame 1 of every step change or exit takeoff | Root composable reads `state.step` by value, or the exit action mutates `UiState` (`isSaving = true`) as the animation starts. | Pass `State<Step>` to leaf consumers, keep save state out of `UiState` during exits, and latch initial morph origins. See `references/transition-and-layout-patterns.md`. |
| `30–80 ms` `RenderThread` stall mid-reveal (`CreateGraphicsPipeline` + `alpha caused saveLayer`) | Art starts at `alpha = 0f` (skipped by HWUI) and flushes mid-entrance, or an underdamped spring undershoots `1.0f` and flips to `flush layers`. | Prewarm one covered frame at rest, latch `artAlpha` at `1f` after reveal, and hold `CompositingStrategy.Offscreen` while `scale != 1f`. See `references/gpu-and-canvas-pipeline.md`. |
| `80–120 ms` `RenderThread` stall when `ModalBottomSheet` bounces at its top anchor | `ModalBottomSheet`'s `.verticalScaleUp` ($H_1$) and `.verticalScaleDown` ($H_2 = H_1 - \text{insets}$) leave $s_y \neq 1.0$, forcing Skia (`kScale_Mask`) to compile scaled shaders. | Set `CompositingStrategy.Offscreen` on sheet content while `sheetState` is moving, and skip canvas draws while `SheetValue.Hidden`. See `references/gpu-and-canvas-pipeline.md`. |
| Every frame of a canvas reveal or scroll spends `4–15 ms` in `AndroidOwner:draw` | `drawWithCache` reads a frame clock in its cache body, `onDraw` builds `Morph` or `Path` objects, or the canvas emits hundreds of primitives. | Read clocks only inside `onDrawWithContent`, cache `SceneGeometry` per size, and collapse dense draws into an AGSL `RuntimeShader` or `BlendMode.DstIn` mask. See `references/gpu-and-canvas-pipeline.md`. |
| Full-screen theme or style transition (cross-fade, circular reveal) drops `25+` frames `> 8.3 ms` | Animating `ColorScheme` or theme values per frame recomposes every reader across the window on every tick. | Capture the static outgoing screen once via `rememberGraphicsLayer().toImageBitmap()`, switch the theme in one recomposition, and animate the bitmap overlay while blocking input (note that ongoing motion pauses on the snapshot). See `references/transition-and-layout-patterns.md`. |
| Cold lazy-list fling or item/day switch drops `15–35 ms` in composition and text layout | Per-item `remember` recomputes theme-wide values (`4×` per frame in `keepAroundItems`), or `key(selectedItem)` destroys a canvas component's `rememberTextMeasurer()`. | Match `remember` scope to data lifetime (hoist theme/screen-level computations above the list) and keep canvas components mounted across item switches. See `references/transition-and-layout-patterns.md`. |
| Main thread blocks in `postAndWait` and `RenderThread` blocks in `dequeueBuffer`, or an idle screen redraws at `120 Hz` | A full-window AGSL shader saturates the GPU, or an expensive ambient wave/rotation invalidates the window on every `120 Hz` vsync. | Add cheap early-out cell/radius checks in AGSL followed by a full shader pass (LUTs, cheaper math, CPU uniforms), and step down expensive ambient loops to `60 fps` (`preferredFrameRate` or `FrameGate(60)` in lazy lists). See `references/gpu-and-canvas-pipeline.md`. |

## Workflow

1. **Capture three baseline traces.** Build a release APK with an isolated
   `applicationId`, drive the interaction with `adb shell input`, and pull three
   `.perfetto-trace` files per `references/perfetto-workflow.md`.
2. **Analyze UI-thread and `RenderThread` slices.** Run `scripts/analyze_motion_trace.py`
   on the baseline traces to get the over-budget frame count (`> 8.33 ms` at 120 Hz),
   worst `Choreographer#doFrame`, worst `DrawFrames`, and dominant child slices.
3. **Apply the targeted fix.** Use `references/transition-and-layout-patterns.md` for
   composition, subcomposition, and measurement spikes, or
   `references/gpu-and-canvas-pipeline.md` for `RenderThread`, `saveLayer`, shader
   compilation, and canvas draw stalls.
4. **Verify with three post-fix traces and screenshot tests.** Run the same trace script
   three times on the updated release APK and compare the median and worst frames against
   baseline. Run unit and screenshot tests to confirm visual and accessibility parity.

## Gotchas

- `alpha = 0f` does not warm GPU pipelines. Android's `RenderNode` skips display-list
  flushing when `alpha == 0f`, so Vulkan defers shader compilation to the first visible
  frame. Use a tiny non-zero alpha (`0.004f`) or draw at full alpha under an opaque cover.
- A process-global `var prewarmed = true` breaks after process death or configuration
  change when the GPU context is discarded. Store prewarm state in `remember` so a fresh
  composition re-warms its pipelines.
- `Modifier.clearAndSetSemantics {}` hides a precomposed off-screen step from TalkBack,
  but does not block touch or hardware keyboard focus. Pair it with a
  `PointerEventPass.Initial` consumer and `focusProperties { canFocus = false }`.
- Replacing `TextAutoSize.StepBased` with a custom step size (such as `0.5.sp` instead of
  `StepBased`'s `0.25.sp`) changes rendered glyph metrics at `1.3x` and `1.5x` font scales
  and breaks screenshot goldens. If you add a fast path that checks `maxFontSize` first,
  delegate overflow cases to `TextAutoSize.StepBased`.
- Do not stagger non-lazy sibling sections across active transition frames to lower
  `uiMax`. Mounting one section per frame during a fade-in halves the peak frame (`61.5 →
  34.5 ms`) but increases total missed vsyncs (`5.0 → 8.4` FrameTimeline jank). Fix why
  the destination is slow to compose instead.
- Separate platform window and library floors from app code. Compose `Dialog`,
  `ModalBottomSheet`, and `Popup` pay a `12–15 ms` window creation floor on Frame 1, and
  an open `Popup` ticks `BroadcastFrameClock` at `120 Hz` to poll anchor coordinates. File
  upstream issues for library bottlenecks and link any local workaround to the bug.

## References and scripts

- Read `references/perfetto-workflow.md` before building a test APK or recording Perfetto
  traces on a physical device.
- Read `references/transition-and-layout-patterns.md` when fixing UI-thread spikes in
  `Recomposer:recompose`, `measureAndLayout`, `SubcomposeLayout`, or Back navigation.
- Read `references/gpu-and-canvas-pipeline.md` when fixing `RenderThread` stalls in
  `DrawFrames`, `saveLayer`, `CreateGraphicsPipeline`, `ModalBottomSheet`, or `Canvas`.
- Read `references/standards.md` when checking the shared floor, obligation, and taste
  rules (`F-001` through `F-010`, `O-001` through `O-003`).
- Run `scripts/analyze_motion_trace.py` on `.perfetto-trace` files to summarize
  `Choreographer#doFrame` and `RenderThread` slices across transition time windows.
