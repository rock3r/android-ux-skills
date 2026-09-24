package com.example.catalogue.ui.search

import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.material3.AssistChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.MotionDurationScale
import androidx.compose.ui.graphics.graphicsLayer
import kotlinx.coroutines.delay

private const val STAGGER_MILLIS = 50L

/** Every genre in the catalogue, shown when the search field is empty. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun GenreChips(genres: List<String>, onPick: (String) -> Unit, modifier: Modifier = Modifier) {
    FlowRow(modifier) {
        genres.forEachIndexed { index, genre ->
            key(genre) {
                FadingChip(genre, delayMillis = index * STAGGER_MILLIS, onClick = { onPick(genre) })
            }
        }
    }
}

/** Every author the reader has borrowed from, shown under the genres. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AuthorChips(authors: List<String>, onPick: (String) -> Unit, modifier: Modifier = Modifier) {
    FlowRow(modifier) {
        authors.forEachIndexed { index, author ->
            key(author) {
                FadingChip(
                    author,
                    delayMillis = minOf(index, 6) * STAGGER_MILLIS,
                    onClick = { onPick(author) },
                )
            }
        }
    }
}

@Composable
private fun FadingChip(label: String, delayMillis: Long, onClick: () -> Unit) {
    var shown by rememberSaveable { mutableStateOf(false) }
    val alpha = remember { Animatable(if (shown) 1f else 0f) }
    val fade = MaterialTheme.motionScheme.defaultEffectsSpec<Float>()

    LaunchedEffect(Unit) {
        if (!shown) {
            val scale = coroutineContext[MotionDurationScale]?.scaleFactor ?: 1f
            delay((delayMillis * scale).toLong())
            alpha.animateTo(1f, fade)
            shown = true
        }
    }

    AssistChip(
        onClick = onClick,
        label = { Text(label) },
        modifier = Modifier.graphicsLayer { this.alpha = alpha.value },
    )
}
