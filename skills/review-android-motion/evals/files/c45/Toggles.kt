package com.example.catalogue.ui.book

import androidx.compose.animation.core.Animatable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.outlined.BookmarkBorder
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material3.Icon
import androidx.compose.material3.IconToggleButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import kotlinx.coroutines.launch

/** Adds the book to the reader's favourites, or takes it out again. */
@Composable
fun FavouriteToggle(favourite: Boolean, onChange: (Boolean) -> Unit, modifier: Modifier = Modifier) {
    val scale = remember { Animatable(1f) }
    val pop = MaterialTheme.motionScheme.fastSpatialSpec<Float>()
    val scope = rememberCoroutineScope()

    IconToggleButton(
        checked = favourite,
        onCheckedChange = { checked ->
            onChange(checked)
            scope.launch {
                scale.snapTo(0.6f)
                scale.animateTo(1f, pop)
            }
        },
        modifier = modifier,
    ) {
        Icon(
            if (favourite) Icons.Filled.Favorite else Icons.Outlined.FavoriteBorder,
            contentDescription = "Favourite",
            modifier = Modifier.graphicsLayer {
                scaleX = scale.value
                scaleY = scale.value
            },
        )
    }
}

/** Saves the book to read later, or removes it from the list again. */
@Composable
fun SaveToggle(saved: Boolean, onChange: (Boolean) -> Unit, modifier: Modifier = Modifier) {
    val scale = remember { Animatable(1f) }
    val pop = MaterialTheme.motionScheme.fastSpatialSpec<Float>()
    val scope = rememberCoroutineScope()

    IconToggleButton(
        checked = saved,
        onCheckedChange = { checked ->
            onChange(checked)
            if (checked) {
                scope.launch {
                    scale.snapTo(0.6f)
                    scale.animateTo(1f, pop)
                }
            }
        },
        modifier = modifier,
    ) {
        Icon(
            if (saved) Icons.Filled.Bookmark else Icons.Outlined.BookmarkBorder,
            contentDescription = "Read later",
            modifier = Modifier.graphicsLayer {
                scaleX = scale.value
                scaleY = scale.value
            },
        )
    }
}
