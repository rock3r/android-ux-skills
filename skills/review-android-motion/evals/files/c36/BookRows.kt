package com.example.catalogue.ui.shelf

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer

/** A book in the reading queue. */
@Composable
fun QueuedBook(title: String, dueSoon: Boolean, modifier: Modifier = Modifier) {
    val pulse by animateFloatAsState(
        targetValue = if (dueSoon) 1f else 0f,
        animationSpec = MaterialTheme.motionScheme.defaultEffectsSpec(),
        label = "dueSoonPulse",
    )
    Text(
        text = title,
        modifier = modifier.graphicsLayer { alpha = 1f - 0.5f * pulse * (1f - pulse) * 4f },
        style = MaterialTheme.typography.bodyLarge,
    )
}

/** A book on loan. */
@Composable
fun LoanedBook(title: String, dueSoon: Boolean, modifier: Modifier = Modifier) {
    val pulse by animateFloatAsState(
        targetValue = if (dueSoon) 1f else 0f,
        animationSpec = MaterialTheme.motionScheme.defaultEffectsSpec(),
        label = "dueSoonPulse",
    )
    Row(modifier.graphicsLayer { alpha = 1f - 0.5f * pulse * (1f - pulse) * 4f }) {
        Text(title, style = MaterialTheme.typography.bodyLarge)
        if (dueSoon) {
            Text(" · Due soon", style = MaterialTheme.typography.labelLarge)
        }
    }
}
