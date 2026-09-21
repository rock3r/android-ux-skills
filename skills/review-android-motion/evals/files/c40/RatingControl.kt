package com.example.catalogue.ui.detail

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.StarBorder
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp

/**
 * Five tappable stars. Each one springs when it is tapped.
 */
@Composable
fun RatingControl(onRate: (Int) -> Unit, modifier: Modifier = Modifier) {
    var rating by remember { mutableIntStateOf(0) }

    Row(modifier) {
        repeat(5) { index ->
            val filled = index < rating
            val scale by animateFloatAsState(
                targetValue = if (filled) 1.25f else 1f,
                animationSpec = MaterialTheme.motionScheme.fastSpatialSpec(),
                label = "starScale$index",
            )

            Icon(
                imageVector = if (filled) Icons.Filled.Star else Icons.Outlined.StarBorder,
                contentDescription = "Rate ${index + 1} of 5",
                modifier = Modifier
                    .size(40.dp)
                    .graphicsLayer {
                        scaleX = scale
                        scaleY = scale
                    }
                    .clickable {
                        rating = index + 1
                        onRate(rating)
                    },
            )
        }
    }
}
