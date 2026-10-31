package com.example.travel.ui.home

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt

/** Morning summary card that reveals sky art when expanded. */
@Composable
fun SunriseHeroCard(
    revealed: Boolean,
    modifier: Modifier = Modifier,
) {
    val topPad by animateDpAsState(
        targetValue = if (revealed) 0.dp else 24.dp,
        animationSpec = MaterialTheme.motionScheme.defaultSpatialSpec(),
        label = "topPad",
    )
    val scale by animateFloatAsState(
        targetValue = if (revealed) 1f else 0.85f,
        animationSpec = MaterialTheme.motionScheme.defaultSpatialSpec(),
        label = "scale",
    )
    val alpha by animateFloatAsState(
        targetValue = if (revealed) 1f else 0f,
        animationSpec = MaterialTheme.motionScheme.defaultSpatialSpec(),
        label = "alpha",
    )

    Column(modifier.fillMaxWidth().padding(top = topPad)) {
        Box(Modifier.size(120.dp).graphicsLayer { this.alpha = 0f }) {
            Canvas(Modifier.matchParentSize()) {
                drawCircle(Color(0xFFFFB300), radius = size.minDimension / 2f)
            }
        }
        Box(
            Modifier
                .size(120.dp)
                .graphicsLayer {
                    scaleX = scale
                    scaleY = scale
                    this.alpha = alpha
                },
            contentAlignment = Alignment.Center,
        ) {
            Canvas(Modifier.matchParentSize()) {
                drawCircle(Color(0xFFFFB300), radius = size.minDimension / 2f, center = Offset(60f, 60f))
            }
            Text("6:15 AM", style = MaterialTheme.typography.labelLarge)
        }
        Text("Sunrise window", style = MaterialTheme.typography.titleMedium)
    }
}

/** Evening summary card with layout-phase offset and latched offscreen layer. */
@Composable
fun SunsetHeroCard(
    revealed: Boolean,
    modifier: Modifier = Modifier,
) {
    val density = LocalDensity.current
    val targetOffsetPx = with(density) { if (revealed) 0f else 24.dp.toPx() }
    val offsetPxState = animateFloatAsState(
        targetValue = targetOffsetPx,
        animationSpec = MaterialTheme.motionScheme.defaultSpatialSpec(),
        label = "offsetPx",
    )
    val scaleState = animateFloatAsState(
        targetValue = if (revealed) 1f else 0.85f,
        animationSpec = MaterialTheme.motionScheme.defaultSpatialSpec(),
        label = "scale",
    )
    val alphaState = animateFloatAsState(
        targetValue = if (revealed) 1f else 0f,
        animationSpec = MaterialTheme.motionScheme.defaultEffectsSpec(),
        label = "alpha",
    )

    Column(
        modifier
            .fillMaxWidth()
            .offset { IntOffset(0, offsetPxState.value.roundToInt()) },
    ) {
        Box(
            Modifier
                .size(120.dp)
                .graphicsLayer {
                    val s = scaleState.value
                    val a = alphaState.value.coerceIn(0f, 1f)
                    scaleX = s
                    scaleY = s
                    alpha = a
                    compositingStrategy = CompositingStrategy.Offscreen
                },
            contentAlignment = Alignment.Center,
        ) {
            Canvas(Modifier.matchParentSize()) {
                drawCircle(Color(0xFFFF7043), radius = size.minDimension / 2f, center = center)
            }
            Text("7:45 PM", style = MaterialTheme.typography.labelLarge)
        }
        Text("Sunset window", style = MaterialTheme.typography.titleMedium)
    }
}
