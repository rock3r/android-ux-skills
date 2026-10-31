package com.example.travel.ui.timeline

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt

data class AdviceSlot(val id: String, val label: String)

/** Summary card that shifts vertical position in the layout phase without remeasuring. */
@Composable
fun SlideInSummaryCard(
    expanded: Boolean,
    title: String,
    modifier: Modifier = Modifier,
) {
    val density = LocalDensity.current
    val targetOffsetPx = with(density) { if (expanded) 0f else 16.dp.toPx() }
    val offsetPxState = animateFloatAsState(
        targetValue = targetOffsetPx,
        animationSpec = MaterialTheme.motionScheme.fastSpatialSpec(),
        label = "summaryOffsetPx",
    )

    Column(
        modifier
            .fillMaxWidth()
            .offset { IntOffset(0, offsetPxState.value.roundToInt()) }
            .padding(16.dp),
    ) {
        Text(text = title, style = MaterialTheme.typography.titleMedium)
    }
}

/** Badge canvas that caches its geometry per size and reads progress in draw. */
@Composable
fun CachedMorphBadge(
    expanded: Boolean,
    modifier: Modifier = Modifier,
) {
    val progressState = animateFloatAsState(
        targetValue = if (expanded) 1f else 0f,
        animationSpec = MaterialTheme.motionScheme.fastSpatialSpec(),
        label = "badgeProgress",
    )
    val tint = MaterialTheme.colorScheme.primary

    Box(
        modifier
            .size(64.dp)
            .drawWithCache {
                val badgePath = Path().apply {
                    moveTo(0f, size.height / 2f)
                    lineTo(size.width / 2f, 0f)
                    lineTo(size.width, size.height / 2f)
                    lineTo(size.width / 2f, size.height)
                    close()
                }
                onDrawWithContent {
                    val p = progressState.value
                    if (p > 0f) {
                        drawPath(badgePath, color = tint, alpha = p)
                    }
                    drawContent()
                }
            },
    )
}

/** Timeline list that hoists theme-derived rail colors above LazyColumn items. */
@Composable
fun HoistedTimelineList(
    slots: List<AdviceSlot>,
    modifier: Modifier = Modifier,
) {
    val scheme = MaterialTheme.colorScheme
    val railTint = remember(scheme.primary, scheme.surface) {
        lerp(scheme.surface, scheme.primary, 0.18f)
    }

    LazyColumn(modifier.fillMaxWidth()) {
        items(slots, key = { it.id }, contentType = { "advice_slot" }) { slot ->
            Text(
                text = slot.label,
                color = railTint,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp),
            )
        }
    }
}
