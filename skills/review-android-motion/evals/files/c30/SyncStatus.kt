package com.example.catalogue.ui.sync

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import com.airbnb.lottie.compose.LottieAnimation
import com.airbnb.lottie.compose.LottieCompositionSpec
import com.airbnb.lottie.compose.animateLottieCompositionAsState
import com.airbnb.lottie.compose.rememberLottieComposition

/** Shown in place of the Sync now button for a few seconds after the sync it started. */
@Composable
fun SyncComplete(modifier: Modifier = Modifier) {
    val composition by rememberLottieComposition(
        LottieCompositionSpec.RawRes(R.raw.sync_complete),
    )
    val progress by animateLottieCompositionAsState(composition)

    LottieAnimation(
        composition = composition,
        progress = { progress },
        modifier = modifier.fillMaxWidth(),
    )
}

/** Empty state for a filter that matched nothing. */
@Composable
fun NoResults(modifier: Modifier = Modifier) {
    val composition by rememberLottieComposition(
        LottieCompositionSpec.RawRes(R.raw.empty_box),
    )
    val progress by animateLottieCompositionAsState(composition)

    Column(modifier.fillMaxWidth()) {
        LottieAnimation(
            composition = composition,
            progress = { progress },
            modifier = Modifier.fillMaxWidth(),
        )
        Text(
            text = "No books match those filters",
            style = MaterialTheme.typography.bodyLarge,
        )
    }
}
