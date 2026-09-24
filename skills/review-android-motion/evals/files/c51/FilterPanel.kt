package com.example.catalogue.ui.filters

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.MutableTransitionState
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/** The filter panel under the search bar. */
@Composable
fun FilterPanel(open: Boolean, modifier: Modifier = Modifier) {
    AnimatedVisibility(
        visible = open,
        modifier = modifier,
        enter = expandVertically(MaterialTheme.motionScheme.slowSpatialSpec()) +
            fadeIn(MaterialTheme.motionScheme.slowEffectsSpec()),
        exit = fadeOut(MaterialTheme.motionScheme.fastEffectsSpec()) +
            shrinkVertically(MaterialTheme.motionScheme.fastSpatialSpec()),
    ) {
        Surface(tonalElevation = 2.dp) {
            Column {
                FilterOption("Available now")
                FilterOption("Large print")
                FilterOption("Audiobooks")
            }
        }
    }
}

@Composable
private fun FilterOption(label: String) {
    AnimatedVisibility(
        visibleState = remember { MutableTransitionState(false).apply { targetState = true } },
        enter = fadeIn(MaterialTheme.motionScheme.fastEffectsSpec()) +
            slideInVertically(MaterialTheme.motionScheme.fastSpatialSpec()) { it / 2 },
    ) {
        Row {
            Checkbox(checked = false, onCheckedChange = null)
            Text(label, style = MaterialTheme.typography.bodyLarge)
        }
    }
}
