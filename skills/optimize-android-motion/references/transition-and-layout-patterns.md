# Transition, layout, and state-isolation patterns

Read this reference when Perfetto shows UI-thread spikes (`Recomposer:recompose` or
`AndroidOwner:measureAndLayout` exceeding `8.33 ms`) at the start of a transition, during
a chrome or keyboard fold, or when pressing Back.

## Contents

1. [Precompose bounded step decks and keep inactive steps
   inert](#1-precompose-bounded-step-decks-and-keep-inactive-steps-inert)
2. [Gate transition clocks on first layout](#2-gate-transition-clocks-on-first-layout)
3. [Measure shared decks at constant
   constraints](#3-measure-shared-decks-at-constant-constraints)
4. [Replace BoxWithConstraints and AnimatedVisibility on hot
   surfaces](#4-replace-boxwithconstraints-and-animatedvisibility-on-hot-surfaces)
5. [Isolate state reads and coalesce coupled
   transitions](#5-isolate-state-reads-and-coalesce-coupled-transitions)
6. [Snapshot static full-screen transitions](#6-snapshot-static-full-screen-transitions)
7. [Match remember scopes to data
   lifetime](#7-match-remember-scopes-to-data-lifetime)
8. [Separate platform window and library floors from app
   code](#8-separate-platform-window-and-library-floors-from-app-code)

## 1. Precompose bounded step decks and keep inactive steps inert

When `AnimatedContent` or `if (step == ...)` mounts a new step, Compose runs composition,
`Minikin` text layout, and path allocation on frame 1 (`16–39 ms` at `120 Hz`). For
bounded flows (`3–8` steps), keep all steps mounted in one `Layout` and place inactive
steps past the viewport (`size.width + 1f`):

```kotlin
internal fun Modifier.inertWhen(inert: Boolean): Modifier =
    if (!inert) {
        this
    } else {
        this
            .clearAndSetSemantics {}
            .focusProperties { canFocus = false }
            .pointerInput(Unit) {
                awaitPointerEventScope {
                    while (true) {
                        val event = awaitPointerEvent(PointerEventPass.Initial)
                        event.changes.forEach { it.consume() }
                    }
                }
            }
    }
```

Warming all hidden steps on frame 1 of cold start delays initial display. Mount only the
current step first, then increment `warmedUpTo` across `withFrameNanos {}` ticks so each
hidden step warms on its own idle frame.

## 2. Gate transition clocks on first layout

When a morph or `SeekableTransitionState` starts on the frame an incoming target first
composes, the animation clock advances before layout knows the target's bounds. Layout
consumes the first `16–32 ms` of the morph, and the element cuts mid-flight.

Hold the transition at its initial fraction until the incoming step reports from
`onPlaced` or `Modifier.layout` that its first layout pass has completed. Key the
`DisposableEffect` cleanup on the transition instance so a step unmounting after a
transition never clears the flag of a newer transition.

## 3. Measure shared decks at constant constraints

Subtracting an animated bottom bar or keyboard inset from the deck height changes
`frameHeight` on every spring frame. Passing that changing height into
`stepsMeasurable.measure(...)` forces every precomposed step in the deck to re-measure
(`25+` consecutive frames over `8.33 ms`).

Measure the deck at constant `Constraints.fixed(width, height)` and publish dynamic chrome
dimensions through a plain class read only inside `Modifier.layout` on the step that needs
them:

```kotlin
@Stable
internal class FrameRoom {
    var topBarHeight: Int = 0
    var bottomBarHeight: Int = 0
}

internal fun Modifier.stepRoom(
    step: Step,
    room: FrameRoom,
    searchProgress: () -> Float,
): Modifier = layout { measurable, constraints ->
    val top = if (step == Step.Welcome) 0 else room.topBarHeight
    val bottom = when (step) {
        Step.HomeZone -> (room.bottomBarHeight * (1f - searchProgress())).roundToInt()
        else -> room.bottomBarHeight
    }
    val h = (constraints.maxHeight - top - bottom).coerceAtLeast(0)
    val placeable = measurable.measure(constraints.copy(minHeight = h, maxHeight = h))
    layout(constraints.maxWidth, constraints.maxHeight) { placeable.place(0, top) }
}
```

Sibling steps see identical `top` and `bottom` values on every frame, so Compose skips
re-measuring them while `searchProgress` animates.

## 4. Replace BoxWithConstraints and AnimatedVisibility on hot surfaces

`BoxWithConstraints` is a `SubcomposeLayout`. When its incoming height or width animates
every frame, it runs `subcompose()` during measurement on every frame. Likewise, wrapping
collapsible headers or cards in `AnimatedVisibility` disposes their composition trees when
folded and recreates them from scratch when pressing Back (`24–36 ms` spike).

Replace `BoxWithConstraints` + `AnimatedVisibility` on folding surfaces with a plain
`Layout` and a non-disposing `FoldingSlot` that animates height and opacity in layout and
draw:

```kotlin
@Composable
internal fun FoldingSlot(
    visible: Boolean,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val motion = MaterialTheme.motionScheme
    val expand = animateFloatAsState(if (visible) 1f else 0f, motion.defaultSpatialSpec())
    val alpha = animateFloatAsState(if (visible) 1f else 0f, motion.defaultEffectsSpec())
    Layout(
        content = content,
        modifier = modifier
            .inertWhen(!visible)
            .drawWithContent {
                if (expand.value <= 0f) return@drawWithContent
                if (expand.value < 1f) clipRect { this@drawWithContent.drawContent() }
                else drawContent()
            }
            .graphicsLayer { this.alpha = alpha.value.coerceIn(0f, 1f) },
    ) { measurables, constraints ->
        val placeable = measurables.first().measure(constraints.copy(minHeight = 0))
        val h = (placeable.height * expand.value.coerceIn(0f, 1f)).roundToInt()
        layout(placeable.width, h) { placeable.place(0, 0) }
    }
}
```

Pass the remaining height from the parent `Layout` to the expanding child through a
`roomPx: Density.() -> Int` lambda read inside `Modifier.layout`. Never write per-frame
pixel heights into a `MutableIntState` that triggers recomposition.

## 5. Isolate state reads and coalesce coupled transitions

Reading `state.step` at the root composable and passing `step: Step` by value into child
bars forces the entire screen root to recompose on frame 1 of every step change. Pass
`State<Step>` (via `rememberUpdatedState` or `derivedStateOf`) down to small leaf
composables so only those leaves recompose.

Avoid mutating `UiState` at the start or end of a heavy animation:

- During exit and takeoff actions, mark the screen inert and start the save without
  flipping `isSaving` in `UiState` (`53 ms → 7.5 ms` on frame 1).
- When cleaning up a reveal animation, keep `spectacleActive: Boolean` separate from
  `spectacleOrigin: Offset?` so ending the reveal does not rebuild `ShapeMorph` caches.
- When pressing Back from keyboard search, combine `state.fullHeight = false` and
  `focusManager.clearFocus()` in one `SideEffect` on the same frame.

## 6. Snapshot static full-screen transitions

Animating `ColorScheme` or typography per frame recomposes the entire window on every
vsync (`25–30` frames over `8.33 ms`). For static full-screen visual changes (theme
switches, circular reveals, contrast changes), capture the outgoing screen once into an
`ImageBitmap`. Apply the new state in one recomposition and animate the bitmap overlay:

```kotlin
val captureLayer = rememberGraphicsLayer()
LaunchedEffect(targetLook) {
    if (displayedLook != targetLook) {
        snapshot = captureLayer.toImageBitmap()
        overlayProgress.snapTo(1f)
        displayedLook = targetLook // Single recomposition with new palette + fonts
        overlayProgress.animateTo(0f, animationSpec = transitionSpec)
        snapshot = null
    }
}
Box(
    Modifier
        .inertWhen(snapshot != null)
        .drawWithContent {
            captureLayer.record { this@drawWithContent.drawContent() }
            drawLayer(captureLayer)
            snapshot?.let { bmp -> drawImage(bmp, alpha = overlayProgress.value) }
        }
) { content(displayedLook) }
```

Respect two constraints whenever you snapshot a screen:

- **Block input during the transition:** The snapshot is a static bitmap. Keep the surface
  inert to touch and focus while the overlay is active, and if a second toggle interrupts
  mid-transition, freeze the current overlay until the next capture completes.
- **Ongoing motion inside the captured screen pauses:** Spinners, waves, or scrolling
  lists on the outgoing view freeze in the bitmap and jump when unmounted. Use snapshot
  transitions only when the outgoing UI is at rest or when a brief freeze on the outgoing
  layer is acceptable.

## 7. Match remember scopes to data lifetime

Make sure `remember` and `key(...)` scopes match the actual lifetime of their inputs:

- **Hoist theme-level `remember` work out of list items:** A `remember` block inside a
  `LazyColumn` item that depends only on theme state runs up to `4×` per frame during
  prefetch (`keepAroundItems`). Compute it once at the screen level and pass it down.
- **Keep stateful canvas caches mounted across item switches:** Wrapping a dial or canvas
  in `key(selectedDay)` destroys its `rememberTextMeasurer()` cache on every selection.
  Keep the component mounted and reset only its interaction state.

When a screen takes `45–80 ms` to open, **do not** stagger non-lazy sibling sections
across fade-in frames or keep every tab permanently composed. Staggering sections halves
`uiMax` (`61.5 → 34.5 ms`) but increases SurfaceFlinger `FrameTimeline` jank (`5.0 →
8.4`). Fix why the destination is slow to compose instead:

- Keep ViewModels and pre-computed UI state warm across navigation so destination entry
  does zero synchronous data transformation.
- Cache heavy drawing objects (`Morph`, boolean `Path.op` results, and vector painters)
  outside first-frame composition so they are not rebuilt when the screen opens.
- Use `LazyColumn` for long scrollable screens so off-screen sections do not compose on
  Frame 1.

## 8. Separate platform window and library floors from app code

Distinguish app regressions from upstream Compose and Material 3 behavior before rewriting
screen code:

- **`Dialog`, `ModalBottomSheet`, and `Popup` window floor:** Creating a new platform
  dialog or popup window costs a fixed `12–15 ms` on Frame 1 (`onRemembered` window
  creation `~8 ms` + `relayoutWindow#first=true` `~5 ms`) before app content measures.
  Optimize the app-owned content (for example, using a lazy list inside a long sheet), and
  do not chase the platform window attach slice.
- **Open `DropdownMenu` / `Popup` `120 Hz` frame loop:** While a `Popup` sits open,
  Compose ticks `BroadcastFrameClock.withFrameNanos` on every vsync (`~1.1 ms/frame`, `0`
  jank) to poll anchor coordinates. That is an upstream `compose-ui` behavior, not an app
  animation leak; file or link the upstream issue rather than hacking around menu state.
- **Content moving under a `Haze` blur:** `Haze` 2.0 creates its `RenderEffect` once
  (`~0.8 ms`) and fades via layer alpha. However, any content scrolling or animating
  underneath an active status-bar blur forces the blur strip to re-render each frame.
  Always measure idle screens both at the top of the list and scrolled.
