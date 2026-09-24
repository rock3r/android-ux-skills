package com.example.catalogue.ui

import androidx.compose.foundation.LocalOverscrollFactory
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier

/** The root of the app. Every screen is composed inside it. */
@Composable
fun CatalogueApp(content: @Composable () -> Unit) {
    MaterialTheme {
        CompositionLocalProvider(LocalOverscrollFactory provides null) {
            content()
        }
    }
}

/** The featured-books carousel on the home screen. It wraps around endlessly. */
@Composable
fun FeaturedCarousel(books: List<Book>, modifier: Modifier = Modifier) {
    val pager = rememberPagerState(pageCount = { Int.MAX_VALUE })
    HorizontalPager(
        state = pager,
        modifier = modifier,
        overscrollEffect = null,
    ) { page ->
        FeaturedBook(books[page % books.size])
    }
}
