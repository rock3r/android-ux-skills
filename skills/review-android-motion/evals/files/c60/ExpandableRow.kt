package com.example.catalogue.ui.library

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.unit.dp

/**
 * A book in the library list. Tapping it reveals the blurb.
 */
@Composable
fun BookRow(expanded: Boolean, blurb: String, modifier: Modifier = Modifier) {
    Card(
        modifier
            .fillMaxWidth()
            .shadow(6.dp)
            .animateContentSize(),
    ) {
        Column {
            Text("The Wind in the Willows", style = MaterialTheme.typography.titleMedium)
            if (expanded) {
                Text(blurb, style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}

/**
 * The blurb on the detail screen, collapsed to three lines until tapped. The text is meant
 * to be cut off mid-line while collapsed — that is the affordance telling you there is more.
 */
@Composable
fun CollapsibleBlurb(expanded: Boolean, blurb: String, modifier: Modifier = Modifier) {
    Column(
        modifier
            .fillMaxWidth()
            .heightIn(max = if (expanded) Dp.Unspecified else 64.dp)
            .clipToBounds()
            .animateContentSize(),
    ) {
        Text(blurb, style = MaterialTheme.typography.bodyMedium)
    }
}
