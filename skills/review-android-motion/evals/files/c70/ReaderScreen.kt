package com.example.catalogue.ui.reader

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.EditNote
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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

    Scaffold(
        modifier = modifier,
        bottomBar = { ReaderNavigationBar(navController) },
    ) { padding ->
        NavHost(
            navController = navController,
            startDestination = Route.Shelf,
            modifier = Modifier.padding(padding),
            enterTransition = { fadeIn(AppMotion.destinationEnter) },
            exitTransition = { fadeOut(AppMotion.destinationExit) },
            popEnterTransition = { fadeIn(AppMotion.destinationEnter) },
            popExitTransition = { fadeOut(AppMotion.destinationExit) },
        ) {
            composable<Route.Shelf> { ShelfScreen() }
            composable<Route.Reading> { ReadingScreen() }
            composable<Route.Settings> { SettingsScreen() }
        }
    }
}

@Composable
private fun ReadingScreen() {
    var notesOpen by remember { mutableStateOf(false) }

    BackHandler(enabled = notesOpen) {
        notesOpen = false
    }

    Box(Modifier.fillMaxSize()) {
        Text("\u2026page content\u2026", style = MaterialTheme.typography.bodyLarge)

        IconButton(onClick = { notesOpen = true }) {
            Icon(Icons.Outlined.EditNote, contentDescription = "Notes")
        }

        AnimatedVisibility(
            visible = notesOpen,
            enter = slideInVertically(AppMotion.panelEnter) { it } +
                fadeIn(AppMotion.panelFade),
            exit = slideOutVertically(AppMotion.panelExit) { it } +
                fadeOut(AppMotion.panelFade),
        ) {
            NotesPanel(onClose = { notesOpen = false })
        }
    }
}
