package com.example.catalogue.ui.cover

import androidx.compose.animation.AnimatedVisibilityScope
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.SharedTransitionScope
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.painter.Painter

/** Tapping a cover in the grid opens the book's details in a bottom sheet. */
@OptIn(ExperimentalSharedTransitionApi::class, ExperimentalMaterial3Api::class)
@Composable
fun SharedTransitionScope.CoverDetailsSheet(
    bookId: String,
    cover: Painter,
    visibility: AnimatedVisibilityScope,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Image(
            painter = cover,
            contentDescription = null,
            modifier = Modifier
                .fillMaxWidth()
                .sharedElement(rememberSharedContentState("cover-$bookId"), visibility),
        )
    }
}

/** Tapping a cover on the author page opens the book's details as a full screen. */
@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
fun SharedTransitionScope.CoverDetailsScreen(
    bookId: String,
    cover: Painter,
    visibility: AnimatedVisibilityScope,
) {
    Image(
        painter = cover,
        contentDescription = null,
        modifier = Modifier
            .fillMaxWidth()
            .sharedElement(rememberSharedContentState("cover-$bookId"), visibility),
    )
}
