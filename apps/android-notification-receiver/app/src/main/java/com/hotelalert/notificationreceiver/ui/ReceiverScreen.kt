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
            Text("Receptor de notificaciones de Hotel Alert", style = MaterialTheme.typography.headlineSmall)
            Text(
                "Pantalla exclusiva para diagnóstico y configuración. Esta aplicación nativa no sustituye al kiosco web del hotel.",
                style = MaterialTheme.typography.bodyMedium
            )
            Text("Conexión: ${receiverStateLabel(state)}", style = MaterialTheme.typography.titleMedium)
            if (openedEventId != null) {
                Text("Metadatos del evento abierto: $openedEventId", style = MaterialTheme.typography.bodySmall)
            }
            OutlinedTextField(
                value = serverOrigin,
                onValueChange = { serverOrigin = it },
                label = { Text("Dirección del servidor (LAN/VPN)") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri)
            )
            OutlinedTextField(
                value = deviceId,
                onValueChange = { deviceId = it },
                label = { Text("ID del dispositivo asignado") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(
                value = token,
                onValueChange = { token = it },
                label = { Text("Token del dispositivo") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password)
            )
            Text(
                "El token solo se guarda en almacenamiento cifrado protegido por Android. No se muestra después de guardarlo.",
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
                Text("Guardar credenciales e iniciar el receptor")
            }
            if (!notificationPermissionGranted) {
                OutlinedButton(
                    onClick = onRequestNotificationPermission,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("Permitir notificaciones de Android")
                }
                Text(
                    "La entrega de notificaciones está desactivada hasta que se conceda el permiso.",
                    style = MaterialTheme.typography.bodySmall
                )
            }
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                OutlinedButton(onClick = onStop) { Text("Detener el receptor") }
            }
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                "Las notificaciones son de solo lectura. Al abrir una, se vuelve a diagnósticos con los metadatos del evento; no se muestran acciones para atender solicitudes del hotel.",
                style = MaterialTheme.typography.bodySmall
            )
        }
    }
}

internal fun receiverStateLabel(state: ReceiverState): String = when (state) {
    ReceiverState.IDLE -> "Inactivo"
    ReceiverState.FETCHING_SNAPSHOT -> "Consultando el estado del dispositivo"
    ReceiverState.CONNECTING -> "Conectando con el servidor"
    ReceiverState.CONNECTED -> "Conectado con el servidor"
    ReceiverState.SYNCHRONIZING -> "Sincronizando"
    ReceiverState.SYNCHRONIZED -> "Sincronizado"
    ReceiverState.AUTH_FAILED -> "Autenticación rechazada"
    ReceiverState.ERROR -> "Error"
    ReceiverState.STOPPED -> "Detenido"
}
