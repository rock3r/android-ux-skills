package com.example.catalogue.ui.shelf

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.collectLatest

/**
 * Sits above the shelf list. [completions] emits each time the hourly sync that WorkManager
 * schedules in the background finishes.
 */
@Composable
fun ScheduledSyncNotice(completions: Flow<Unit>, modifier: Modifier = Modifier) {
    var visible by remember { mutableStateOf(false) }

    LaunchedEffect(completions) {
        completions.collectLatest {
            visible = true
            delay(3_000)
            visible = false
        }
    }

    AnimatedVisibility(
        visible = visible,
        modifier = modifier,
        enter = expandVertically(MaterialTheme.motionScheme.defaultSpatialSpec()) +
            fadeIn(MaterialTheme.motionScheme.defaultEffectsSpec()),
        exit = shrinkVertically(MaterialTheme.motionScheme.fastSpatialSpec()) +
            fadeOut(MaterialTheme.motionScheme.fastEffectsSpec()),
    ) {
        Surface(Modifier.fillMaxWidth(), color = MaterialTheme.colorScheme.secondaryContainer) {
            Text("Your shelf is up to date", style = MaterialTheme.typography.bodyMedium)
        }
    }
}

/** [completions] emits each time a sync the reader started with the Sync now button finishes. */
@Composable
fun ManualSyncNotice(completions: Flow<Unit>, snackbarHostState: SnackbarHostState) {
    LaunchedEffect(completions) {
        completions.collectLatest {
            snackbarHostState.showSnackbar("Your shelf is up to date")
        }
    }
}
