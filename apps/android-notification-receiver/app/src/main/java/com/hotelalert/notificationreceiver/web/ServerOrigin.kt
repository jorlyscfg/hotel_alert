package com.hotelalert.notificationreceiver.web

import java.net.URI
import java.util.Locale

interface ServerOriginStore {
    fun read(): String?

    fun write(serverOrigin: String)
}

class ValidatedServerOriginStore(
    private val delegate: ServerOriginStore
) : ServerOriginStore {
    override fun read(): String? = delegate.read()?.let { storedOrigin ->
        runCatching { normalizeAndValidateServerOrigin(storedOrigin) }.getOrNull()
    }

    override fun write(serverOrigin: String) {
        delegate.write(normalizeAndValidateServerOrigin(serverOrigin))
    }
}

class WebViewNavigationPolicy(serverOrigin: String) {
    private val trustedOrigin = normalizeAndValidateServerOrigin(serverOrigin)

    fun isAllowedNavigation(url: String?): Boolean {
        val parsed = url?.let {
            runCatching { parseHttpUri(it, requireRootPath = false, rejectQueryAndFragment = false) }.getOrNull()
        }
        return parsed?.origin == trustedOrigin
    }

    @Suppress("UNUSED_PARAMETER")
    fun isExternalIntentAllowed(url: String?): Boolean = false
}

object NativeWebViewBridgeContract {
    const val name = "HotelAlertNative"
    const val capabilitiesJson = "{\"bridgeVersion\":1,\"nativeReceiver\":true,\"pairing\":true,\"snapshot\":true,\"deviceCommands\":true}"
    const val readOnlyCapabilitiesJson = "{\"bridgeVersion\":1,\"nativeReceiver\":true,\"pairing\":true,\"snapshot\":true,\"deviceCommands\":false}"
    const val unavailableCapabilitiesJson = "{\"bridgeVersion\":1,\"nativeReceiver\":false,\"pairing\":false,\"snapshot\":false,\"deviceCommands\":false}"
}

fun normalizeAndValidateServerOrigin(rawOrigin: String): String {
    val parsed = parseHttpUri(rawOrigin, requireRootPath = true, rejectQueryAndFragment = true)
    return parsed.origin
}

private data class ParsedHttpUri(val origin: String)

private fun parseHttpUri(
    rawUrl: String,
    requireRootPath: Boolean,
    rejectQueryAndFragment: Boolean = requireRootPath
): ParsedHttpUri {
    val value = rawUrl.trim()
    require(value.isNotEmpty() && value.none { character -> Character.isISOControl(character) }) {
        "The server origin must be a valid HTTP or HTTPS origin."
    }

    val uri = runCatching { URI(value) }.getOrElse {
        throw IllegalArgumentException("The server origin must be a valid HTTP or HTTPS origin.", it)
    }
    val scheme = uri.scheme?.lowercase(Locale.ROOT)
    require(scheme == "http" || scheme == "https") {
        "The server origin must use HTTP or HTTPS."
    }
    require(uri.rawUserInfo == null) {
        "The server origin must not contain credentials."
    }
    if (rejectQueryAndFragment) {
        require(uri.rawQuery == null && uri.rawFragment == null) {
            "The server origin must not contain a query or a fragment."
        }
    }
    if (requireRootPath) {
        require(uri.rawPath.isEmpty() || uri.rawPath == "/") {
            "The server origin must not contain a path."
        }
    }

    val host = uri.host
    require(!host.isNullOrBlank()) {
        "The server origin must include a host."
    }
    val port = uri.port
    require(port == -1 || port in 1..65_535) {
        "The server origin port is invalid."
    }

    val normalizedHost = host.removePrefix("[").removeSuffix("]").lowercase(Locale.ROOT)
    val defaultPort = if (scheme == "http") 80 else 443
    val normalizedPort = port.takeIf { it != -1 && it != defaultPort }
    val authorityHost = if (normalizedHost.contains(':')) "[$normalizedHost]" else normalizedHost
    val origin = buildString {
        append(scheme)
        append("://")
        append(authorityHost)
        if (normalizedPort != null) {
            append(':')
            append(normalizedPort)
        }
    }
    return ParsedHttpUri(origin)
}
