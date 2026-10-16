package com.example.catalogue.ui.branch

import androidx.compose.foundation.basicMarquee
import androidx.compose.foundation.clickable
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.MotionDurationScale
import kotlinx.coroutines.delay

@Composable
private fun rememberAnimationsOff(): Boolean {
    var off by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        val scale = coroutineContext[MotionDurationScale]
        while (true) {
            off = scale?.scaleFactor == 0f
            delay(500)
        }
    }

    return off
}

/** The branch's opening hours, in a strip above the catalogue on the branch screen. */
@Composable
fun HoursBanner(hours: String, modifier: Modifier = Modifier) {
    val animationsOff = rememberAnimationsOff()

    if (animationsOff) {
        Text(hours, modifier, style = MaterialTheme.typography.labelLarge)
    } else {
        Text(
            text = hours,
            modifier = modifier.basicMarquee(iterations = Int.MAX_VALUE),
            maxLines = 1,
            style = MaterialTheme.typography.labelLarge,
        )
    }
}

/** Upcoming closures, in a strip above the catalogue on the closures screen. */
@Composable
fun ClosuresBanner(closures: String, modifier: Modifier = Modifier) {
    val animationsOff = rememberAnimationsOff()
    var paused by rememberSaveable { mutableStateOf(false) }

    if (animationsOff) {
        Text(closures, modifier, style = MaterialTheme.typography.labelLarge)
    } else {
        val toggle = modifier.clickable(onClickLabel = if (paused) "Resume" else "Pause") {
            paused = !paused
        }
        if (paused) {
            Text(closures, toggle, style = MaterialTheme.typography.labelLarge)
        } else {
            Text(
                text = closures,
                modifier = toggle.basicMarquee(iterations = Int.MAX_VALUE),
                maxLines = 1,
                style = MaterialTheme.typography.labelLarge,
            )
        }
    }
}
