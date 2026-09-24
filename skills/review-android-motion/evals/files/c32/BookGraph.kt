package com.example.catalogue.ui.book

import androidx.compose.animation.AnimatedContentTransitionScope.SlideDirection
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable

/** Book details, pushed on top of the catalogue list. */
fun NavGraphBuilder.bookDetails() {
    composable<Route.BookDetails>(
        enterTransition = {
            slideIntoContainer(SlideDirection.Start, AppMotion.pushSpatial()) +
                fadeIn(AppMotion.pushEffects())
        },
        popExitTransition = { fadeOut(AppMotion.pushEffects()) },
    ) {
        BookDetailsScreen()
    }
}

/** An author's page, pushed on top of book details. */
fun NavGraphBuilder.authorPage() {
    composable<Route.AuthorPage>(
        enterTransition = {
            slideIntoContainer(SlideDirection.Start, AppMotion.pushSpatial()) +
                fadeIn(AppMotion.pushEffects())
        },
        popExitTransition = {
            slideOutOfContainer(SlideDirection.End, AppMotion.pushSpatial()) +
                fadeOut(AppMotion.pushEffects())
        },
    ) {
        AuthorPageScreen()
    }
}
