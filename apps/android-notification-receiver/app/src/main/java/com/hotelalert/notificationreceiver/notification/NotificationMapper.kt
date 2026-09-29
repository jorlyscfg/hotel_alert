package com.hotelalert.notificationreceiver.notification

import com.hotelalert.notificationreceiver.protocol.RequestNotification
import com.hotelalert.notificationreceiver.protocol.DoNotDisturbNotification

enum class NotificationAction {
    OPEN_DIAGNOSTICS,
    START_REQUEST
}

data class NotificationContent(
    val notificationId: Int,
    val channelId: String,
    val groupKey: String,
    val title: String,
    val text: String,
    val expandedText: String,
    val action: NotificationAction,
    val metadata: Map<String, String>
)

object NotificationMapper {
    /** A silent, versioned channel prevents Android from routing a second tone. */
    const val REQUEST_CHANNEL_ID = "hotel-alert-requests-v4"
    const val PREVIOUS_REQUEST_CHANNEL_ID = "hotel-alert-requests-v3"
    const val LEGACY_REQUEST_CHANNEL_ID = "hotel-alert-requests-v2"

    fun canStartRequest(notification: RequestNotification): Boolean =
        notification.request.status == "PENDING"

    /**
     * Only a newly-created request can alert the operator. The server accepts
     * request creation exclusively from ROOM devices; status updates are still
     * synchronized but are intentionally silent here.
     */
    fun shouldPostOperatorAlert(notification: RequestNotification, appInForeground: Boolean): Boolean =
        !appInForeground && notification.eventName == "request.created"

    fun shouldPostOperatorAlert(notification: DoNotDisturbNotification, appInForeground: Boolean): Boolean =
        !appInForeground

    /**
     * The audible fallback is deliberately limited to the same event boundary as
     * the operator alert. Status changes must never ring the tablet.
     */
    fun shouldPlayAudibleFallback(notification: RequestNotification, appInForeground: Boolean): Boolean =
        shouldPostOperatorAlert(notification, appInForeground)

    fun shouldPlayAudibleFallback(notification: DoNotDisturbNotification, appInForeground: Boolean): Boolean =
        shouldPostOperatorAlert(notification, appInForeground)

    /** A stable, per-request id required by Android 11+ bubble shortcuts. */
    fun bubbleShortcutId(content: NotificationContent): String =
        "hotel-alert-request-${content.metadata["requestId"] ?: content.notificationId}"

    fun bubbleShortcutIdForRequest(requestId: String): String =
        "hotel-alert-request-$requestId"

    fun map(notification: RequestNotification): NotificationContent {
        val request = notification.request
        val isCreated = notification.eventName == "request.created"
        val text = if (isCreated) {
            "Área: ${request.responsibleAreaDisplayName}"
        } else {
            "Actualización de solicitud · ${request.serviceDisplayName}"
        }
        val expandedText = if (isCreated) {
            "Habitación: ${request.roomCode}\nServicio: ${request.serviceDisplayName}\nÁrea: ${request.responsibleAreaDisplayName}"
        } else {
            text
        }
        return NotificationContent(
            notificationId = stableNotificationId(notification.eventId),
            channelId = REQUEST_CHANNEL_ID,
            groupKey = "hotel-alert-area:${request.responsibleAreaId}",
            title = if (isCreated) {
                "Habitación ${request.roomCode} · ${request.serviceDisplayName}"
            } else {
                "${request.roomDisplayName} · ${request.responsibleAreaDisplayName}"
            },
            text = text,
            expandedText = expandedText,
            action = if (canStartRequest(notification)) NotificationAction.START_REQUEST else NotificationAction.OPEN_DIAGNOSTICS,
            metadata = mapOf(
                "eventId" to notification.eventId,
                "requestId" to request.id,
                "areaId" to request.responsibleAreaId,
                "expectedVersion" to request.version.toString(),
                "idempotencyKey" to idempotencyKey(notification.eventId)
            )
        )
    }

    fun mapDoNotDisturb(
        notification: DoNotDisturbNotification,
        title: String,
        text: String
    ): NotificationContent = NotificationContent(
        notificationId = stableNotificationId(notification.eventId),
        channelId = REQUEST_CHANNEL_ID,
        groupKey = "hotel-alert-do-not-disturb",
        title = title,
        text = text,
        expandedText = text,
        action = NotificationAction.OPEN_DIAGNOSTICS,
        metadata = mapOf(
            "eventId" to notification.eventId,
            "roomId" to notification.roomId,
            "doNotDisturb" to notification.enabled.toString()
        )
    )

    fun failureNotificationId(sourceNotificationId: Int): Int = sourceNotificationId xor 0x40000000

    private fun idempotencyKey(eventId: String): String {
        val suffix = eventId.filter { it.isLetterOrDigit() || it == '.' || it == '_' || it == ':' || it == '-' }
            .take(100)
            .ifEmpty { "event-${stableNotificationId(eventId)}" }
        return "notification-$suffix"
    }

    private fun stableNotificationId(eventId: String): Int {
        var hash = 17
        eventId.forEach { character ->
            hash = 31 * hash + character.code
        }
        return if (hash == 0) 1 else hash
    }
}
