package com.example.catalogue.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
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
    AnimatedVisibility(
        visible = visible,
        modifier = modifier,
        enter = expandVertically(MaterialTheme.motionScheme.defaultSpatialSpec()) +
            fadeIn(MaterialTheme.motionScheme.defaultEffectsSpec()),
        exit = fadeOut(MaterialTheme.motionScheme.fastEffectsSpec()) +
            shrinkVertically(MaterialTheme.motionScheme.fastSpatialSpec()),
    ) {
        Text(
            text = "You're offline. Showing books saved on this device.",
            style = MaterialTheme.typography.labelLarge,
        )
    }
}
