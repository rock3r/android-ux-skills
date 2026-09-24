package com.example.catalogue.ui.stats

import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.MaterialExpressiveTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MotionScheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp

private val StandardMotion = MotionScheme.standard()

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun CatalogueTheme(content: @Composable () -> Unit) {
    MaterialExpressiveTheme(motionScheme = MotionScheme.expressive(), content = content)
}

/** Minutes read on each day of this week, as a fraction of the busiest day. */
@Composable
fun WeekChart(days: List<Float>, modifier: Modifier = Modifier) {
    Row(modifier.height(120.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        days.forEach { fraction ->
            val shown by animateFloatAsState(
                targetValue = fraction,
                animationSpec = MaterialTheme.motionScheme.fastSpatialSpec(),
                label = "dayBar",
            )
            Bar(shown)
        }
    }
}

/** Books finished in each month of this year, as a fraction of the busiest month. */
@Composable
fun YearChart(months: List<Float>, modifier: Modifier = Modifier) {
    Row(modifier.height(120.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        months.forEach { fraction ->
            val shown by animateFloatAsState(
                targetValue = fraction,
                animationSpec = StandardMotion.fastSpatialSpec(),
                label = "monthBar",
            )
            Bar(shown)
        }
    }
}

/** The stats card on the profile screen. Tap it to show the year as well as the week. */
@Composable
fun StatsCard(week: List<Float>, year: List<Float>, expanded: Boolean, modifier: Modifier = Modifier) {
    Card(modifier.animateContentSize(MaterialTheme.motionScheme.fastSpatialSpec())) {
        Column {
            Text("This week", style = MaterialTheme.typography.titleMedium)
            WeekChart(week)
            if (expanded) {
                Text("This year", style = MaterialTheme.typography.titleMedium)
                YearChart(year)
            }
        }
    }
}

@Composable
private fun Bar(fraction: Float) {
    Box(
        Modifier
            .width(12.dp)
            .fillMaxHeight()
            .graphicsLayer {
                scaleY = fraction
                transformOrigin = TransformOrigin(0.5f, 1f)
            }
            .background(MaterialTheme.colorScheme.primary),
    )
}
