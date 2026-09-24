package com.hotelalert.notificationreceiver.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.DialogProperties
import com.hotelalert.notificationreceiver.RoomHomeStatus
import com.hotelalert.notificationreceiver.RoomLockTaskStatus

@Composable
internal fun RoomMaintenancePinDialog(
    errorMessage: String?,
    isChecking: Boolean,
    onSubmit: (String) -> Unit,
    onDismiss: () -> Unit
) {
    var pin by rememberSaveable { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(dismissOnBackPress = true, dismissOnClickOutside = false),
        title = { Text("Device maintenance") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Enter the 4-digit configuration PIN.")
                OutlinedTextField(
                    value = pin,
                    onValueChange = { pin = it.filter { digit -> digit in '0'..'9' }.take(4) },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    label = { Text("Configuration PIN") },
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                    isError = errorMessage != null
                )
                errorMessage?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            Button(onClick = { onSubmit(pin) }, enabled = pin.length == 4 && !isChecking) {
                Text(if (isChecking) "Checking…" else "Continue")
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } }
    )
}

@Composable
internal fun RoomMaintenanceSettingsScreen(
    pinChangeMessage: String?,
    homeStatus: RoomHomeStatus,
    isDeviceOwner: Boolean,
    strictModeOptedIn: Boolean,
    strictModeRequested: Boolean,
    strictModeAvailable: Boolean,
    strictModeStatus: RoomLockTaskStatus,
    strictModeAvailabilityMessage: String?,
    kioskControlMessage: String?,
    onChooseHome: () -> Unit,
    onClearManagedHome: () -> Unit,
    onOpenAndroidSettings: () -> Unit,
    onStrictModeChange: (Boolean) -> Unit,
    onChangePin: (String) -> Unit,
    onSaveAndReturn: () -> Unit
) {
    var newPin by rememberSaveable { mutableStateOf("") }
    var confirmation by rememberSaveable { mutableStateOf("") }
    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(
            modifier = Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Top
        ) {
            Column(
                modifier = Modifier.widthIn(max = 480.dp).fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                Text("Device maintenance", style = MaterialTheme.typography.headlineSmall)
                Text(
                    "This native screen is separate from the ROOM platform. Your room session stays active while you adjust the device.",
                    style = MaterialTheme.typography.bodyMedium
                )
                Text("Android device", style = MaterialTheme.typography.titleMedium)
                Text("Home app: ${homeStatusLabel(homeStatus)}", style = MaterialTheme.typography.bodyMedium)
                Button(onClick = onChooseHome, modifier = Modifier.fillMaxWidth()) {
                    Text("Choose Hotel Alert as Home")
                }
                if (isDeviceOwner) {
                    Text(
                        "This app is Device Owner. Hotel Alert can set a persistent Home preference.",
                        style = MaterialTheme.typography.bodySmall
                    )
                    TextButton(onClick = onClearManagedHome, modifier = Modifier.fillMaxWidth()) {
                        Text("Clear Hotel Alert's managed Home preference")
                    }
                }
                Button(onClick = onOpenAndroidSettings, modifier = Modifier.fillMaxWidth()) {
                    Text("Open Android Settings")
                }
                Text("Strict kiosk lock", style = MaterialTheme.typography.titleMedium)
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Enable strict Lock Task", fontWeight = FontWeight.Medium)
                        Text(
                            when (strictModeStatus) {
                                RoomLockTaskStatus.STRICT_LOCKED -> "Android confirms strict Lock Task is active."
                                RoomLockTaskStatus.SCREEN_PINNING -> "Screen pinning is active; it is not strict kiosk lock."
                                RoomLockTaskStatus.UNKNOWN -> "Android could not determine the current Lock Task state."
                                RoomLockTaskStatus.INACTIVE -> when {
                                    strictModeRequested && strictModeAvailable -> "Selected; Save & Return will apply strict Lock Task."
                                    strictModeOptedIn && strictModeAvailable -> "Saved and available; it will resume after Save & Return."
                                    else -> "Strict Lock Task is not currently active."
                                }
                            },
                            style = MaterialTheme.typography.bodySmall
                        )
                    }
                    Switch(
                        checked = strictModeRequested,
                        onCheckedChange = onStrictModeChange,
                        enabled = strictModeAvailable || strictModeRequested
                    )
                }
                strictModeAvailabilityMessage?.let {
                    Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                }
                kioskControlMessage?.let {
                    Text(it, color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.bodySmall)
                }
                Text("Change configuration PIN (optional)", style = MaterialTheme.typography.titleMedium)
                OutlinedTextField(
                    value = newPin,
                    onValueChange = { newPin = it.filter { digit -> digit in '0'..'9' }.take(4) },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    label = { Text("New 4-digit PIN") },
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword)
                )
                OutlinedTextField(
                    value = confirmation,
                    onValueChange = { confirmation = it.filter { digit -> digit in '0'..'9' }.take(4) },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    label = { Text("Confirm new PIN") },
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword)
                )
                pinChangeMessage?.let { Text(it, color = MaterialTheme.colorScheme.primary) }
                Button(
                    onClick = {
                        onChangePin(newPin)
                        newPin = ""
                        confirmation = ""
                    },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = newPin.length == 4 && newPin == confirmation
                ) {
                    Text("Save PIN")
                }
                Spacer(Modifier.height(4.dp))
                Button(onClick = onSaveAndReturn, modifier = Modifier.fillMaxWidth()) {
                    Text("Save & Return to ROOM")
                }
            }
        }
    }
}

@Composable
private fun homeStatusLabel(status: RoomHomeStatus): String = when (status) {
    RoomHomeStatus.HOTEL_ALERT_DEFAULT -> "Hotel Alert is the default launcher"
    RoomHomeStatus.ANOTHER_APP_DEFAULT -> "Another Home app is the current default"
    RoomHomeStatus.UNKNOWN -> "Android did not report a current default"
}
