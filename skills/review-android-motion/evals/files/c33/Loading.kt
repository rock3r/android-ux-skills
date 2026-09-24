package com.example.catalogue.ui.search

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import kotlinx.coroutines.delay

/** Search results for the catalogue search box. */
@Composable
fun SearchResults(loading: Boolean, results: @Composable () -> Unit, modifier: Modifier = Modifier) {
    AnimatedContent(
        targetState = loading,
        modifier = modifier,
        transitionSpec = {
            fadeIn(MaterialTheme.motionScheme.defaultEffectsSpec()) togetherWith
                fadeOut(MaterialTheme.motionScheme.fastEffectsSpec())
        },
        label = "searchResults",
    ) { isLoading ->
        if (isLoading) CircularProgressIndicator() else results()
    }
}

/** A branch's opening hours on the branch page. */
@Composable
fun BranchHours(loading: Boolean, hours: @Composable () -> Unit, modifier: Modifier = Modifier) {
    var showIndicator by remember { mutableStateOf(false) }

    LaunchedEffect(loading) {
        if (loading) {
            delay(INDICATOR_DELAY_MS)
            showIndicator = true
        } else {
            if (showIndicator) delay(INDICATOR_MIN_VISIBLE_MS)
            showIndicator = false
        }
    }

    AnimatedContent(
        targetState = showIndicator,
        modifier = modifier,
        transitionSpec = {
            fadeIn(MaterialTheme.motionScheme.defaultEffectsSpec()) togetherWith
                fadeOut(MaterialTheme.motionScheme.fastEffectsSpec())
        },
        label = "branchHours",
    ) { indicator ->
        if (indicator) CircularProgressIndicator() else hours()
    }
}

private const val INDICATOR_DELAY_MS = 150L
private const val INDICATOR_MIN_VISIBLE_MS = 400L
