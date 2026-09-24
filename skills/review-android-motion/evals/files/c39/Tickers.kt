package com.example.catalogue.ui.home

import android.provider.Settings
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext

private const val PIXELS_PER_SECOND = 40f

/** News headlines scrolling across the top of the home screen. */
@Composable
fun NewsTicker(headlines: String, modifier: Modifier = Modifier) {
    var scroll by remember { mutableFloatStateOf(0f) }

    LaunchedEffect(Unit) {
        var last = withFrameNanos { it }
        while (true) {
            withFrameNanos { now ->
                scroll -= (now - last) / 1_000_000_000f * PIXELS_PER_SECOND
                last = now
            }
        }
    }

    Text(
        text = headlines,
        modifier = modifier.graphicsLayer { translationX = scroll },
        style = MaterialTheme.typography.labelLarge,
    )
}

/** Branch events scrolling across the top of the branch screen. */
@Composable
fun EventsTicker(events: String, modifier: Modifier = Modifier) {
    val resolver = LocalContext.current.contentResolver
    val animationsOff = remember(resolver) {
        try {
            Settings.Global.getFloat(resolver, Settings.Global.ANIMATOR_DURATION_SCALE) == 0f
        } catch (_: Settings.SettingNotFoundException) {
            false
        }
    }
    var scroll by remember { mutableFloatStateOf(0f) }

    LaunchedEffect(animationsOff) {
        if (animationsOff) return@LaunchedEffect
        var last = withFrameNanos { it }
        while (true) {
            withFrameNanos { now ->
                scroll -= (now - last) / 1_000_000_000f * PIXELS_PER_SECOND
                last = now
            }
        }
    }

    Text(
        text = events,
        modifier = modifier.graphicsLayer { translationX = scroll },
        style = MaterialTheme.typography.labelLarge,
    )
}
