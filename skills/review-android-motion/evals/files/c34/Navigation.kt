package com.example.catalogue.ui

import androidx.compose.animation.AnimatedContentTransitionScope.SlideDirection
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable

/** The app's three bottom-bar sections. */
@Composable
fun MainSections(navController: NavHostController, modifier: Modifier = Modifier) {
    NavHost(
        navController = navController,
        startDestination = Section.Library,
        modifier = modifier,
        enterTransition = { slideIntoContainer(SlideDirection.Start, AppMotion.sectionSpatial()) },
        exitTransition = { slideOutOfContainer(SlideDirection.Start, AppMotion.sectionSpatial()) },
        popEnterTransition = { slideIntoContainer(SlideDirection.End, AppMotion.sectionSpatial()) },
        popExitTransition = { slideOutOfContainer(SlideDirection.End, AppMotion.sectionSpatial()) },
    ) {
        composable<Section.Library> { LibraryScreen() }
        composable<Section.Browse> { BrowseScreen() }
        composable<Section.Account> { AccountScreen() }
    }
}

/** Joining the library: name, then branch, then card. Next and Back move between steps. */
fun NavGraphBuilder.joinSteps() {
    composable<JoinStep.Name>(
        enterTransition = { slideIntoContainer(SlideDirection.Start, AppMotion.sectionSpatial()) },
        exitTransition = { slideOutOfContainer(SlideDirection.Start, AppMotion.sectionSpatial()) },
        popEnterTransition = { slideIntoContainer(SlideDirection.End, AppMotion.sectionSpatial()) },
        popExitTransition = { slideOutOfContainer(SlideDirection.End, AppMotion.sectionSpatial()) },
    ) { NameStep() }
    composable<JoinStep.Branch>(
        enterTransition = { slideIntoContainer(SlideDirection.Start, AppMotion.sectionSpatial()) },
        exitTransition = { slideOutOfContainer(SlideDirection.Start, AppMotion.sectionSpatial()) },
        popEnterTransition = { slideIntoContainer(SlideDirection.End, AppMotion.sectionSpatial()) },
        popExitTransition = { slideOutOfContainer(SlideDirection.End, AppMotion.sectionSpatial()) },
    ) { BranchStep() }
    composable<JoinStep.Card>(
        enterTransition = { slideIntoContainer(SlideDirection.Start, AppMotion.sectionSpatial()) },
        exitTransition = { slideOutOfContainer(SlideDirection.Start, AppMotion.sectionSpatial()) },
        popEnterTransition = { slideIntoContainer(SlideDirection.End, AppMotion.sectionSpatial()) },
        popExitTransition = { slideOutOfContainer(SlideDirection.End, AppMotion.sectionSpatial()) },
    ) { CardStep() }
}
