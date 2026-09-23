package com.example.catalogue.ui.reviews

import androidx.compose.foundation.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/** Writing a review of a book. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ReviewEditor(text: String, onText: (String) -> Unit, onPost: () -> Unit) {
    val keyboardUp = WindowInsets.isImeVisible

    Column(Modifier.fillMaxSize()) {
        OutlinedTextField(
            value = text,
            onValueChange = onText,
            modifier = Modifier.weight(1f).fillMaxWidth(),
        )
        Button(
            onClick = onPost,
            modifier = Modifier.padding(bottom = if (keyboardUp) 300.dp else 16.dp),
        ) {
            Text("Post review")
        }
    }
}

/** Replying to someone else's review. */
@Composable
fun ReplyEditor(text: String, onText: (String) -> Unit, onSend: () -> Unit) {
    Column(Modifier.fillMaxSize().imePadding()) {
        OutlinedTextField(
            value = text,
            onValueChange = onText,
            modifier = Modifier.weight(1f).fillMaxWidth(),
        )
        Button(onClick = onSend, modifier = Modifier.padding(bottom = 16.dp)) {
            Text("Send reply")
        }
    }
}
