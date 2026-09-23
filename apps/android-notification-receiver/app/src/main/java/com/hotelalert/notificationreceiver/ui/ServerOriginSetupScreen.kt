package com.hotelalert.notificationreceiver.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.hotelalert.notificationreceiver.web.normalizeAndValidateServerOrigin

@Composable
fun ServerOriginSetupScreen(
    initialServerOrigin: String? = null,
    onSave: (String) -> Boolean
) {
    var serverOrigin by rememberSaveable(initialServerOrigin) { mutableStateOf(initialServerOrigin.orEmpty()) }
    var errorMessage by rememberSaveable { mutableStateOf<String?>(null) }

    BrandedConnectionSurface {
        ConnectionCard(
            eyebrow = "Secure connection",
            title = "Connect Hotel Alert",
            description = "Enter the LAN or VPN server origin. The console will be restricted to this address.",
            status = "Initial setup"
        ) {
            OutlinedTextField(
                value = serverOrigin,
                onValueChange = {
                    serverOrigin = it
                    errorMessage = null
                },
                label = { Text("Server origin") },
                placeholder = { Text("http://192.168.1.20:3000") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                isError = errorMessage != null,
                supportingText = { errorMessage?.let { Text(it) } }
            )
            Button(
                onClick = {
                    val normalizedOrigin = try {
                        normalizeAndValidateServerOrigin(serverOrigin)
                    } catch (_: IllegalArgumentException) {
                        errorMessage = "Enter a valid HTTP or HTTPS origin without a path, query, or credentials."
                        return@Button
                    }
                    if (onSave(normalizedOrigin)) {
                        errorMessage = null
                    } else {
                        errorMessage = "The server origin could not be saved. Try again."
                    }
                },
                enabled = serverOrigin.isNotBlank(),
                modifier = Modifier.fillMaxWidth(),
                shape = MaterialTheme.shapes.small,
                colors = ButtonDefaults.buttonColors(
                    containerColor = HotelAlertBrand.Ink,
                    contentColor = HotelAlertBrand.Paper
                )
            ) {
                Text("Save and open console", fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
fun ServerOriginRecoveryScreen(
    serverOrigin: String,
    onRetry: () -> Unit,
    onChangeServer: () -> Unit
) {
    BrandedConnectionSurface {
        ConnectionCard(
            eyebrow = "Connection interrupted",
            title = "The console could not open",
            description = "The server did not respond at the configured origin. Check the network and try again.",
            status = serverOrigin
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
            Button(
                onClick = onRetry,
                    modifier = Modifier.weight(1f),
                    shape = MaterialTheme.shapes.small,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = HotelAlertBrand.Ink,
                        contentColor = HotelAlertBrand.Paper
                    )
            ) {
                    Text("Retry", fontWeight = FontWeight.Bold)
            }
            OutlinedButton(
                onClick = onChangeServer,
                    modifier = Modifier.weight(1f),
                    shape = MaterialTheme.shapes.small
            ) {
                    Text("Change server", fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

@Composable
private fun BrandedConnectionSurface(content: @Composable () -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(HotelAlertBrand.Background)
            .padding(20.dp),
        contentAlignment = Alignment.Center
    ) {
        content()
    }
}

@Composable
private fun ConnectionCard(
    eyebrow: String,
    title: String,
    description: String,
    status: String,
    content: @Composable () -> Unit
) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .widthIn(max = 520.dp)
            .verticalScroll(rememberScrollState()),
        color = HotelAlertBrand.Paper,
        shape = RoundedCornerShape(18.dp),
        tonalElevation = 2.dp,
        shadowElevation = 8.dp
    ) {
        Column(
            modifier = Modifier.padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                HotelAlertBrandMark(modifier = Modifier.padding(2.dp).size(56.dp))
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(eyebrow.uppercase(), style = MaterialTheme.typography.labelMedium, color = HotelAlertBrand.Coral)
                    Text(title, style = MaterialTheme.typography.headlineSmall)
                }
            }
            Text(description, style = MaterialTheme.typography.bodyMedium, color = HotelAlertBrand.InkSoft)
            Surface(
                color = HotelAlertBrand.PaperDeep,
                shape = MaterialTheme.shapes.small,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(status, modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp), style = MaterialTheme.typography.labelMedium, color = HotelAlertBrand.InkSoft)
            }
            content()
        }
    }
}
