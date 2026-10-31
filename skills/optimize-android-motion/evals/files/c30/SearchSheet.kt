package com.example.travel.ui.search

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsBottomHeight
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SheetState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/** Airport picker bottom sheet that adjusts when the software keyboard opens. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AirportSearchSheet(
    keyboardOpen: Boolean,
    sheetState: SheetState,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState, modifier = modifier) {
        BoxWithConstraints(Modifier.fillMaxWidth()) {
            Column(Modifier.fillMaxWidth()) {
                if (!keyboardOpen && maxHeight > 320.dp) {
                    Canvas(Modifier.size(96.dp)) {
                        drawCircle(Color(0xFF26A69A), radius = size.minDimension / 2f)
                    }
                }
                Text("Search airports")
                if (keyboardOpen) {
                    Spacer(Modifier.height(280.dp))
                }
            }
        }
    }
}

/** Train station picker bottom sheet that tracks IME insets continuously. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StationSearchSheet(
    sheetState: SheetState,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState, modifier = modifier) {
        Column(Modifier.fillMaxWidth()) {
            Canvas(Modifier.size(96.dp)) {
                drawCircle(Color(0xFF42A5F5), radius = size.minDimension / 2f)
            }
            Text("Search stations")
            Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.ime))
        }
    }
}
