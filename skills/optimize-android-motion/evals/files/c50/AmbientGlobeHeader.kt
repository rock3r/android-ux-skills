package com.example.travel.ui.plan

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.MotionDurationScale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.preferredFrameRate
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

/** Rotating globe header shown above the active trip timeline. */
@Composable
fun LiveDotGlobe(modifier: Modifier = Modifier) {
    var phase by remember { mutableFloatStateOf(0f) }

    LaunchedEffect(Unit) {
        var startNs = 0L
        while (true) {
            withFrameNanos { now ->
                if (startNs == 0L) startNs = now
                val elapsedMs = (now - startNs) / 1_000_000f
                phase = (elapsedMs % 12_000f) / 12_000f
            }
        }
    }

    Canvas(modifier.size(160.dp)) {
        val cx = size.width * (0.2f + 0.6f * phase)
        drawCircle(Color(0xFF29B6F6), radius = size.minDimension * 0.35f, center = Offset(cx, size.height / 2f))
    }
}

/** Rotating globe header with 60 fps pacing, duration-scale check, and tap pause. */
@Composable
fun PacedDotGlobe(modifier: Modifier = Modifier) {
    val phase = remember { mutableFloatStateOf(0f) }
    var paused by rememberSaveable { mutableStateOf(false) }

    LaunchedEffect(paused) {
        if (paused) return@LaunchedEffect
        val scale = coroutineContext[MotionDurationScale]
        var lastNs = -1L
        while (true) {
            val factor = scale?.scaleFactor ?: 1f
            if (factor == 0f) {
                lastNs = -1L
                delay(500)
                continue
            }
            withFrameNanos { now ->
                if (lastNs >= 0L) {
                    val deltaMs = (now - lastNs) / 1_000_000f / factor
                    phase.floatValue = (phase.floatValue + deltaMs / 12_000f) % 1f
                }
                lastNs = now
            }
        }
    }

    Canvas(
        modifier
            .size(160.dp)
            .preferredFrameRate(60f)
            .graphicsLayer()
            .clickable(
                onClickLabel = if (paused) "Resume globe rotation" else "Pause globe rotation",
                onClick = { paused = !paused },
            ),
    ) {
        val cx = size.width * (0.2f + 0.6f * phase.floatValue)
        drawCircle(Color(0xFF29B6F6), radius = size.minDimension * 0.35f, center = Offset(cx, size.height / 2f))
    }
}
