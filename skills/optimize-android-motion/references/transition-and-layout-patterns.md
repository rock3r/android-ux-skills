# Transition, layout, and state-isolation patterns

Read this reference when Perfetto shows UI-thread spikes (`Recomposer:recompose` or
`AndroidOwner:measureAndLayout` exceeding the frame budget) at the start of a transition,
during a chrome or keyboard fold, or when toggling overlays and panes.

Start with the simplest root-cause fixes before reaching for structural workarounds:

1. **Data pipeline:** Keep ViewModels and pre-computed UI state warm off the UI thread so
   entering a destination or toggling state performs no synchronous domain transformation,
   formatting, or sorting. Fixing slow data preparation beats any composition band-aid.
2. **Composition and phase reads:** Narrow recomposition scopes (pass `State<T>` or lambdas
   to leaf composables), hoist `remember` caches to match data lifetime, defer offsets and
   insets to `Modifier.layout`, and use `LazyColumn` for long scrollable content.
3. **Last-resort workarounds for mount, disposal, or full-window side effects:** Use
   off-screen step precomposition, non-disposing `FoldingSlot` containers, or
   `GraphicsLayer` bitmap snapshots only when release traces show that data handling and
   composition are already clean and the remaining lag comes from unavoidable side effects
   of first-time tree mounting, `Minikin` text measurement, or full-window theme
   recomposition.

## Contents

