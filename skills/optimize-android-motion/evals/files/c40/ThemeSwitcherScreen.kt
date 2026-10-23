package com.example.travel.ui.settings

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.rememberGraphicsLayer
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

/** Theme container that interpolates background and text colors across frames. */
@Composable
fun InterpolatedThemeHost(
    darkTheme: Boolean,
    modifier: Modifier = Modifier,
    content: @Composable (Color) -> Unit,
) {
    val progress by animateFloatAsState(
        targetValue = if (darkTheme) 1f else 0f,
        animationSpec = MaterialTheme.motionScheme.defaultEffectsSpec(),
        label = "themeProgress",
    )
    val bg = lerp(Color(0xFFFFFBFE), Color(0xFF1C1B1F), progress)
    val fg = lerp(Color(0xFF1C1B1F), Color(0xFFE6E1E5), progress)

    Box(modifier.fillMaxSize().background(bg)) {
        content(fg)
    }
}

/** Settings list that reveals each row with an index-multiplied delay. */
@Composable
fun StaggeredSettingsList(
    sections: List<String>,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxWidth()) {
        sections.forEachIndexed { index, title ->
            val alpha = remember { Animatable(0f) }
            val fastEffects = MaterialTheme.motionScheme.fastEffectsSpec<Float>()
            LaunchedEffect(title) {
                delay(index * 45L)
                alpha.animateTo(1f, animationSpec = fastEffects)
            }
            Text(
                text = title,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp)
                    .graphicsLayer { this.alpha = alpha.value },
            )
        }
    }
}

/** Theme container that snapshots the outgoing look once and fades the bitmap overlay. */
@Composable
fun SnapshotThemeHost(
    darkTheme: Boolean,
    modifier: Modifier = Modifier,
    content: @Composable (Boolean) -> Unit,
) {
    val captureLayer = rememberGraphicsLayer()
    var displayedDark by remember { mutableStateOf(darkTheme) }
    var snapshot by remember { mutableStateOf<ImageBitmap?>(null) }
    val overlayAlpha = remember { Animatable(0f) }
    val effectsSpec = MaterialTheme.motionScheme.defaultEffectsSpec<Float>()

    LaunchedEffect(darkTheme) {
        if (displayedDark == darkTheme) {
            overlayAlpha.snapTo(0f)
            snapshot = null
            return@LaunchedEffect
        }
        try {
            snapshot = captureLayer.toImageBitmap()
            overlayAlpha.snapTo(1f)
            displayedDark = darkTheme
            overlayAlpha.animateTo(0f, animationSpec = effectsSpec)
        } finally {
            overlayAlpha.snapTo(0f)
            snapshot = null
        }
    }

    val transitioning = snapshot != null
    Box(
        modifier
            .fillMaxSize()
            .then(
                if (transitioning) {
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
            .drawWithContent {
                captureLayer.record { this@drawWithContent.drawContent() }
                drawLayer(captureLayer)
                snapshot?.let { bmp ->
                    drawImage(bmp, alpha = overlayAlpha.value)
                }
            },
    ) {
        content(displayedDark)
    }
}
