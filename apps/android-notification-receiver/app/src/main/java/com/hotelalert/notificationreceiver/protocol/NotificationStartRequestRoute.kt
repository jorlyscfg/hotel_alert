package com.hotelalert.notificationreceiver.protocol

internal fun notificationStartRequestId(requestId: String?): String? =
    requestId?.trim()?.takeIf { it.isNotEmpty() }
