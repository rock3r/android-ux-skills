# RenderThread, saveLayer, and GPU pipeline patterns

Read this reference when Perfetto shows `RenderThread` stalls (`DrawFrames`, `flush
layers`, `alpha caused saveLayer`, or `CreateGraphicsPipeline-CompileAfterCacheMiss`
exceeding `8.33 ms`) or when `AndroidOwner:draw` spends more than `3 ms` recording canvas
commands.

## Contents

1. [Prewarm GPU pipelines and text layouts](#1-prewarm-gpu-pipelines-and-text-layouts)
2. [Prevent mid-animation saveLayer
   transitions](#2-prevent-mid-animation-savelayer-transitions)
3. [Defeat ModalBottomSheet non-uniform scale shader
   stalls](#3-defeat-modalbottomsheet-non-uniform-scale-shader-stalls)
4. [Cache geometry objects per canvas size](#4-cache-geometry-objects-per-canvas-size)
5. [Collapse dense procedural draws and optimize heavy AGSL
   shaders](#5-collapse-dense-procedural-draws-and-optimize-heavy-agsl-shaders)
6. [Step down expensive ambient redraws to 60
   fps](#6-step-down-expensive-ambient-redraws-to-60-fps)

## 1. Prewarm GPU pipelines and text layouts

Skia and Vulkan compile graphics pipelines lazily the first time a draw operation
(`CircleOp`, `TriangulatingPathOp`, `DrawAtlasPathOp`, `FillRRectOp`, or
`CircularRRectOp`) is flushed on `RenderThread`. If a complex illustration, shape morph,
or picker card becomes visible for the first time mid-entrance,
`CreateGraphicsPipeline-CompileAfterCacheMiss` can stall `RenderThread` for `35–140 ms`.

Render one covered frame at the target size while the preceding screen is idle, then
unmount the prewarm composable on the next frame:

```kotlin
@Composable
internal fun ScenePrewarm(targetSize: Dp) {
    var armed by remember { mutableStateOf(true) }
    if (!armed) return
    LaunchedEffect(Unit) {
        withFrameNanos { }
        armed = false
    }
    Box(
        Modifier
            .size(targetSize)
            .clearAndSetSemantics {}
            .graphicsLayer { alpha = PrewarmAlpha }
    ) {
        SceneCanvas(Modifier.fillMaxSize().graphicsLayer {
            compositingStrategy = CompositingStrategy.Offscreen
        })
        SceneCanvas(Modifier.fillMaxSize())
    }
}

private const val PrewarmAlpha = 0.004f
```

Never use `alpha = 0f` for GPU prewarming: Android's `RenderNode` skips flushing display
lists when `alpha == 0f`. Keep `armed` in `remember` rather than a process-global `var` so
process restoration or device recreation re-warms pipelines when the GPU context resets.

## 2. Prevent mid-animation saveLayer transitions

Crossing between `alpha == 1f` (`flush commands`) and `0f < alpha < 1f` (`flush layers`,
logged as `alpha caused saveLayer`) changes HWUI's render target mid-animation. HWUI
allocates an offscreen texture and compiles a second set of Vulkan pipelines (`36–78 ms`
stall).

An underdamped spring (`dampingRatio = 0.5f`) driving `artAlpha` to `1f` overshoots `1f`
and then undershoots back to `0.94f–0.98f` mid-reveal. That dip below `1f` triggers a
`saveLayer` allocation right as inner scene layers appear:

```kotlin
// Latch alpha at 1f once the pop reaches the card so spring undershoot never drops < 1f.
var reachedFullAlpha by remember { mutableStateOf(false) }
val rawAlpha = ((popProgress() - FadeStart) / (1f - FadeStart)).coerceIn(0f, 1f)
if (rawAlpha >= 1f) reachedFullAlpha = true
val artAlpha = if (reachedFullAlpha) 1f else rawAlpha

Box(
    Modifier.graphicsLayer {
        val s = popScale()
        scaleX = s
        scaleY = s
        alpha = artAlpha
        compositingStrategy = if (s != 1f || artAlpha < 1f) {
            CompositingStrategy.Offscreen
        } else {
            CompositingStrategy.Auto
        }
    }
)
```

## 3. Defeat ModalBottomSheet non-uniform scale shader stalls

When Material 3's `ModalBottomSheet` overshoots its `Expanded` anchor, it applies
`.verticalScaleUp(state)` to the `Surface` ($H_1$) and `.verticalScaleDown(state)` to the
inner `Column` ($H_2 = H_1 - \text{insets}$). Because $H_1 \neq H_2$, the scales do not
cancel, leaving a non-uniform vertical scale ($s_y \neq 1.0, s_x = 1.0$) on every child.

That non-uniform scale flips Skia's matrix from `kTranslate_Mask` to `kScale_Mask`. Skia
then compiles elliptical Vulkan pipelines (`EllipseOp`, `EllipticalRRectOp`, `100+ ms`
stall) and re-rasterizes vector paths on every bounce frame.

Composite the sheet body into a single offscreen layer while the sheet is moving, and skip
heavy canvas drawing on Frame 1 while the sheet is still `SheetValue.Hidden` off-screen:

```kotlin
val sheetMoving = sheetState.targetValue != sheetState.currentValue ||
    sheetState.currentValue != SheetValue.Expanded
val sheetVisible = sheetState.currentValue != SheetValue.Hidden ||
    sheetState.targetValue != SheetValue.Hidden

Column(
    Modifier.graphicsLayer {
        compositingStrategy = if (sheetMoving) {
            CompositingStrategy.Offscreen
        } else {
            CompositingStrategy.Auto
        }
    }
) {
    if (sheetVisible) {
        SheetIllustrations()
    }
}
```

## 4. Cache geometry objects per canvas size

Do not build `Morph(startPolygon, endPolygon)`, call `RoundedPolygon.toPath()`, run
boolean `Path.op(a, b, PathOperation.Difference)`, or allocate `Brush.verticalGradient`
inside `onDraw`. Those allocations cost `4–32 ms` per frame on the UI thread. Reading a
frame-rate animation clock inside the outer `Modifier.drawWithCache` lambda is equally
expensive because it invalidates the cache on every frame.

Cache unit-square `RoundedPolygon` shapes once at the file level. Build size-dependent
`Path`, `Brush`, and `Stroke` objects inside `drawWithCache` (keyed on `size` and theme
colors), and read animation progress (`() -> Float`) inside `onDrawWithContent`:

```kotlin
Modifier.drawWithCache {
    val geometry = buildSceneGeometry(size, palette) // runs only when size changes
    val scratchPath = Path()
    onDrawWithContent {
        val progress = entranceProgress()            // read in draw phase only
        if (progress <= 0f) return@onDrawWithContent
        drawScene(geometry, scratchPath, progress)
    }
}
```

## 5. Collapse dense procedural draws and optimize heavy AGSL shaders

Drawing hundreds of individual canvas primitives per frame (such as a 3D halftone dot grid
or a scrolling header scrim that redraws a sky scene) saturates `AndroidOwner:draw` and
`RenderThread` `IssueDrawCommands`.

- For procedural dot grids and globes, replace per-dot `drawCircle` loops with one
  `RuntimeShader` (`AGSL` on API 33+) drawn in a single `drawRect` call.
- For scrolling header fade-outs, render the illustration inside
  `CompositingStrategy.Offscreen` and draw a sliding `BlendMode.DstIn` alpha mask at the
  bottom edge instead of redrawing a gradient scrim each frame.

Moving work into `AGSL` can trade CPU canvas overhead for GPU fragment saturation. UI
`doFrame` and `RenderThread` `DrawFrame` can look fast (`< 2 ms`) while `FrameTimeline`
reports `App Deadline Missed` and `Buffer Stuffing`. When `postAndWait` (`3–5 ms`) and
`dequeueBuffer` (`8–12 ms`) appear on `RenderThread`, the fragment shader is starving the
BufferQueue.

First, reject inactive pixels as cheaply as possible before running transcendental math or
texture lookups:

```glsl
// Reject pixels outside the maximum dot radius before asin/atan2/BitmapShader lookups.
vec2 cellUv = fract(fragCoord / cellSize) - 0.5;
if (dot(cellUv, cellUv) > maxDotRadiusSq) {
    return half4(0.0);
}
```

Early-out culling is only a first step. If `FrameTimeline` still reports janky frames at
`120 Hz`, run a full optimization pass on the shader itself:

- Hoist frame-constant rotation matrices and trig terms to CPU `setFloatUniform` calls.
- Replace per-pixel `asin`, `atan2`, or `pow` calls with a 1D/2D lookup texture (LUT) or a
  low-order polynomial approximation.
- Render the procedural effect into a lower-resolution offscreen target when the visual
  grid is coarse.

## 6. Step down expensive ambient redraws to 60 fps

Do not cap frame rates across animations in general. Step down an endless ambient
animation to `60 fps` only when its redraw is expensive, such as when it forces
SurfaceFlinger to composite a full-window buffer (`1080×2400`) at `120 Hz`.

For standard composables, pair `Modifier.preferredFrameRate(60f)` with `.graphicsLayer()`
so the `RenderNode` votes for `60 Hz` when no sibling animates at `120 Hz`:

```kotlin
Canvas(
    Modifier
        .size(size)
        .preferredFrameRate(60f)
        .graphicsLayer()
) {
    drawAmbientGlow(phase = phaseValue)
}
```

Inside `LazyVerticalGrid` or `LazyColumn`, an upstream Compose `SubcomposeLayout` /
`TraversableNode` bug prevents `Modifier.preferredFrameRate(60f)` from propagating to the
root view. Until the upstream bug is resolved, advance the animation clock with a
deadline-based frame gate (and link the upstream issue in a code comment):

```kotlin
// Workaround for upstream Compose SubcomposeLayout preferredFrameRate propagation bug.
private const val FrameStep60HzNanos = 16_000_000L

@Composable
internal fun rememberThrottledPhase(periodMs: Int): State<Float> {
    val phase = remember { mutableFloatStateOf(0f) }
    LaunchedEffect(periodMs) {
        var nextFrameNs = 0L
        var startNs = 0L
        while (isActive) {
            withFrameNanos { frameNs ->
                if (startNs == 0L) startNs = frameNs
                if (frameNs >= nextFrameNs) {
                    nextFrameNs = frameNs + FrameStep60HzNanos
                    val elapsedMs = (frameNs - startNs) / 1_000_000f
                    phase.floatValue = (elapsedMs % periodMs) / periodMs
                }
            }
        }
    }
    return phase
}
```
