package com.example.travel.ui.onboarding

import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt

/** First-run welcome step deck with two precomposed pages. */
@Composable
fun WelcomeStepDeck(
    activeStep: Int,
    onContinue: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val slideDp = remember { Animatable(0f) }
    val fastSpatial = MaterialTheme.motionScheme.fastSpatialSpec<Float>()
    LaunchedEffect(activeStep) {
        slideDp.animateTo(if (activeStep == 0) 0f else -360f, animationSpec = fastSpatial)
    }

    Box(modifier.fillMaxSize()) {
        Column(
            Modifier
                .fillMaxSize()
                .offset(x = slideDp.value.dp)
                .then(if (activeStep != 0) Modifier.clearAndSetSemantics {} else Modifier),
        ) {
            Text("Welcome aboard", style = MaterialTheme.typography.headlineMedium)
            Button(onClick = onContinue) { Text("Next") }
        }
    }
}

/** Profile setup deck with off-screen precomposition and input gating. */
@Composable
fun ProfileStepDeck(
    isActive: Boolean,
    widthPx: Float,
    onContinue: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val progress = remember { Animatable(if (isActive) 1f else 0f) }
    val fastSpatial = MaterialTheme.motionScheme.fastSpatialSpec<Float>()
    LaunchedEffect(isActive) {
        progress.animateTo(if (isActive) 1f else 0f, animationSpec = fastSpatial)
    }

    Box(modifier.fillMaxSize().clipToBounds()) {
        Column(
            Modifier
                .fillMaxSize()
                .then(
                    if (!isActive) {
                        Modifier
                            .clearAndSetSemantics {}
                            .focusProperties { canFocus = false }
                            .onPreviewKeyEvent { true }
                            .pointerInput(Unit) {
                                awaitPointerEventScope {
                                    while (true) {
                                        val event = awaitPointerEvent(PointerEventPass.Initial)
                                        event.changes.forEach { it.consume() }
                                    }
                                }
                            }
                    } else {
                        Modifier
                    },
                )
                .offset {
                    IntOffset(((1f - progress.value) * widthPx).roundToInt(), 0)
                },
        ) {
            Text("Your sleep schedule", style = MaterialTheme.typography.headlineMedium)
            Button(onClick = onContinue) { Text("Save") }
        }
    }
}
