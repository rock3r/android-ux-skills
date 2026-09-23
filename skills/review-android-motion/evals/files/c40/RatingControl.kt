package com.example.catalogue.ui.detail

import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.StarBorder
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private const val STAR_STAGGER_MS = 60L

/**
 * Five tappable stars. Raising the rating pops each newly lit star in turn; lowering it
 * just puts the stars out.
 */
@Composable
fun RatingControl(rating: Int, onRate: (Int) -> Unit, modifier: Modifier = Modifier) {
    val pulse = MaterialTheme.motionScheme.fastSpatialSpec<Float>()
    val scales = remember { List(5) { Animatable(1f) } }
    var settled by remember { mutableIntStateOf(rating) }

    LaunchedEffect(rating) {
        val lit = if (rating > settled) settled until rating else IntRange.EMPTY
        settled = rating
        scales.forEachIndexed { index, scale ->
            launch {
                if (index in lit) {
                    delay((index - lit.first) * STAR_STAGGER_MS)
                    scale.animateTo(1.2f, pulse)
                }
                scale.animateTo(1f, pulse)
            }
        }
    }

    Row(modifier) {
        repeat(5) { index ->
            Icon(
                imageVector = if (index < rating) Icons.Filled.Star else Icons.Outlined.StarBorder,
                contentDescription = "Rate ${index + 1} of 5",
                modifier = Modifier
                    .size(40.dp)
                    .graphicsLayer {
                        scaleX = scales[index].value
                        scaleY = scales[index].value
                    }
                    .clickable { onRate(index + 1) },
            )
        }
    }
}
