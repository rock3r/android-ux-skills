package com.example.catalogue.ui.settings

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun SyncSettings(
    syncOverCellular: Boolean,
    onSyncOverCellular: (Boolean) -> Unit,
    downloadAhead: Float,
    onDownloadAhead: (Float) -> Unit,
    onSyncNow: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxWidth().padding(16.dp)) {
        Text("Syncing", style = MaterialTheme.typography.titleMedium)

        Row(
            modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("Sync over cellular", style = MaterialTheme.typography.bodyLarge)
            Switch(
                checked = syncOverCellular,
                onCheckedChange = onSyncOverCellular,
            )
        }

        Text("Chapters to download ahead", style = MaterialTheme.typography.bodyLarge)
        Slider(
            value = downloadAhead,
            onValueChange = onDownloadAhead,
            valueRange = 1f..10f,
            steps = 8,
        )

        Button(onClick = onSyncNow) {
            Text("Sync now")
        }
    }
}
