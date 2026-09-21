package com.example.catalogue.ui.checkout

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.foundation.layout.offset
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp

/** The order summary on the checkout screen. */
@Composable
fun CheckoutSummary(discountApplied: Boolean, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth()) {
        TotalRow(discountApplied)
        SavingsBadge(discountApplied)
        PostageNote(discountApplied)
        LoyaltyPoints(discountApplied)
        CheckoutButton(discountApplied)
    }
}

@Composable
private fun TotalRow(discounted: Boolean) {
    val lift by animateDpAsState(
        targetValue = if (discounted) (-8).dp else 0.dp,
        animationSpec = MaterialTheme.motionScheme.defaultSpatialSpec(),
        label = "totalLift",
    )
    Text(
        text = if (discounted) "£38.40" else "£48.00",
        modifier = Modifier.offset { IntOffset(0, lift.roundToPx()) },
        style = MaterialTheme.typography.headlineMedium,
    )
}

@Composable
private fun SavingsBadge(discounted: Boolean) {
    AnimatedVisibility(
        visible = discounted,
        enter = slideInVertically(MaterialTheme.motionScheme.defaultSpatialSpec()) { it / 2 } +
            fadeIn(MaterialTheme.motionScheme.defaultEffectsSpec()),
        exit = fadeOut(MaterialTheme.motionScheme.fastEffectsSpec()),
    ) {
        Card { Text("You saved £9.60", style = MaterialTheme.typography.labelLarge) }
    }
}

@Composable
private fun PostageNote(discounted: Boolean) {
    val shift by animateDpAsState(
        targetValue = if (discounted) 12.dp else 0.dp,
        animationSpec = MaterialTheme.motionScheme.defaultSpatialSpec(),
        label = "postageShift",
    )
    Text(
        text = "Free postage over £35",
        modifier = Modifier.offset { IntOffset(0, shift.roundToPx()) },
        style = MaterialTheme.typography.bodySmall,
    )
}

@Composable
private fun LoyaltyPoints(discounted: Boolean) {
    val fade by animateFloatAsState(
        targetValue = if (discounted) 1f else 0.4f,
        animationSpec = MaterialTheme.motionScheme.defaultEffectsSpec(),
        label = "pointsFade",
    )
    Text(
        text = "Earn 38 points",
        modifier = Modifier.graphicsLayer { alpha = fade },
        style = MaterialTheme.typography.bodySmall,
    )
}

@Composable
private fun CheckoutButton(discounted: Boolean) {
    val tint by animateColorAsState(
        targetValue = if (discounted) MaterialTheme.colorScheme.primary
        else MaterialTheme.colorScheme.secondary,
        animationSpec = MaterialTheme.motionScheme.defaultEffectsSpec(),
        label = "buttonTint",
    )
    Card(Modifier.fillMaxWidth().drawBehind { drawRect(tint) }) {
        Text("Checkout", style = MaterialTheme.typography.titleMedium)
    }
}
