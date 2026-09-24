package com.example.catalogue.ui.search

import androidx.activity.compose.PredictiveBackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.unit.dp
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.launch

/** Search filters, raised from the bottom edge over the results by the Filters button. */
@Composable
fun FiltersPanel(open: Boolean, onClose: () -> Unit, modifier: Modifier = Modifier) {
    val hidden = remember { Animatable(1f) }
    val settle = MaterialTheme.motionScheme.defaultSpatialSpec<Float>()

    LaunchedEffect(open) { hidden.animateTo(if (open) 0f else 1f, settle) }

    PredictiveBackHandler(enabled = open) { progress ->
        try {
            progress.collect { event -> hidden.snapTo(event.progress) }
            onClose()
        } catch (e: CancellationException) {
            hidden.animateTo(0f, settle)
            throw e
        }
    }

    Surface(
        modifier.fillMaxWidth().graphicsLayer { translationY = hidden.value * size.height },
        tonalElevation = 3.dp,
    ) {
        Column {
            Text("Filters", style = MaterialTheme.typography.titleMedium)
        }
    }
}

/** Sort order, raised from the bottom edge over the results by the Sort button. */
@Composable
fun SortPanel(open: Boolean, onClose: () -> Unit, modifier: Modifier = Modifier) {
    val hidden = remember { Animatable(1f) }
    val settle = MaterialTheme.motionScheme.defaultSpatialSpec<Float>()
    val scope = rememberCoroutineScope()
    var heightPx by remember { mutableFloatStateOf(1f) }

    LaunchedEffect(open) { hidden.animateTo(if (open) 0f else 1f, settle) }

    PredictiveBackHandler(enabled = open) { progress ->
        try {
            progress.collect { event -> hidden.snapTo(event.progress) }
            onClose()
        } catch (e: CancellationException) {
            hidden.animateTo(0f, settle)
            throw e
        }
    }

    Surface(
        modifier
            .fillMaxWidth()
            .onSizeChanged { heightPx = it.height.toFloat() }
            .graphicsLayer { translationY = hidden.value * size.height }
            .draggable(
                state = rememberDraggableState { delta ->
                    scope.launch { hidden.snapTo((hidden.value + delta / heightPx).coerceIn(0f, 1f)) }
                },
                orientation = Orientation.Vertical,
                onDragStopped = { velocity ->
                    val dismiss = hidden.value + velocity / heightPx * 0.1f > 0.5f
                    hidden.animateTo(
                        targetValue = if (dismiss) 1f else 0f,
                        animationSpec = settle,
                        initialVelocity = velocity / heightPx,
                    )
                    if (dismiss) onClose()
                },
            ),
        tonalElevation = 3.dp,
    ) {
        Column {
            Text("Sort by", style = MaterialTheme.typography.titleMedium)
        }
    }
}
