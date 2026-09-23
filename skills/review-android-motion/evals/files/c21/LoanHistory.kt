package com.example.catalogue.ui.loans

import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

/** Books the reader has borrowed before, newest first. */
@Composable
fun LoanHistory(loans: List<Loan>, modifier: Modifier = Modifier) {
    LazyColumn(modifier) {
        items(loans) { loan ->
            Text(
                text = loan.title,
                modifier = Modifier.animateItem(),
                style = MaterialTheme.typography.bodyLarge,
            )
        }
    }
}

/** Books the reader is waiting for, in queue order. */
@Composable
fun Holds(holds: List<Hold>, modifier: Modifier = Modifier) {
    LazyColumn(modifier) {
        items(holds, key = { it.id }) { hold ->
            Text(
                text = hold.title,
                modifier = Modifier.animateItem(),
                style = MaterialTheme.typography.bodyLarge,
            )
        }
    }
}
