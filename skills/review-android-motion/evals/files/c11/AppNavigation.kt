package com.example.catalogue.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController

@Composable
fun AppNavigation(modifier: Modifier = Modifier) {
    val navController = rememberNavController()

    Scaffold(
        modifier = modifier,
        bottomBar = { CatalogueNavigationBar(navController) },
    ) { padding ->
        NavHost(
            navController = navController,
            startDestination = Route.Library,
            modifier = Modifier.padding(padding),
            enterTransition = { fadeIn(AppMotion.destinationEnter) },
            exitTransition = { fadeOut(AppMotion.destinationExit) },
            popEnterTransition = { fadeIn(AppMotion.destinationEnter) },
            popExitTransition = { fadeOut(AppMotion.destinationExit) },
        ) {
            composable<Route.Library> { LibraryScreen() }
            composable<Route.Browse> { BrowseScreen() }
            composable<Route.Settings> { SettingsScreen() }
        }
    }
}

@Composable
private fun BorrowedList(books: List<Book>, modifier: Modifier = Modifier) {
    LazyColumn(modifier) {
        items(books, key = { it.id }) { book ->
            Text(
                text = book.title,
                modifier = Modifier.animateItem(),
                style = MaterialTheme.typography.bodyLarge,
            )
        }
    }
}

@Composable
private fun StatusBanner(visible: Boolean, modifier: Modifier = Modifier) {
    val alpha by animateFloatAsState(
        targetValue = if (visible) 1f else 0f,
        animationSpec = MaterialTheme.motionScheme.defaultEffectsSpec(),
        label = "bannerAlpha",
    )

    Box(modifier.graphicsLayer { this.alpha = alpha }) {
        Text(
            text = "Syncing your library",
            style = MaterialTheme.typography.labelLarge,
        )
    }
}
