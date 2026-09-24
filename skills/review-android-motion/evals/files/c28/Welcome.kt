package com.example.catalogue.ui.welcome

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.TransformOrigin

/** A card announcing a new branch, shown in the middle of the home screen. */
@Composable
fun BranchAnnouncement(visible: Boolean, modifier: Modifier = Modifier) {
    Box(modifier, contentAlignment = Alignment.Center) {
        AnimatedVisibility(
            visible = visible,
            enter = scaleIn(MaterialTheme.motionScheme.defaultSpatialSpec(), initialScale = 0.8f) +
                fadeIn(MaterialTheme.motionScheme.defaultEffectsSpec()),
            exit = fadeOut(MaterialTheme.motionScheme.fastEffectsSpec()),
        ) {
            Card { Text("A new branch opens in Harbour Street") }
        }
    }
}

/** Sort options, opened from the Sort button above them. */
@Composable
fun SortMenu(open: Boolean, onToggle: () -> Unit, modifier: Modifier = Modifier) {
    Column(modifier) {
        TextButton(onClick = onToggle) { Text("Sort") }
        AnimatedVisibility(
            visible = open,
            enter = scaleIn(
                MaterialTheme.motionScheme.fastSpatialSpec(),
                initialScale = 0.8f,
                transformOrigin = TransformOrigin(0f, 0f),
            ) + fadeIn(MaterialTheme.motionScheme.fastEffectsSpec()),
            exit = fadeOut(MaterialTheme.motionScheme.fastEffectsSpec()),
        ) {
            Card {
                Text("Title", style = MaterialTheme.typography.bodyLarge)
                Text("Author", style = MaterialTheme.typography.bodyLarge)
            }
        }
    }
}
