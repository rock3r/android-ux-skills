package com.example.catalogue.ui.shelf

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector

/** The holds tab icon, with the number of holds ready to collect. */
@Composable
fun HoldsIcon(icon: ImageVector, ready: Int, modifier: Modifier = Modifier) {
    BadgedBox(
        modifier = modifier,
        badge = {
            AnimatedVisibility(
                visible = ready > 0,
                enter = scaleIn(MaterialTheme.motionScheme.fastSpatialSpec()) +
                    fadeIn(MaterialTheme.motionScheme.fastEffectsSpec()),
                exit = scaleOut(MaterialTheme.motionScheme.fastSpatialSpec()) +
                    fadeOut(MaterialTheme.motionScheme.fastEffectsSpec()),
            ) {
                Badge { Text("$ready") }
            }
        },
    ) {
        Icon(icon, contentDescription = "Holds")
    }
}

/** The loans tab icon, with the number of loans due this week. */
@Composable
fun LoansIcon(icon: ImageVector, due: Int, modifier: Modifier = Modifier) {
    BadgedBox(
        modifier = modifier,
        badge = {
            AnimatedVisibility(
                visible = due > 0,
                enter = scaleIn(MaterialTheme.motionScheme.fastSpatialSpec()) +
                    fadeIn(MaterialTheme.motionScheme.fastEffectsSpec()),
                exit = fadeOut(MaterialTheme.motionScheme.fastEffectsSpec()),
            ) {
                Badge { Text("$due") }
            }
        },
    ) {
        Icon(icon, contentDescription = "Loans")
    }
}
