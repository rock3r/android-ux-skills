package com.example.catalogue.ui.home

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.MotionDurationScale
import androidx.compose.ui.graphics.graphicsLayer
import kotlinx.coroutines.delay

private const val PIXELS_PER_SECOND = 40f

/** News headlines scrolling across the top of the home screen. */
@Composable
fun NewsTicker(headlines: String, modifier: Modifier = Modifier) {
    var scroll by remember { mutableFloatStateOf(0f) }

    LaunchedEffect(Unit) {
        var last = withFrameNanos { it }
        while (true) {
            withFrameNanos { now ->
                scroll -= (now - last) / 1_000_000_000f * PIXELS_PER_SECOND
                last = now
            }
        }
    }

    Text(
        text = headlines,
        modifier = modifier.graphicsLayer { translationX = scroll },
        style = MaterialTheme.typography.labelLarge,
    )
}

/** Branch events scrolling across the top of the branch screen. */
@Composable
fun EventsTicker(events: String, modifier: Modifier = Modifier) {
    var scroll by remember { mutableFloatStateOf(0f) }
    var still by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        val scale = coroutineContext[MotionDurationScale]
        var last = -1L
        while (true) {
            val factor = scale?.scaleFactor ?: 1f
            still = factor == 0f
            if (still) {
                last = -1L
                delay(500)
                continue
            }
            withFrameNanos { now ->
                if (last >= 0) scroll -= (now - last) / 1_000_000_000f / factor * PIXELS_PER_SECOND
                last = now
            }
        }
    }

    if (still) {
        Text(events, modifier, style = MaterialTheme.typography.labelLarge)
    } else {
        Text(
            text = events,
            modifier = modifier.graphicsLayer { translationX = scroll },
            style = MaterialTheme.typography.labelLarge,
        )
    }
}
