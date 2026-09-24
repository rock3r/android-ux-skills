package com.example.catalogue.ui.reader

import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import kotlinx.coroutines.launch

/** Page controls in the reader. Each tap nudges the controls and they spring back. */
@Composable
fun PageControls(onNext: () -> Unit, modifier: Modifier = Modifier) {
    val turn = MaterialTheme.motionScheme.fastSpatialSpec<Float>()
    val slide = remember { Animatable(0f) }
    var turning by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    Row(modifier.graphicsLayer { translationX = slide.value }) {
        TextButton(
            enabled = !turning,
            onClick = {
                turning = true
                onNext()
                scope.launch {
                    slide.animateTo(-48f, turn)
                    slide.animateTo(0f, turn)
                    turning = false
                }
            },
        ) { Text("Next") }
    }
}

/** Chapter controls in the reader. Each tap nudges the controls and they spring back. */
@Composable
fun ChapterControls(onNextChapter: () -> Unit, modifier: Modifier = Modifier) {
    val turn = MaterialTheme.motionScheme.fastSpatialSpec<Float>()
    val slide = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()

    Row(modifier.graphicsLayer { translationX = slide.value }) {
        TextButton(
            onClick = {
                onNextChapter()
                scope.launch {
                    slide.animateTo(-48f, turn)
                    slide.animateTo(0f, turn)
                }
            },
        ) { Text("Next chapter") }
    }
}
