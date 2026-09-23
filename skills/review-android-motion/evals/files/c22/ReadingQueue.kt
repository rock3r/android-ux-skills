package com.example.catalogue.ui.queue

import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

/** What the reader plans to read next. */
@Composable
fun UpNext(books: List<Book>, modifier: Modifier = Modifier) {
    LazyColumn(modifier) {
        itemsIndexed(books, key = { index, _ -> index }) { index, book ->
            Text(
                text = "${index + 1}. ${book.title}",
                modifier = Modifier.animateItem(),
                style = MaterialTheme.typography.bodyLarge,
            )
        }
    }
}

/** Books finished this year, most recent first. */
@Composable
fun FinishedThisYear(books: List<Book>, modifier: Modifier = Modifier) {
    LazyColumn(modifier) {
        itemsIndexed(books, key = { _, book -> book.id }) { index, book ->
            Text(
                text = "${index + 1}. ${book.title}",
                modifier = Modifier.animateItem(),
                style = MaterialTheme.typography.bodyLarge,
            )
        }
    }
}
