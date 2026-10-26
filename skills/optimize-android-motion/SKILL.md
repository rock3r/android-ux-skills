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
transitions, shape morphs, overlays, and sheets. Start with the simplest, highest-leverage
fixes before reaching for specialized workarounds:

1. **Data pipeline first:** Fixing bad data handling (moving synchronous transformations,
   sorting, formatting, or I/O out of composition into ViewModels or background flows, and
   avoiding unrelated `UiState` emissions mid-transition) almost always brings cleaner,
   larger wins than band-aids in the UI layer.
2. **Composition and phase deferral second:** Apply standard Compose hygiene
   (`jetpack-compose-performance`) and the mechanical floor rules in
   `references/standards.md` (`F-001`, `F-002`, `F-005`, `F-008`, `F-009`): defer
   frame-rate state reads to layout (`offset { IntOffset(...) }`) and draw
   (`graphicsLayer`, `drawWithCache`), match `remember` scopes to data lifetime, narrow
   recomposition scopes, and make long scrollable content lazy.
3. **Last-resort workarounds for composition, layout, or GPU side effects:** The advanced
   patterns in this skill's references (off-screen deck precomposition, non-disposing
   layout slots, bitmap snapshots, and manual GPU shader prewarming) are a rulebook for
   when a release-build Perfetto trace shows that the data pipeline and composition are
   already clean, and the remaining lag comes purely from unavoidable side effects of
   mounting a complex tree, measuring cold text (`Minikin`), or compiling GPU shaders
   mid-animation.

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
3. **Separate UI-thread stalls, `RenderThread` stalls, and GPU buffer starvation.** When
   `Choreographer#doFrame` is fast but `DrawFrames` exceeds the frame budget, the bottleneck
   is a GPU pipeline or `saveLayer` stall on `RenderThread`. When `doFrame` blocks in
   `postAndWait` and `RenderThread` blocks in `dequeueBuffer`, the GPU is starving the
   buffer queue.
4. **Fix the data pipeline and composition cost before reaching for workarounds.** Never
   time-slice a slow screen by mounting its sections across consecutive `withFrameNanos`
   ticks during a transition, and do not keep every top-level screen permanently composed.
   Do not introduce precomposition or shader prewarming until you have eliminated
   synchronous data work and composition-phase state reads.
5. **Preserve disabled-animation behavior and accessibility (`O-001`, `F-005`).** Hidden
   precomposed or transitioning surfaces must block TalkBack semantics, pointer input, and
   focus. Self-timed prewarm or shader loops must read `MotionDurationScale`.

## Workflow

1. **Capture three baseline traces.** Build a release APK with an isolated
   `applicationId`, drive the interaction with `adb shell input`, and pull three
   `.perfetto-trace` files per `references/perfetto-workflow.md`.
2. **Analyze UI-thread and `RenderThread` slices.** Run `scripts/analyze_motion_trace.py`
   on the baseline traces to get the over-budget frame count, worst
   `Choreographer#doFrame`, worst `DrawFrames`, and dominant child slices.
3. **Fix the root cause before reaching for workarounds.** Address data-pipeline work and
   standard composition/phase-deferral issues first. If the trace still shows frame drops
   caused by first-time mount, layout, or GPU compilation side effects, apply the matching
   pattern in `references/transition-and-layout-patterns.md` or
   `references/gpu-and-canvas-pipeline.md`.
4. **Verify with three post-fix traces and screenshot tests.** Run the same trace script
   three times on the updated release APK and compare the median and worst frames against
   baseline. Run unit and screenshot tests to confirm visual and accessibility parity.

## Diagnose from the trace signature

Once you have a trace, use the dominant thread and slice in the slow frames to identify the
root cause and select the simplest effective fix:

