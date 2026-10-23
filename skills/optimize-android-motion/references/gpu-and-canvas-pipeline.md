# RenderThread, saveLayer, and GPU pipeline patterns

Read this reference when Perfetto shows `RenderThread` stalls (`DrawFrames`, `flush
layers`, `alpha caused saveLayer`, or `CreateGraphicsPipeline-CompileAfterCacheMiss`
exceeding the frame budget) or when `AndroidOwner:draw` spends excessive time recording
canvas commands.

Start with standard drawing hygiene before reaching for lower-level GPU workarounds:

1. **Initialize objects in the cache scope and defer clock reads:** Do not initialize or
   allocate non-trivial objects inside per-frame draw lambdas (`onDraw`, `onDrawBehind`,
   `onDrawWithContent`). Build size- or theme-dependent objects in the `drawWithCache`
   cache scope (or `remember`), read frame-rate animation state inside the draw lambda,
   and use non-overshooting effects springs (`defaultEffectsSpec()`) for opacity so alpha
   never bounces across `1.0f`.
2. **Manage offscreen layers and shader complexity:** Hold `CompositingStrategy.Offscreen`
   across overlapping translucent subtrees or moving containers, collapse high-cardinality
   procedural draw loops into a single shader or mask, and optimize heavy AGSL fragment
   math.
3. **Last resort — Prewarm GPU pipelines on a covered frame:** Reach for manual GPU
   pipeline prewarming only when a release trace shows that first-time Vulkan shader
   compilation (`CreateGraphicsPipeline-CompileAfterCacheMiss`) still causes a visible hitch
   after object caching and layer strategies are in place.

## Contents

