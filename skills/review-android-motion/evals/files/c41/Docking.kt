package com.example.catalogue.ui.player

import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt
import kotlinx.coroutines.launch

private val ChipWidth = 160.dp

/** The now-playing chip. Drag it to dock it at either side of the screen. */
@Composable
fun NowPlayingChip(title: String, modifier: Modifier = Modifier) {
    BoxWithConstraints(modifier.fillMaxWidth()) {
        val travel = maxOf(constraints.maxWidth - with(LocalDensity.current) { ChipWidth.toPx() }, 0f)
        val settle = MaterialTheme.motionScheme.defaultSpatialSpec<Float>()
        val offset = remember { Animatable(0f) }
        val scope = rememberCoroutineScope()

        Card(
            Modifier
                .width(ChipWidth)
                .offset { IntOffset(offset.value.roundToInt(), 0) }
                .draggable(
                    state = rememberDraggableState { delta ->
                        scope.launch { offset.snapTo((offset.value + delta).coerceIn(0f, travel)) }
                    },
                    orientation = Orientation.Horizontal,
                    onDragStopped = { velocity ->
                        val toEnd = offset.value + velocity * 0.1f > travel / 2
                        offset.animateTo(
                            targetValue = if (toEnd) travel else 0f,
                            animationSpec = settle,
                            initialVelocity = velocity,
                        )
                    },
                ),
        ) {
            Text(title, style = MaterialTheme.typography.labelLarge)
        }
    }
}

/** The download-progress chip. Drag it to dock it at either side of the screen. */
@Composable
fun DownloadChip(label: String, modifier: Modifier = Modifier) {
    BoxWithConstraints(modifier.fillMaxWidth()) {
        val travel = maxOf(constraints.maxWidth - with(LocalDensity.current) { ChipWidth.toPx() }, 0f)
        val settle = MaterialTheme.motionScheme.defaultSpatialSpec<Float>()
        var dockedAtEnd by rememberSaveable { mutableStateOf(false) }
        val offset = remember(travel) { Animatable(if (dockedAtEnd) travel else 0f) }
        val scope = rememberCoroutineScope()

        Card(
            Modifier
                .width(ChipWidth)
                .offset { IntOffset(offset.value.roundToInt(), 0) }
                .draggable(
                    state = rememberDraggableState { delta ->
                        scope.launch { offset.snapTo((offset.value + delta).coerceIn(0f, travel)) }
                    },
                    orientation = Orientation.Horizontal,
                    onDragStopped = { velocity ->
                        dockedAtEnd = offset.value + velocity * 0.1f > travel / 2
                        offset.animateTo(
                            targetValue = if (dockedAtEnd) travel else 0f,
                            animationSpec = settle,
                            initialVelocity = velocity,
                        )
                    },
                ),
        ) {
            Text(label, style = MaterialTheme.typography.labelLarge)
        }
    }
}
