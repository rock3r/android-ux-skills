package com.example.catalogue.ui.holds

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import kotlinx.coroutines.launch

/** Place a hold on a book. The button becomes the hold's status. */
@Composable
fun PlaceHoldButton(placeHold: suspend () -> Boolean, modifier: Modifier = Modifier) {
    var state by remember { mutableStateOf(HoldState.None) }
    val scope = rememberCoroutineScope()

    AnimatedContent(
        targetState = state,
        modifier = modifier,
        transitionSpec = {
            fadeIn(MaterialTheme.motionScheme.defaultEffectsSpec()) togetherWith
                fadeOut(MaterialTheme.motionScheme.fastEffectsSpec())
        },
        label = "hold",
    ) { current ->
        when (current) {
            HoldState.None -> Button(onClick = {
                scope.launch {
                    val placed = placeHold()
                    state = if (placed) HoldState.Placed else HoldState.None
                }
            }) { Text("Place hold") }
            HoldState.Placing -> CircularProgressIndicator()
            HoldState.Placed -> Text("On hold", style = MaterialTheme.typography.labelLarge)
        }
    }
}

/** Renew a loan. The button becomes the loan's status. */
@Composable
fun RenewButton(renew: suspend () -> Boolean, modifier: Modifier = Modifier) {
    var state by remember { mutableStateOf(HoldState.None) }
    val scope = rememberCoroutineScope()

    AnimatedContent(
        targetState = state,
        modifier = modifier,
        transitionSpec = {
            fadeIn(MaterialTheme.motionScheme.defaultEffectsSpec()) togetherWith
                fadeOut(MaterialTheme.motionScheme.fastEffectsSpec())
        },
        label = "renew",
    ) { current ->
        when (current) {
            HoldState.None -> Button(onClick = {
                state = HoldState.Placing
                scope.launch {
                    val renewed = renew()
                    state = if (renewed) HoldState.Placed else HoldState.None
                }
            }) { Text("Renew") }
            HoldState.Placing -> CircularProgressIndicator()
            HoldState.Placed -> Text("Renewed", style = MaterialTheme.typography.labelLarge)
        }
    }
}

enum class HoldState { None, Placing, Placed }