1. [Cache geometry objects per canvas size](#1-cache-geometry-objects-per-canvas-size)
2. [Prevent mid-animation saveLayer
   transitions](#2-prevent-mid-animation-savelayer-transitions)
3. [Defeat ModalBottomSheet non-uniform scale shader
   stalls](#3-defeat-modalbottomsheet-non-uniform-scale-shader-stalls)
4. [Collapse dense procedural draws and optimize heavy AGSL
   shaders](#4-collapse-dense-procedural-draws-and-optimize-heavy-agsl-shaders)
5. [Step down expensive ambient redraws to 60
   fps](#5-step-down-expensive-ambient-redraws-to-60-fps)
6. [Last resort: Prewarm GPU pipelines and text
   layouts](#6-last-resort-prewarm-gpu-pipelines-and-text-layouts)

## 1. Cache geometry objects per canvas size

Do not initialize or allocate non-trivial objects inside per-frame draw lambdas (`onDraw`,
`onDrawBehind`, `onDrawWithContent`) — for example, constructing `Morph` instances,
converting polygons to `Path`, running boolean `Path.op`, or allocating `Brush` gradients
and `Stroke` objects on every frame. Conversely, reading a frame-rate animation clock inside
the outer `Modifier.drawWithCache` cache scope is equally expensive because it invalidates
the cached objects on every frame.

Hoist static shapes that do not depend on view bounds out of the draw modifier entirely
(for example, unit-square `RoundedPolygon` definitions). Initialize size- or theme-dependent
objects (such as `Path` geometry, `Brush` instances, or `Paint` / `Stroke` configs) in the
outer `drawWithCache` scope, and keep `onDrawWithContent` / `onDrawBehind` to reading
animation progress (`() -> Float`) and issuing draw calls (reusing a cached scratch `Path`
via `rewind()` when geometry morphs per frame):

```kotlin
Modifier.drawWithCache {
    val geometry = buildSceneGeometry(size, palette) // runs only when size or palette changes
    val scratchPath = Path()
    onDrawWithContent {
        val progress = entranceProgress()            // read in draw phase only
        if (progress <= 0f) return@onDrawWithContent
        drawScene(geometry, scratchPath, progress)
    }
}
```

## 2. Prevent mid-animation saveLayer transitions

Crossing between `alpha == 1f` (`flush commands`) and `0f < alpha < 1f` (`flush layers`,
logged as `alpha caused saveLayer`) changes HWUI's render target mid-animation. HWUI
allocates an offscreen texture and compiles a second set of Vulkan pipelines mid-flight.

Any animation that crosses `1.0f` mid-flight can trigger this stall. For example, an
underdamped spatial spring driving `artAlpha` to `1f` overshoots `1f` and then undershoots
back below `1f` mid-reveal. Always drive opacity with a non-overshooting effects spring
(`MaterialTheme.motionScheme.defaultEffectsSpec()`). If opacity is derived from a shared
spatial progress value, latch `alpha` at `1f` once it reaches full opacity and hold
`CompositingStrategy.Offscreen` while scaling or fading:

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

Whenever an animated container applies a non-uniform scale ($s_x \neq s_y$) to a subtree
with vector or rounded-shape children, Skia's matrix flips from `kTranslate_Mask` to
`kScale_Mask`. Skia then compiles elliptical Vulkan pipelines (such as `EllipseOp` or
`EllipticalRRectOp`) and re-rasterizes vector paths on every frame.

A common example is Material 3's `ModalBottomSheet`
([issuetracker 576993363](https://issuetracker.google.com/issues/576993363)): when it
overshoots its `Expanded` anchor, it applies `.verticalScaleUp(state)` to the outer
`Surface` ($H_1$) and `.verticalScaleDown(state)` to the inner `Column`
($H_2 = H_1 - \text{insets}$) after `.windowInsetsPadding(contentWindowInsets())`. Because
$H_1 \neq H_2$, the scales do not cancel, leaving $s_y \neq 1.0, s_x = 1.0$ on every child.

Until [issuetracker 574117772](https://issuetracker.google.com/issues/574117772) (first-frame
off-screen work) and [issuetracker 576993363](https://issuetracker.google.com/issues/576993363)
(non-uniform bounce scale) are fixed upstream, skip heavy canvas drawing on Frame 1 while
the sheet is still `SheetValue.Hidden` off-screen, and composite the sheet body into a
single offscreen layer while the sheet is moving so child vector and shape primitives are
rendered at unscaled `1:1` into the layer:

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

## 4. Collapse dense procedural draws and optimize heavy AGSL shaders

Issuing hundreds of individual canvas draw calls per frame saturates `AndroidOwner:draw`
and `RenderThread` `IssueDrawCommands`. Collapse high-cardinality procedural draws into a
single GPU pass — for example:

- For procedural grids, particle fields, or globes, replace per-element `drawCircle` /
  `drawPath` loops with one `RuntimeShader` (`AGSL` on API 33+) drawn in a single
  `drawRect` call.
- For scrolling header or list-edge fade-outs, render the content inside
  `CompositingStrategy.Offscreen` and draw a sliding `BlendMode.DstIn` alpha mask at the
  edge instead of redrawing a complex gradient scrim each frame.

Moving work into `AGSL` can trade CPU canvas overhead for GPU fragment saturation. UI
`doFrame` and `RenderThread` `DrawFrame` can look fast while `FrameTimeline` reports `App
Deadline Missed` and `Buffer Stuffing`. When `postAndWait` and `dequeueBuffer` stalls
appear on `RenderThread`, the fragment shader is starving the BufferQueue.

First, reject inactive pixels as cheaply as possible before running expensive math or
texture lookups:

```glsl
// Example: reject pixels outside the maximum cell radius before trig or texture lookups.
vec2 cellUv = fract(fragCoord / cellSize) - 0.5;
if (dot(cellUv, cellUv) > maxDotRadiusSq) {
    return half4(0.0);
}
```

Early-out culling is only a first step. If `FrameTimeline` still reports janky frames, run
a full optimization pass on the shader itself:

- Hoist frame-constant matrices and trig terms to CPU `setFloatUniform` calls.
- Replace expensive per-pixel transcendental calls (such as `asin`, `atan2`, or `pow`) with
  a 1D/2D lookup texture (LUT) or a low-order polynomial approximation.
- Render the procedural effect into a lower-resolution offscreen target when the visual
  detail is coarse.

## 5. Step down expensive ambient redraws to 60 fps

Do not cap frame rates across animations in general. Step down an endless ambient
animation to `60 fps` only when its redraw is expensive, such as when it forces
SurfaceFlinger to composite a full-window buffer at `120 Hz`.

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
        val scale = coroutineContext[MotionDurationScale]
        var nextFrameNs = 0L
        var lastNs = -1L
        while (isActive) {
            val factor = scale?.scaleFactor ?: 1f
            if (factor == 0f) {
                lastNs = -1L
                delay(500)
                continue
            }
            withFrameNanos { frameNs ->
                if (frameNs >= nextFrameNs) {
                    nextFrameNs = frameNs + FrameStep60HzNanos
                    if (lastNs >= 0L) {
                        val deltaMs = (frameNs - lastNs) / 1_000_000f / factor
                        phase.floatValue = (phase.floatValue + deltaMs / periodMs) % 1f
                    }
                    lastNs = frameNs
                }
            }
        }
    }
    return phase
}
```

## 6. Last resort: Prewarm GPU pipelines and text layouts

Do not prewarm GPU shaders as a general practice. First simplify the canvas primitives,
initialize `Path` and `Brush` objects in the `drawWithCache` cache scope, and stabilize
`CompositingStrategy`.

Only when a release-build Perfetto trace proves that Skia/Vulkan lazy pipeline compilation
(`CreateGraphicsPipeline-CompileAfterCacheMiss`, such as `CircleOp`, `TriangulatingPathOp`,
`DrawAtlasPathOp`, or `RRect` ops) still stalls `RenderThread` on the first visible frame
of an entrance, render one covered frame at the target size while the preceding screen is
idle and unmount the prewarm composable on the next frame:

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
