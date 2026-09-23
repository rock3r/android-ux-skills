package com.example.catalogue.ui.filters

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp

@Composable
fun FilterBar(expanded: Boolean, modifier: Modifier = Modifier) {
    Row(modifier) {
        FilterCount(expanded)
        FilterHandle(expanded)
        FilterSummary(expanded)
    }
}

@Composable
private fun FilterHandle(expanded: Boolean) {
    val slide by animateDpAsState(
        targetValue = if (expanded) 96.dp else 0.dp,
        animationSpec = MaterialTheme.motionScheme.defaultSpatialSpec(),
        label = "handleSlide",
    )

    Text(
        text = "Filters",
        modifier = Modifier.offset(x = slide),
        style = MaterialTheme.typography.labelLarge,
    )
}

@Composable
private fun FilterSummary(expanded: Boolean) {
    val slide by animateDpAsState(
        targetValue = if (expanded) 96.dp else 0.dp,
        animationSpec = MaterialTheme.motionScheme.defaultSpatialSpec(),
        label = "summarySlide",
    )

    Text(
        text = "3 active",
        modifier = Modifier.offset { IntOffset(slide.roundToPx(), 0) },
        style = MaterialTheme.typography.bodyMedium,
    )
}

@Composable
private fun FilterCount(expanded: Boolean) {
    val tint by animateColorAsState(
        targetValue = if (expanded) MaterialTheme.colorScheme.primary
        else MaterialTheme.colorScheme.outline,
        animationSpec = MaterialTheme.motionScheme.defaultEffectsSpec(),
        label = "countTint",
    )
    val fade by animateFloatAsState(
        targetValue = if (expanded) 1f else 0.6f,
        animationSpec = MaterialTheme.motionScheme.defaultEffectsSpec(),
        label = "countFade",
    )

    Text(
        text = "12",
        modifier = Modifier
            .graphicsLayer { alpha = fade }
            .drawBehind { drawCircle(tint) }
            .padding(4.dp),
        style = MaterialTheme.typography.labelSmall,
    )
}
