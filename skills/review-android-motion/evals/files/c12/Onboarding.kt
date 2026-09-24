package com.example.catalogue.ui.onboarding

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController

@Composable
fun OnboardingFlow(onFinished: () -> Unit, modifier: Modifier = Modifier) {
    val navController = rememberNavController()

    Scaffold(modifier = modifier) { padding ->
        NavHost(
            navController = navController,
            startDestination = Step.Welcome,
            modifier = Modifier.padding(padding),
        ) {
            composable<Step.Welcome> {
                StepPage("Borrow books from any branch", "Next") {
                    navController.navigate(Step.Library)
                }
            }
            composable<Step.Library> {
                StepPage("Pick your home library", "Done", onFinished)
            }
        }
    }
}

@Composable
private fun StepPage(title: String, action: String, onAction: () -> Unit) {
    Column(Modifier.padding(24.dp)) {
        Text(title, style = MaterialTheme.typography.headlineSmall)
        Button(onClick = onAction) { Text(action) }
    }
}
