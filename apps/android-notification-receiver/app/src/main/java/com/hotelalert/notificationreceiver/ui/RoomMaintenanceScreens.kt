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
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Slider
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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.DialogProperties
import kotlin.math.roundToInt
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
        title = { Text("Mantenimiento del dispositivo") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Introduce el PIN de configuración de 4 dígitos.")
                OutlinedTextField(
                    value = pin,
                    onValueChange = { pin = it.filter { digit -> digit in '0'..'9' }.take(4) },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    label = { Text("PIN de configuración") },
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                    isError = errorMessage != null
                )
                errorMessage?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            Button(onClick = { onSubmit(pin) }, enabled = pin.length == 4 && !isChecking) {
                Text(if (isChecking) "Verificando…" else "Continuar")
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancelar") } }
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
    overlayPermissionRequired: Boolean,
    overlayPermissionGranted: Boolean,
    roomBrightnessManual: Boolean,
    roomBrightnessPercent: Int,
    onChooseHome: () -> Unit,
    onOpenHomeSelectionSettings: () -> Unit,
    onClearManagedHome: () -> Unit,
    onOpenAndroidSettings: () -> Unit,
    onOpenWirelessDebuggingSettings: () -> Unit,
    onManageOverlayPermission: () -> Unit,
    onStrictModeChange: (Boolean) -> Unit,
    onRoomBrightnessManualChange: (Boolean) -> Unit,
    onRoomBrightnessPercentChange: (Int) -> Unit,
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
                Text("Mantenimiento del dispositivo", style = MaterialTheme.typography.headlineSmall)
                Text(
                    "Esta pantalla nativa es independiente de la plataforma web. La sesión de la habitación permanece activa mientras se realizan ajustes en el dispositivo.",
                    style = MaterialTheme.typography.bodyMedium
                )
                Text("Brillo de la pantalla", style = MaterialTheme.typography.titleMedium)
                Text(
                    "El nivel manual solo afecta la ventana de Hotel Alert; no cambia el brillo general de Android.",
                    style = MaterialTheme.typography.bodySmall
                )
                Row(
                    modifier = Modifier.fillMaxWidth().selectable(
                        selected = !roomBrightnessManual,
                        role = Role.RadioButton,
                        onClick = { onRoomBrightnessManualChange(false) }
                    ),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    RadioButton(selected = !roomBrightnessManual, onClick = null)
                    Text("Automático de Android", style = MaterialTheme.typography.bodyMedium)
                }
                Row(
                    modifier = Modifier.fillMaxWidth().selectable(
                        selected = roomBrightnessManual,
                        role = Role.RadioButton,
                        onClick = { onRoomBrightnessManualChange(true) }
                    ),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    RadioButton(selected = roomBrightnessManual, onClick = null)
                    Text("Nivel manual", style = MaterialTheme.typography.bodyMedium)
                }
                if (roomBrightnessManual) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Slider(
                            value = roomBrightnessPercent.toFloat(),
                            onValueChange = { onRoomBrightnessPercentChange(it.roundToInt()) },
                            valueRange = 1f..100f,
                            steps = 98,
                            modifier = Modifier.weight(1f)
                        )
                        Text("$roomBrightnessPercent%", style = MaterialTheme.typography.bodyMedium)
                    }
                    Text(
                        "El control permite elegir del 1 % al 100 % y previsualiza el cambio mientras esta pantalla está abierta.",
                        style = MaterialTheme.typography.bodySmall
                    )
                }
                Text("Dispositivo Android", style = MaterialTheme.typography.titleMedium)
                Text("Aplicación de inicio: ${homeStatusLabel(homeStatus)}", style = MaterialTheme.typography.bodyMedium)
                Button(onClick = onChooseHome, modifier = Modifier.fillMaxWidth()) {
                    Text("Elegir o volver a elegir Hotel Alert como aplicación de inicio")
                }
                Text(
                    "Si Android todavía abre Akubela, puedes cambiar la aplicación de inicio desde los ajustes del sistema.",
                    style = MaterialTheme.typography.bodySmall
                )
                Button(onClick = onOpenHomeSelectionSettings, modifier = Modifier.fillMaxWidth()) {
                    Text("Cambiar aplicación de inicio en Android")
                }
                if (isDeviceOwner) {
                    Text(
                        "Esta aplicación es propietaria del dispositivo. Hotel Alert puede establecer una preferencia de inicio permanente.",
                        style = MaterialTheme.typography.bodySmall
                    )
                    TextButton(onClick = onClearManagedHome, modifier = Modifier.fillMaxWidth()) {
                        Text("Quitar la preferencia de inicio administrada por Hotel Alert")
                    }
                }
                Button(onClick = onOpenAndroidSettings, modifier = Modifier.fillMaxWidth()) {
                    Text("Abrir la configuración de Android")
                }
                Text("Depuración inalámbrica", style = MaterialTheme.typography.titleMedium)
                Text(
                    "Abre las opciones de desarrollador y activa Depuración inalámbrica manualmente. Después de reiniciar, Android puede mostrar un puerto distinto; utiliza el puerto que aparezca allí. Hotel Alert no puede activar esta opción automáticamente.",
                    style = MaterialTheme.typography.bodySmall
                )
                Button(onClick = onOpenWirelessDebuggingSettings, modifier = Modifier.fillMaxWidth()) {
                    Text("Configurar depuración inalámbrica")
                }
                Text("Volver a la habitación al activar la pantalla", style = MaterialTheme.typography.titleMedium)
                Text(
                    if (overlayPermissionRequired) {
                        if (overlayPermissionGranted) {
                            "El permiso para mostrarse sobre otras aplicaciones está concedido. Hotel Alert lo usa solo para intentar volver a la habitación después de activar la pantalla; no muestra ventanas flotantes. Android o el fabricante aún pueden bloquear el inicio en segundo plano."
                        } else {
                            "Android 10 y versiones posteriores pueden impedir que una aplicación se abra en segundo plano. Con este permiso, Hotel Alert puede intentar volver a la habitación al activar la pantalla. No se muestran ventanas flotantes y Android o el fabricante aún pueden bloquear el inicio."
                        }
                    } else {
                        "Hotel Alert intenta volver a la habitación al activar la pantalla en esta versión de Android. El fabricante aún puede limitar el inicio en segundo plano."
                    },
                    style = MaterialTheme.typography.bodySmall
                )
                if (overlayPermissionRequired) {
                    Text(
                        if (overlayPermissionGranted) {
                            "Permiso para mostrarse sobre otras aplicaciones: concedido"
                        } else {
                            "Permiso para mostrarse sobre otras aplicaciones: no concedido"
                        },
                        style = MaterialTheme.typography.bodyMedium
                    )
                    Button(onClick = onManageOverlayPermission, modifier = Modifier.fillMaxWidth()) {
                        Text("Gestionar permiso de superposición")
                    }
                } else {
                    Text("Esta versión de Android no requiere el permiso de superposición.", style = MaterialTheme.typography.bodySmall)
                }
                Text("Bloqueo estricto del dispositivo", style = MaterialTheme.typography.titleMedium)
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Activar el modo kiosco estricto", fontWeight = FontWeight.Medium)
                        Text(
                            when (strictModeStatus) {
                                RoomLockTaskStatus.STRICT_LOCKED -> "Android confirma que el modo kiosco estricto está activo."
                                RoomLockTaskStatus.SCREEN_PINNING -> "El anclaje de pantalla está activo; no equivale al modo kiosco estricto."
                                RoomLockTaskStatus.UNKNOWN -> "Android no pudo determinar el estado actual del modo kiosco estricto."
                                RoomLockTaskStatus.INACTIVE -> when {
                                    strictModeRequested && strictModeAvailable -> "Seleccionado. Al guardar y volver, se aplicará el modo kiosco estricto."
                                    strictModeOptedIn && strictModeAvailable -> "Guardado y disponible; se reactivará al guardar y volver."
                                    else -> "El modo kiosco estricto no está activo."
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
                Text("Cambiar PIN de configuración (opcional)", style = MaterialTheme.typography.titleMedium)
                OutlinedTextField(
                    value = newPin,
                    onValueChange = { newPin = it.filter { digit -> digit in '0'..'9' }.take(4) },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    label = { Text("Nuevo PIN de 4 dígitos") },
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword)
                )
                OutlinedTextField(
                    value = confirmation,
                    onValueChange = { confirmation = it.filter { digit -> digit in '0'..'9' }.take(4) },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    label = { Text("Confirmar PIN nuevo") },
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
                    Text("Guardar PIN")
                }
                Spacer(Modifier.height(4.dp))
                Button(onClick = onSaveAndReturn, modifier = Modifier.fillMaxWidth()) {
                    Text("Guardar y volver a la habitación")
                }
            }
        }
    }
}

@Composable
private fun homeStatusLabel(status: RoomHomeStatus): String = when (status) {
    RoomHomeStatus.HOTEL_ALERT_DEFAULT -> "Hotel Alert es la aplicación de inicio predeterminada"
    RoomHomeStatus.ANOTHER_APP_DEFAULT -> "Otra aplicación de inicio es la predeterminada"
    RoomHomeStatus.UNKNOWN -> "Android no informó cuál es la aplicación de inicio predeterminada"
}
