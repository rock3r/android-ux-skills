package com.example.catalogue.ui.shelf

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.offset
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp

object ShelfMotion {
    fun <T> spineSlide() = tween<T>(durationMillis = 300, easing = FastOutSlowInEasing)
}

/** A book on the shelf screen. Tapping it pulls the spine up. */
@Composable
fun BookSpine(pulledOut: Boolean, title: String, modifier: Modifier = Modifier) {
    val lift by animateDpAsState(
        targetValue = if (pulledOut) 24.dp else 0.dp,
        animationSpec = tween(durationMillis = 300, easing = FastOutSlowInEasing),
        label = "spineLift",
    )

    Text(
        text = title,
        modifier = modifier.offset { IntOffset(0, -lift.roundToPx()) },
        style = MaterialTheme.typography.titleMedium,
    )
}

/** The title in the reading bar, which shifts right while the book is open. */
@Composable
fun NowReadingLabel(reading: Boolean, title: String, modifier: Modifier = Modifier) {
    val slide by animateFloatAsState(
        targetValue = if (reading) 1f else 0f,
        animationSpec = ShelfMotion.spineSlide(),
        label = "labelSlide",
    )

    Text(
        text = "Now reading: $title",
        modifier = modifier.graphicsLayer { translationX = slide * 48.dp.toPx() },
        style = MaterialTheme.typography.labelMedium,
    )
}
