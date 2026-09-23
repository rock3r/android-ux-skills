package com.example.catalogue.ui.detail

import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.Image
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.painter.Painter

/** Top of the book screen. */
@Composable
fun BookCover(cover: Painter, modifier: Modifier = Modifier) {
    val enter = MaterialTheme.motionScheme.defaultEffectsSpec<Float>()
    val alpha = remember { Animatable(0f) }

    LaunchedEffect(Unit) {
        alpha.animateTo(1f, enter)
    }

    Image(
        painter = cover,
        contentDescription = null,
        modifier = modifier.graphicsLayer { this.alpha = alpha.value },
    )
}

/** Top of the author screen. */
@Composable
fun AuthorPortrait(portrait: Painter, modifier: Modifier = Modifier) {
    val enter = MaterialTheme.motionScheme.defaultEffectsSpec<Float>()
    var introduced by rememberSaveable { mutableStateOf(false) }
    val alpha = remember { Animatable(if (introduced) 1f else 0f) }

    LaunchedEffect(introduced) {
        if (!introduced) {
            alpha.animateTo(1f, enter)
            introduced = true
        }
    }

    Image(
        painter = portrait,
        contentDescription = null,
        modifier = modifier.graphicsLayer { this.alpha = alpha.value },
    )
}
