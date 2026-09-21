package com.example.catalogue.ui.reader

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController

@Composable
fun ReaderHost(modifier: Modifier = Modifier) {
    val navController = rememberNavController()

    Scaffold(modifier) { padding ->
        NavHost(
            navController = navController,
            startDestination = Route.Shelf,
            modifier = Modifier.padding(padding),
            enterTransition = { fadeIn(AppMotion.destinationEnter) },
            exitTransition = { fadeOut(AppMotion.destinationExit) },
            popEnterTransition = { fadeIn(AppMotion.destinationEnter) },
            popExitTransition = { fadeOut(AppMotion.destinationExit) },
        ) {
            composable<Route.Shelf> { ShelfScreen(onOpen = { navController.navigate(it) }) }
            composable<Route.Reading> { ReadingScreen() }
        }
    }
}

/**
 * The notes panel slides up over the page. It is not a destination — it is local state on
 * the reading screen, so back has to be handled here.
 */
@Composable
private fun ReadingScreen() {
    var notesOpen by remember { mutableStateOf(false) }

    BackHandler(enabled = notesOpen) {
        notesOpen = false
    }

    Box(Modifier.fillMaxSize()) {
        Text("…page content…", style = MaterialTheme.typography.bodyLarge)
        if (notesOpen) {
            NotesPanel(onClose = { notesOpen = false })
        }
    }
}
