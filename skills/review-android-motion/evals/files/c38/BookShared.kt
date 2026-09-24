package com.example.catalogue.ui.book

import androidx.compose.animation.AnimatedVisibilityScope
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.SharedTransitionScope
import androidx.compose.foundation.Image
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.painter.Painter

/** A book's title, shown in the list row and on the details screen. */
@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
fun SharedTransitionScope.BookTitle(
    bookId: String,
    title: String,
    onDetails: Boolean,
    visibility: AnimatedVisibilityScope,
) {
    Text(
        text = title,
        style = if (onDetails) MaterialTheme.typography.headlineMedium
        else MaterialTheme.typography.bodyLarge,
        modifier = Modifier.sharedElement(rememberSharedContentState("title-$bookId"), visibility),
    )
}

/** A book's cover, shown in the list row and on the details screen. */
@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
fun SharedTransitionScope.BookCover(
    bookId: String,
    cover: Painter,
    visibility: AnimatedVisibilityScope,
) {
    Image(
        painter = cover,
        contentDescription = null,
        modifier = Modifier.sharedElement(rememberSharedContentState("cover-$bookId"), visibility),
    )
}
