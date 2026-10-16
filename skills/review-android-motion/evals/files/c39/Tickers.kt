package com.example.catalogue.ui.home

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.MotionDurationScale
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.onSizeChanged
import kotlinx.coroutines.delay

private const val PIXELS_PER_SECOND = 40f

/** News headlines scrolling across the top of the home screen. */
@Composable
fun NewsTicker(headlines: String, modifier: Modifier = Modifier) {
    var scroll by remember { mutableFloatStateOf(0f) }
    var stripWidth by remember { mutableIntStateOf(0) }
    var textWidth by remember { mutableIntStateOf(0) }
    var paused by rememberSaveable { mutableStateOf(false) }

    LaunchedEffect(paused) {
        if (paused) return@LaunchedEffect
        var last = withFrameNanos { it }
        while (true) {
            withFrameNanos { now ->
                scroll -= (now - last) / 1_000_000_000f * PIXELS_PER_SECOND
                if (scroll < -textWidth) scroll = stripWidth.toFloat()
                last = now
            }
        }
    }

    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        if (paused) {
            Text(headlines, Modifier.weight(1f), style = MaterialTheme.typography.labelLarge)
        } else {
            Text(
                text = headlines,
                modifier = Modifier
                    .weight(1f)
                    .clipToBounds()
                    .onSizeChanged { stripWidth = it.width }
                    .wrapContentWidth(Alignment.Start, unbounded = true)
                    .onSizeChanged { textWidth = it.width }
                    .graphicsLayer { translationX = scroll },
                maxLines = 1,
                style = MaterialTheme.typography.labelLarge,
            )
        }
        TextButton(onClick = { paused = !paused }) { Text(if (paused) "Resume" else "Pause") }
    }
}

/** Branch events scrolling across the top of the branch screen. */
@Composable
fun EventsTicker(events: String, modifier: Modifier = Modifier) {
    var scroll by remember { mutableFloatStateOf(0f) }
    var stripWidth by remember { mutableIntStateOf(0) }
    var textWidth by remember { mutableIntStateOf(0) }
    var still by remember { mutableStateOf(false) }
    var paused by rememberSaveable { mutableStateOf(false) }

    LaunchedEffect(paused) {
        if (paused) return@LaunchedEffect
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
                if (scroll < -textWidth) scroll = stripWidth.toFloat()
                last = now
            }
        }
    }

    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        if (still || paused) {
            Text(events, Modifier.weight(1f), style = MaterialTheme.typography.labelLarge)
        } else {
            Text(
                text = events,
                modifier = Modifier
                    .weight(1f)
                    .clipToBounds()
                    .onSizeChanged { stripWidth = it.width }
                    .wrapContentWidth(Alignment.Start, unbounded = true)
                    .onSizeChanged { textWidth = it.width }
                    .graphicsLayer { translationX = scroll },
                maxLines = 1,
                style = MaterialTheme.typography.labelLarge,
            )
        }
        TextButton(onClick = { paused = !paused }) { Text(if (paused) "Resume" else "Pause") }
    }
}
