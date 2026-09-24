package com.example.catalogue.ui.loans

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.offset
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import kotlin.math.abs
import kotlin.math.roundToInt
import kotlin.math.sign
import kotlinx.coroutines.launch

/** A loan on the loans screen. Swipe it away to return the book. */
@Composable
fun LoanCard(onReturn: () -> Unit, modifier: Modifier = Modifier) {
    val dismissPx = with(LocalDensity.current) { 96.dp.toPx() }
    val offscreenPx = with(LocalDensity.current) { 480.dp.toPx() }
    var target by remember { mutableFloatStateOf(0f) }
    val offset by animateFloatAsState(
        targetValue = target,
        animationSpec = MaterialTheme.motionScheme.defaultSpatialSpec(),
        label = "loanOffset",
    )

    Card(
        modifier
            .offset { IntOffset(offset.roundToInt(), 0) }
            .draggable(
                state = rememberDraggableState { delta -> target += delta },
                orientation = Orientation.Horizontal,
                onDragStopped = {
                    val gone = abs(target) > dismissPx
                    target = if (gone) sign(target) * offscreenPx else 0f
                    if (gone) onReturn()
                },
            ),
    ) {
        Text("Due back Friday", style = MaterialTheme.typography.bodyLarge)
    }
}

/** A hold on the holds screen. Swipe it away to cancel the hold. */
@Composable
fun HoldCard(onCancel: () -> Unit, modifier: Modifier = Modifier) {
    val dismissPx = with(LocalDensity.current) { 96.dp.toPx() }
    val offscreenPx = with(LocalDensity.current) { 480.dp.toPx() }
    val settle = MaterialTheme.motionScheme.defaultSpatialSpec<Float>()
    val offset = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()

    Card(
        modifier
            .offset { IntOffset(offset.value.roundToInt(), 0) }
            .draggable(
                state = rememberDraggableState { delta ->
                    scope.launch { offset.snapTo(offset.value + delta) }
                },
                orientation = Orientation.Horizontal,
                onDragStopped = { velocity ->
                    val gone = abs(offset.value) > dismissPx
                    offset.animateTo(
                        targetValue = if (gone) sign(offset.value) * offscreenPx else 0f,
                        animationSpec = settle,
                        initialVelocity = velocity,
                    )
                    if (gone) onCancel()
                },
            ),
    ) {
        Text("Ready to collect", style = MaterialTheme.typography.bodyLarge)
    }
}