1. [Isolate state reads and coalesce coupled
   transitions](#1-isolate-state-reads-and-coalesce-coupled-transitions)
2. [Match remember scopes to data
   lifetime](#2-match-remember-scopes-to-data-lifetime)
3. [Gate transition clocks on first layout](#3-gate-transition-clocks-on-first-layout)
4. [Measure shared decks at constant
   constraints](#4-measure-shared-decks-at-constant-constraints)
5. [Last resort: Replace BoxWithConstraints and AnimatedVisibility on hot
   surfaces](#5-last-resort-replace-boxwithconstraints-and-animatedvisibility-on-hot-surfaces)
6. [Last resort: Precompose bounded step decks and keep inactive steps
   inert](#6-last-resort-precompose-bounded-step-decks-and-keep-inactive-steps-inert)
7. [Last resort: Snapshot static full-screen
   transitions](#7-last-resort-snapshot-static-full-screen-transitions)
8. [Separate platform window and library floors from app
   code](#8-separate-platform-window-and-library-floors-from-app-code)

## 1. Isolate state reads and coalesce coupled transitions

Reading transition or step state at a root composable and passing it by value into child
bars forces the entire screen root to recompose on frame 1 of every state change. Pass
`State<T>` (via `rememberUpdatedState` or `derivedStateOf`) or state-reading lambdas down
to small leaf composables so only those leaves recompose.

Avoid mutating `UiState` fields that trigger wide recompositions at the start or end of a
heavy animation, and coalesce coupled state changes into the same frame — for example:

- During exit and takeoff actions, mark the screen inert and start the background save
  without flipping a wide `isSaving` flag in `UiState` on the takeoff frame.
- When cleaning up a reveal animation, keep the active boolean separate from the reveal
  origin coordinates so ending the reveal does not rebuild cached morph geometry.
- When changing UI state that also shifts focus (such as closing an inline search mode or
  overlay), combine the layout state update and `focusManager.clearFocus()` in one
  `SideEffect` on the same frame rather than splitting them across two frames.

## 2. Match remember scopes to data lifetime

Make sure `remember` and `key(...)` scopes match the actual rate of change of their inputs,
neither narrower (which recomputes during list prefetch) nor destructively keyed (which
discards expensive internal caches on selection changes) — for example:

- **Hoist screen- or theme-level `remember` work out of list items:** A `remember` block
  inside a `LazyColumn` item that depends only on theme or screen state re-runs across
  prefetched items during flings (`keepAroundItems`). Compute it once at the screen level
  and pass it down.
- **Keep stateful canvas caches mounted across item switches:** Wrapping a dial or canvas
  in `key(selectedItem)` destroys internal caches such as `rememberTextMeasurer()` on every
  selection. Keep the component mounted and reset only its interaction state.

When a destination is slow to open, **do not** time-slice it by mounting one section per
frame via `withFrameNanos` during the fade-in, and do not keep every top-level tab
permanently composed. Splitting section composition across fade-in frames lowers the
single-frame peak (`uiMax`) on paper while increasing total missed vsyncs (`FrameTimeline`
jank). Fix why the destination is slow to compose instead:

- Keep ViewModels and pre-computed UI state warm across navigation so destination entry
  does zero synchronous data transformation.
- Hoist or cache heavy drawing objects (such as `Morph` instances, boolean `Path.op`
  results, or complex painters) outside first-frame composition so they are not rebuilt
  when the screen opens.
- Use `LazyColumn` for long scrollable screens so off-screen sections do not compose on
  Frame 1.

## 3. Gate transition clocks on first layout

When a morph or `SeekableTransitionState` starts on the frame an incoming target first
composes, the animation clock advances before layout knows the target's bounds. Layout
consumes the initial frames of the morph, and the element cuts mid-flight.

Hold the transition at its initial fraction until the incoming target reports from
`onPlaced` or `Modifier.layout` that its first layout pass has completed. Key the
`DisposableEffect` cleanup on the transition instance so a target unmounting after a
transition never clears the flag of a newer transition.

## 4. Measure shared decks at constant constraints

Subtracting an animated bottom bar or keyboard inset from a container's height changes the
incoming height constraint on every spring frame. Passing that changing height into child
measurement forces every mounted child in the deck to re-measure on every frame.

Measure shared containers at constant `Constraints.fixed(width, height)` and publish
dynamic chrome dimensions through a plain class read only inside `Modifier.layout` on the
active child that needs them:

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

Inactive siblings see identical `top` and `bottom` values on every frame, so Compose skips
re-measuring them while `searchProgress` animates.

## 5. Last resort: Replace BoxWithConstraints and AnimatedVisibility on hot surfaces

`BoxWithConstraints` is a `SubcomposeLayout`. When its incoming height or width animates
every frame, it runs `subcompose()` during measurement on every frame. Likewise, wrapping
a frequently toggled header, overlay, or card in `AnimatedVisibility` disposes its
composition tree when folded and recreates it from scratch when re-opened.

First check whether you can simplify the subtree or defer constraints via `Modifier.layout`.
If a release trace still shows a frame spike from recreating a collapsible slot when
changing UI state, replace `BoxWithConstraints` + `AnimatedVisibility` on that hot surface
with a plain `Layout` and a non-disposing `FoldingSlot` that animates height and opacity in
layout and draw:

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
        val childConstraints = constraints.copy(minHeight = 0)
        val placeables = measurables.map { it.measure(childConstraints) }
        val width = placeables.maxOfOrNull { it.width } ?: 0
        val fullHeight = placeables.maxOfOrNull { it.height } ?: 0
        val h = (fullHeight * expand.value.coerceIn(0f, 1f)).roundToInt()
        layout(width, h) {
            placeables.forEach { it.place(0, 0) }
        }
    }
}
```

Pass the remaining height from the parent `Layout` to the expanding child through a
`roomPx: Density.() -> Int` lambda read inside `Modifier.layout`. Never write per-frame
pixel heights into a `MutableIntState` that triggers recomposition.

## 6. Last resort: Precompose bounded step decks and keep inactive steps inert

When `AnimatedContent` or conditional composition mounts a new step, Compose runs
composition, cold `Minikin` text layout, and path allocation on frame 1. Only after you
have moved data preparation out of composition and hoisted heavy allocations — and only for
bounded flows (such as a fixed multi-step wizard) where frame-1 text/node mount still drops
frames — keep the steps mounted in one `Layout` and place inactive steps past the viewport
(`size.width + 1f`).

Plain `enabled = false` is not suitable for deactivating hidden or transitioning steps: it
changes component visuals (switching controls to disabled colors and alphas mid-animation)
and is not supported on arbitrary layout containers. Instead, use an `inertWhen` modifier
that blocks accessibility semantics, focus traversal, hardware key events on any child that
already held focus, and pointer events without altering appearance:

```kotlin
internal fun Modifier.inertWhen(inert: Boolean): Modifier =
    if (!inert) {
        this
    } else {
        this
            .clearAndSetSemantics {}
            .focusProperties { canFocus = false }
            .onPreviewKeyEvent { true }
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

## 7. Last resort: Snapshot static full-screen transitions

Animating `ColorScheme` or typography per frame recomposes every reader across the window
on every vsync. When only a local surface changes color, keep the theme static and defer
the animated color read into `drawBehind` or `drawWithCache`.

When the entire window must transition between themes or contrast modes (such as a
full-screen cross-fade or circular reveal) and the screen is otherwise static, capture the
outgoing screen once into an `ImageBitmap`, apply the new theme in a single recomposition,
and animate the bitmap overlay:

```kotlin
val captureLayer = rememberGraphicsLayer()
LaunchedEffect(targetLook) {
    if (displayedLook == targetLook) {
        overlayProgress.snapTo(0f)
        snapshot = null
        return@LaunchedEffect
    }
    try {
        snapshot = captureLayer.toImageBitmap()
        overlayProgress.snapTo(1f)
        displayedLook = targetLook // Single recomposition with new palette + fonts
        overlayProgress.animateTo(0f, animationSpec = transitionSpec)
    } finally {
        overlayProgress.snapTo(0f)
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

- **Block input and clean up on cancellation:** The snapshot is a static bitmap. Keep the
  surface inert via `inertWhen(snapshot != null)` while the overlay is active, and always
  clear `snapshot` in a `finally` block (as well as when `displayedLook == targetLook`) so
  rapid interrupted toggles never leave the screen permanently inert.
- **Ongoing motion inside the captured screen pauses:** Spinners, waves, or scrolling
  lists on the outgoing view freeze in the bitmap and jump when unmounted. Use snapshot
  transitions only when the outgoing UI is at rest or when a brief freeze on the outgoing
  layer is acceptable.

## 8. Separate platform window and library floors from app code

Distinguish app regressions from upstream Compose and Material 3 behavior before rewriting
screen code:

- **`Dialog`, `ModalBottomSheet`, and `Popup` window floor:** Creating a new platform
  dialog or popup window pays a fixed one-time window creation and `relayoutWindow#first=true`
  cost on Frame 1 before app content measures (for `ModalBottomSheet`, see
  [issuetracker 574117772](https://issuetracker.google.com/issues/574117772)). Optimize the
  app-owned content (for example, using a lazy list inside a long sheet), and do not chase
  the platform window attach slice.
- **Open `DropdownMenu` / `Popup` frame loop:** While a `Popup` sits open, Compose ticks
  `BroadcastFrameClock.withFrameNanos` on every vsync to poll anchor coordinates. That is
  an upstream `compose-ui` behavior, not an app animation leak; file or link the upstream
  issue rather than hacking around menu state.
- **Content moving under a `Haze` blur:** `Haze` creates its `RenderEffect` once and fades
  via layer alpha, but any content scrolling or animating underneath an active status-bar
  blur forces the blur strip to re-render each frame. Always measure idle screens both at
  the top of the list and scrolled.
