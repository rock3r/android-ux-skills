package com.example.catalogue.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.exponentialDecay
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.IntOffset
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController

@Composable
fun AppNavigation(modifier: Modifier = Modifier) {
    val navController = rememberNavController()

    Scaffold(modifier = modifier) { padding ->
        NavHost(
            navController = navController,
            startDestination = Route.Library,
            modifier = Modifier.padding(padding),
        ) {
            composable<Route.Library> {
                LibraryScreen(onOpen = { navController.navigate(Route.Detail(it)) })
            }
            composable<Route.Detail> { entry ->
                DetailScreen(id = entry.toRoute<Route.Detail>().id)
            }
            composable<Route.Settings> {
                SettingsScreen()
            }
        }
    }
}

@Composable
private fun DismissibleCard(onDismissed: () -> Unit) {
    val offsetX = remember { Animatable(0f) }

    Box(
        Modifier
            .fillMaxSize()
            .offset { IntOffset(offsetX.value.toInt(), 0) }
            .pointerInput(Unit) {
                detectHorizontalDragGestures(
                    onHorizontalDrag = { _, delta ->
                        launch { offsetX.snapTo(offsetX.value + delta) }
                    },
                    onDragEnd = {
                        launch {
                            val result = offsetX.animateDecay(
                                initialVelocity = trackedVelocity,
                                animationSpec = exponentialDecay(),
                            )
                            if (result.endReason == AnimationEndReason.Finished) onDismissed()
                        }
                    },
                )
            },
    ) {
        Text("Swipe to dismiss", style = MaterialTheme.typography.bodyLarge)
    }
}

@Composable
private fun StatusBanner(visible: Boolean) {
    val alpha by animateFloatAsState(
        targetValue = if (visible) 1f else 0f,
        animationSpec = MaterialTheme.motionScheme.defaultEffectsSpec(),
        label = "bannerAlpha",
    )

    Box(Modifier.graphicsLayer { this.alpha = alpha }) {
        Text("Syncing your library", style = MaterialTheme.typography.labelLarge)
    }
}
