package com.hotelalert.notificationreceiver.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.hotelalert.notificationreceiver.protocol.ReceiverConfiguration
import com.hotelalert.notificationreceiver.protocol.ReceiverState

@Composable
fun ReceiverScreen(
    state: ReceiverState,
    initialConfiguration: ReceiverConfiguration?,
    notificationPermissionGranted: Boolean,
    openedEventId: String?,
    onRequestNotificationPermission: () -> Unit,
    onSaveAndStart: (serverOrigin: String, deviceId: String, token: String) -> Unit,
    onStop: () -> Unit
) {
    var serverOrigin by rememberSaveable { mutableStateOf(initialConfiguration?.serverOrigin.orEmpty()) }
    var deviceId by rememberSaveable { mutableStateOf(initialConfiguration?.deviceId.orEmpty()) }
    var token by rememberSaveable { mutableStateOf("") }

    Surface(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text("Hotel Alert notification receiver", style = MaterialTheme.typography.headlineSmall)
            Text(
                "Diagnostic and setup surface only. This native app is not a hotel web kiosk replacement.",
                style = MaterialTheme.typography.bodyMedium
            )
            Text("Connection: ${state.name}", style = MaterialTheme.typography.titleMedium)
            if (openedEventId != null) {
                Text("Opened event metadata: $openedEventId", style = MaterialTheme.typography.bodySmall)
            }
            OutlinedTextField(
                value = serverOrigin,
                onValueChange = { serverOrigin = it },
                label = { Text("LAN/VPN server origin") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri)
            )
            OutlinedTextField(
                value = deviceId,
                onValueChange = { deviceId = it },
                label = { Text("Assigned device ID") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(
                value = token,
                onValueChange = { token = it },
                label = { Text("Device token") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password)
            )
            Text(
                "The token is written only to Android Keystore-backed encrypted storage. It is never displayed after saving.",
                style = MaterialTheme.typography.bodySmall
            )
            Button(
                onClick = {
                    onSaveAndStart(serverOrigin.trim(), deviceId.trim(), token)
                    token = ""
                },
                enabled = serverOrigin.isNotBlank() && deviceId.isNotBlank() && token.isNotBlank(),
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("Save credentials and start receiver")
            }
            if (!notificationPermissionGranted) {
                OutlinedButton(
                    onClick = onRequestNotificationPermission,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("Allow Android notifications")
                }
                Text(
                    "Delivery is disabled until notification permission is granted.",
                    style = MaterialTheme.typography.bodySmall
                )
            }
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                OutlinedButton(onClick = onStop) { Text("Stop receiver") }
            }
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                "Notifications are read-only. Opening one returns to diagnostics with opaque event metadata; no hotel request action is exposed.",
                style = MaterialTheme.typography.bodySmall
            )
        }
    }
}