| Symptom or Perfetto signature | Root cause | Fix (root cause → last resort) |
|---|---|---|
| First visit to a destination or step spikes `Recomposer:recompose` + `measureAndLayout` | The incoming destination runs synchronous data setup, composes a large non-lazy tree, or pays cold `Minikin` text layout and path setup on frame 1. | Warm UI state in the ViewModel, hoist allocations, and make long lists lazy. **Last resort:** for bounded flows, precompose steps in one `Layout`, keep inactive steps off-screen and inert, and warm them on idle frames (`references/transition-and-layout-patterns.md`). |
| First-run morph or `SeekableTransitionState` cuts straight to the middle of the motion | The transition clock advances on the frame the target mounts, before layout resolves its bounds. | Gate clock advancement until the incoming target completes its first layout pass (`references/transition-and-layout-patterns.md`). |
| Consecutive frames exceed budget in `measureAndLayout` while a bar, keyboard, or header animates | Animated size or padding is applied in composition (`F-008`), `BoxWithConstraints` runs `subcompose()` each frame, or a parent `Layout` passes changing `Constraints` to a shared deck. | Defer offsets and insets to `Modifier.layout` or `offset { IntOffset(...) }`, track `WindowInsets.ime` continuously, and measure shared decks at constant `Constraints` (`references/transition-and-layout-patterns.md`). |
| UI-thread spike when changing UI state (such as going in or out of an overlay, search mode, or collapsible pane) | Unrelated `UiState` fields mutate mid-transition, focus clear and state change split across frames, or `AnimatedVisibility` / `AnimatedContent` disposes and recreates a heavy subtree. | Coalesce state and focus updates in one frame and narrow recomposition scopes. **Last resort:** keep frequently toggled subtrees composed in a non-disposing `FoldingSlot` (`inertWhen` folded) (`references/transition-and-layout-patterns.md`). |
| Root screen recomposes on frame 1 of every state transition or exit animation, or transition setup allocates heavily | Root composable unpacks transition state by value, scatters many individual `State<T>` / lambda parameters (`rememberUpdatedState`, `derivedStateOf`), or mutates `UiState` (such as `isSaving = true`) as an exit starts. | Group related transition/layout state into a single `@Stable` state holder (`remember`ed once, with plain fields for synchronous pass-through state; see [aosp/4318506](https://android-review.googlesource.com/c/platform/frameworks/support/+/4318506)), read animated values in leaf scopes, and keep save state out of `UiState` during exits (`references/transition-and-layout-patterns.md`). |
| `RenderThread` stalls mid-reveal in `CreateGraphicsPipeline` or `alpha caused saveLayer` | Complex vector/canvas art flushes for the first time mid-entrance, or an underdamped spring crosses `alpha = 1.0f` and toggles HWUI `flush layers`. | Simplify draw primitives, use non-overshooting effects springs (`defaultEffectsSpec()`) for alpha, and hold `CompositingStrategy.Offscreen` across overlapping translucent children. **Last resort:** prewarm one covered frame at rest (`references/gpu-and-canvas-pipeline.md`). |
| `RenderThread` stalls in `CreateGraphicsPipeline` when `ModalBottomSheet` bounces at its top anchor | Upstream `ModalBottomSheet` scale modifiers leave a non-uniform vertical scale ($s_y \neq 1.0$) when insets are present ([issuetracker 576993363](https://issuetracker.google.com/issues/576993363)), forcing Skia (`kScale_Mask`) to compile elliptical shaders. | Skip heavy canvas draws while `SheetValue.Hidden` ([issuetracker 574117772](https://issuetracker.google.com/issues/574117772)). **Last resort:** hold `CompositingStrategy.Offscreen` on sheet content while `sheetState` is moving (`references/gpu-and-canvas-pipeline.md`). |
| Every frame of a canvas animation or scroll spends excessive time in `AndroidOwner:draw` | `drawWithCache` reads a frame clock in its outer cache scope, per-frame draw lambdas (`onDraw`, `onDrawWithContent`) initialize or allocate objects (such as `Morph`, `Path`, or `Brush`), or the canvas emits hundreds of individual draw calls. | Initialize objects in the `drawWithCache` cache scope, read animation state inside the draw lambda, and collapse dense procedural loops into an AGSL `RuntimeShader` or `BlendMode.DstIn` mask (`references/gpu-and-canvas-pipeline.md`). |
| Full-screen theme or style transition (cross-fade, circular reveal) drops every frame in `Recomposer:recompose` | Animating `ColorScheme` or theme values per frame recomposes every reader across the window on every vsync. | If only a local surface changes color, read the animated color inside a draw lambda (`drawBehind`). **Last resort:** for full-window theme switches on static screens, snapshot the outgoing screen once via `rememberGraphicsLayer().toImageBitmap()`, switch the theme in one recomposition, and animate the bitmap overlay while blocking input (`references/transition-and-layout-patterns.md`). |
| Lazy-list fling or item switch spikes in composition and text layout | Per-item `remember` recomputes screen-level or theme-level values during prefetch, or `key(selectedItem)` destroys a canvas component's `rememberTextMeasurer()`. | Match `remember` scope to data lifetime (hoist theme/screen computations above the list) and keep stateful canvas components mounted across item switches (`references/transition-and-layout-patterns.md`). |
| Main thread blocks in `postAndWait` and `RenderThread` blocks in `dequeueBuffer`, or an idle screen redraws at `120 Hz` | A full-window AGSL shader saturates the GPU, or an ambient animation invalidates a wide area on every `120 Hz` vsync. | Add cheap early-out checks in AGSL followed by a full shader optimization pass (CPU uniforms, LUTs, simpler math), and isolate ambient redraws to a bounded `graphicsLayer()`. **Last resort:** step down expensive ambient loops to `60 fps` (`references/gpu-and-canvas-pipeline.md`). |

## Gotchas

- **Do not reach for last-resort workarounds before fixing the root cause.** Never
  time-slice a slow screen across frames (mounting section 1 on frame 1 and section 2 on
  frame 2 via `withFrameNanos`) to lower single-frame `uiMax`; splitting composition across
  fade-in frames increases total missed vsyncs (`FrameTimeline` jank). Fix the data
  pipeline and composition cost instead.
- **Why transitioning or off-screen surfaces need `inertWhen` instead of `enabled = false`:**
  Passing `enabled = false` to controls during a transition alters their visual appearance
  (switching to disabled colors and alphas mid-animation) and is not supported by arbitrary
  layout containers. Conversely, `Modifier.clearAndSetSemantics {}` hides a subtree from
  TalkBack without changing visuals, and `focusProperties { canFocus = false }` prevents
  focus traversal from entering it, but neither blocks touch or hardware key events reaching
  a descendant that already held focus when the transition started. Combine
  `clearAndSetSemantics {}`, `focusProperties { canFocus = false }`,
  `onPreviewKeyEvent { true }`, and a `PointerEventPass.Initial` pointer consumer when
  keeping a hidden or snapshotted surface mounted.
- **When forced to prewarm a GPU pipeline, `alpha = 0f` is a no-op:** Android's
  `RenderNode` skips display-list flushing when `alpha == 0f`, so Vulkan defers shader
  compilation to the first visible frame. Use a tiny non-zero alpha (`0.004f`) or draw at
  full alpha under an opaque cover, and store the `armed` flag in plain `remember` (not
  `rememberSaveable`, which would skip prewarming after process death when native caches are
  cold, and not a process-global `var`, which would skip prewarming when a window is
  recreated).
- **Custom `TextAutoSize` step sizes shift glyph metrics:** Replacing
  `TextAutoSize.StepBased` with a coarser step size (such as `0.5.sp` instead of
  `StepBased`'s `0.25.sp`) changes rendered glyph metrics at large font scales and breaks
  screenshot goldens. If you add a fast path that checks `maxFontSize` first, delegate
  overflow cases to `TextAutoSize.StepBased`.
- **Separate platform window and library floors from app code:** Compose `Dialog`,
  `ModalBottomSheet` ([issuetracker 574117772](https://issuetracker.google.com/issues/574117772)),
  and `Popup` pay a one-time platform window creation cost on Frame 1
  (`relayoutWindow#first=true`), and an open `Popup` ticks `BroadcastFrameClock` on every
  vsync to poll anchor coordinates. Optimize app-owned content and file upstream issues for
  library bottlenecks rather than hacking around framework state.

## References and scripts

- Read `references/perfetto-workflow.md` before building a test APK or recording Perfetto
  traces on a physical device.
- Read `references/transition-and-layout-patterns.md` when fixing UI-thread spikes in
  `Recomposer:recompose`, `measureAndLayout`, `SubcomposeLayout`, or state transitions.
- Read `references/gpu-and-canvas-pipeline.md` when fixing `RenderThread` stalls in
  `DrawFrames`, `saveLayer`, `CreateGraphicsPipeline`, `ModalBottomSheet`, or `Canvas`.
- Read `references/standards.md` when checking the shared floor, obligation, and taste
  rules (`F-001` through `F-010`, `O-001` through `O-003`).
- Run `scripts/analyze_motion_trace.py` on `.perfetto-trace` files to summarize
  `Choreographer#doFrame` and `RenderThread` slices across transition time windows.
