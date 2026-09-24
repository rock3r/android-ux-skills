package com.example.catalogue.ui.shelf

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp

/** A book on the shelf. Selecting it nudges the title in from the spine. */
@Composable
fun ShelfCard(selected: Boolean, title: String, modifier: Modifier = Modifier) {
    val inset by animateDpAsState(
        targetValue = if (selected) 24.dp else 8.dp,
        animationSpec = MaterialTheme.motionScheme.fastSpatialSpec(),
        label = "titleInset",
    )

    Box(modifier) {
        Text(
            text = title,
            modifier = Modifier.padding(start = inset),
            style = MaterialTheme.typography.titleMedium,
        )
    }
}

/** The same book in the reading list. Selecting it nudges the title the same way. */
@Composable
fun ReadingListRow(selected: Boolean, title: String, modifier: Modifier = Modifier) {
    val nudge by animateDpAsState(
        targetValue = if (selected) 16.dp else 0.dp,
        animationSpec = MaterialTheme.motionScheme.fastSpatialSpec(),
        label = "titleNudge",
    )

    Box(modifier.padding(start = 8.dp)) {
        Text(
            text = title,
            modifier = Modifier.offset { IntOffset(nudge.roundToPx(), 0) },
            style = MaterialTheme.typography.titleMedium,
        )
    }
}
