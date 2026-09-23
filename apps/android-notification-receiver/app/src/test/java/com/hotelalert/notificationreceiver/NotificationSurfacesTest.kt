package com.hotelalert.notificationreceiver

import android.app.NotificationManager
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioManager
import com.hotelalert.notificationreceiver.notification.NotificationMapper
import com.hotelalert.notificationreceiver.notification.AudibleAlertBlockReason
import com.hotelalert.notificationreceiver.notification.AudibleAlertEligibility
import com.hotelalert.notificationreceiver.notification.AudibleAlertEligibilityState
import com.hotelalert.notificationreceiver.notification.AudibleAlertPlayerConfiguration
import com.hotelalert.notificationreceiver.notification.AlertAudioOutputDevice
import com.hotelalert.notificationreceiver.notification.createAlertMediaPlayer
import com.hotelalert.notificationreceiver.notification.requestBuiltInSpeakerPreference
import com.hotelalert.notificationreceiver.notification.verifyBuiltInSpeakerRoute
import com.hotelalert.notificationreceiver.notification.SpeakerRouteCheckResult
import com.hotelalert.notificationreceiver.notification.requestChannelImportance
import com.hotelalert.notificationreceiver.protocol.RequestNotification
import com.hotelalert.notificationreceiver.R
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationSurfacesTest {
    @Test
    fun audibleFallbackIsLimitedToBackgroundCreatedRequests() {
        val created = notification("request.created")
        val updated = notification("request.updated")

        assertTrue(NotificationMapper.shouldPlayAudibleFallback(created, appInForeground = false))
        assertFalse(NotificationMapper.shouldPlayAudibleFallback(created, appInForeground = true))
        assertFalse(NotificationMapper.shouldPlayAudibleFallback(updated, appInForeground = false))
    }

    @Test
    fun bubbleContentKeepsTheExistingRequestAction() {
        val content = NotificationMapper.map(notification("request.created"))

        assertTrue(content.action.name == "START_REQUEST")
        assertTrue(content.metadata["requestId"] == "request-1")
        assertEquals("Habitación 101 · Fresh towels", content.title)
        assertFalse(content.title.contains("New request"))
        assertEquals(
            "Habitación: 101\nServicio: Fresh towels\nÁrea: Housekeeping",
            content.expandedText
        )
        assertEquals("hotel-alert-request-request-1", NotificationMapper.bubbleShortcutId(content))
    }

    @Test
    fun audibleFallbackEligibilityHonorsRingerVolumeChannelAndDndSettings() {
        val eligible = AudibleAlertEligibilityState(
            audioManagerAvailable = true,
            ringerModeNormal = true,
            notificationVolume = 1,
            dndAllowsAlerts = true,
            channelRequired = true,
            channelExists = true,
            channelImportance = NotificationManager.IMPORTANCE_DEFAULT,
            channelHasSound = false
        )

        assertNull(AudibleAlertEligibility.blockReason(eligible))
        assertEquals(
            AudibleAlertBlockReason.AUDIO_SERVICE_UNAVAILABLE,
            AudibleAlertEligibility.blockReason(eligible.copy(audioManagerAvailable = false))
        )
        assertEquals(
            AudibleAlertBlockReason.RINGER_MODE_NOT_NORMAL,
            AudibleAlertEligibility.blockReason(eligible.copy(ringerModeNormal = false))
        )
        assertEquals(
            AudibleAlertBlockReason.NOTIFICATION_VOLUME_MUTED,
            AudibleAlertEligibility.blockReason(eligible.copy(notificationVolume = 0))
        )
        assertEquals(
            AudibleAlertBlockReason.DO_NOT_DISTURB_ACTIVE,
            AudibleAlertEligibility.blockReason(eligible.copy(dndAllowsAlerts = false))
        )
        assertEquals(
            AudibleAlertBlockReason.CHANNEL_MISSING,
            AudibleAlertEligibility.blockReason(eligible.copy(channelExists = false))
        )
        assertEquals(
            AudibleAlertBlockReason.CHANNEL_DISABLED,
            AudibleAlertEligibility.blockReason(eligible.copy(channelImportance = NotificationManager.IMPORTANCE_NONE))
        )
        assertEquals(
            AudibleAlertBlockReason.CHANNEL_IMPORTANCE_TOO_LOW,
            AudibleAlertEligibility.blockReason(eligible.copy(channelImportance = NotificationManager.IMPORTANCE_LOW))
        )
        assertEquals(
            AudibleAlertBlockReason.CHANNEL_NOT_SILENT,
            AudibleAlertEligibility.blockReason(eligible.copy(channelHasSound = true))
        )
    }

    @Test
    fun requestChannelIsVersionedSilentAndKeepsPriorImportanceWhenAvailable() {
        assertEquals("hotel-alert-requests-v4", NotificationMapper.REQUEST_CHANNEL_ID)
        assertEquals(NotificationManager.IMPORTANCE_HIGH, requestChannelImportance(null))
        assertEquals(NotificationManager.IMPORTANCE_NONE, requestChannelImportance(NotificationManager.IMPORTANCE_NONE))
        assertEquals(NotificationManager.IMPORTANCE_LOW, requestChannelImportance(NotificationManager.IMPORTANCE_LOW))

        val silentChannelEligibility = eligibleChannelState()
        assertNull(AudibleAlertEligibility.blockReason(silentChannelEligibility))
        assertEquals(
            AudibleAlertBlockReason.CHANNEL_NOT_SILENT,
            AudibleAlertEligibility.blockReason(silentChannelEligibility.copy(channelHasSound = true))
        )
    }

    @Test
    fun alertPlayerUsesPreconfiguredNotificationAudioAttributesAndGeneratedSession() {
        val configuration = AudibleAlertPlayerConfiguration.requestAlert()
        val loggedFailures = mutableListOf<String>()
        var receivedConfiguration: AudibleAlertPlayerConfiguration? = null

        val player = createAlertMediaPlayer(
            configuration = configuration,
            createPlayer = { receivedConfiguration = it; null },
            logFailure = loggedFailures::add
        )

        assertNull(player)
        assertEquals(configuration, receivedConfiguration)
        assertEquals(R.raw.hotel_alert_bell, configuration.resourceId)
        assertEquals(AudioAttributes.USAGE_NOTIFICATION, configuration.usage)
        assertEquals(AudioAttributes.CONTENT_TYPE_SONIFICATION, configuration.contentType)
        assertEquals(AudioManager.AUDIO_SESSION_ID_GENERATE, configuration.audioSessionId)
        assertEquals(listOf("player_create_returned_null"), loggedFailures)
    }

    @Test
    fun alertPlayerCreationReportsFactoryExceptionsWithoutLeakingTheirMessage() {
        val loggedFailures = mutableListOf<String>()

        val player = createAlertMediaPlayer(
            configuration = AudibleAlertPlayerConfiguration.requestAlert(),
            createPlayer = { throw IllegalStateException("sensitive platform detail") },
            logFailure = loggedFailures::add
        )

        assertNull(player)
        assertEquals(listOf("player_create_failed exception=IllegalStateException"), loggedFailures)
    }

    @Test
    fun speakerPreferenceSelectsTheBuiltInSpeakerWhenBluetoothIsAlsoAvailable() {
        val bluetooth = AlertAudioOutputDevice(id = 12, type = AudioDeviceInfo.TYPE_BLUETOOTH_A2DP)
        val speaker = AlertAudioOutputDevice(id = 2, type = AudioDeviceInfo.TYPE_BUILTIN_SPEAKER)
        var requestedDevice: AlertAudioOutputDevice? = null
        val logs = mutableListOf<String>()

        val accepted = requestBuiltInSpeakerPreference(
            apiLevel = 28,
            outputDevices = listOf(bluetooth, speaker),
            setPreferredDevice = { device -> requestedDevice = device; true },
            log = logs::add
        )

        assertTrue(accepted)
        assertEquals(speaker, requestedDevice)
        assertEquals(
            listOf("fallback=speaker_route_preference accepted=true device=built_in_speaker"),
            logs
        )
    }

    @Test
    fun speakerPreferenceFailsClosedWhenUnavailableOrRejected() {
        val bluetooth = AlertAudioOutputDevice(id = 12, type = AudioDeviceInfo.TYPE_BLUETOOTH_A2DP)
        val logs = mutableListOf<String>()
        var preferenceAttempts = 0

        assertFalse(
            requestBuiltInSpeakerPreference(
                apiLevel = 28,
                outputDevices = listOf(bluetooth),
                setPreferredDevice = { preferenceAttempts++; true },
                log = logs::add
            )
        )
        assertFalse(
            requestBuiltInSpeakerPreference(
                apiLevel = 27,
                outputDevices = listOf(bluetooth),
                setPreferredDevice = { preferenceAttempts++; true },
                log = logs::add
            )
        )
        val speaker = AlertAudioOutputDevice(id = 2, type = AudioDeviceInfo.TYPE_BUILTIN_SPEAKER)
        assertFalse(
            requestBuiltInSpeakerPreference(
                apiLevel = 28,
                outputDevices = listOf(speaker),
                setPreferredDevice = { preferenceAttempts++; false },
                log = logs::add
            )
        )

        assertEquals(1, preferenceAttempts)
        assertEquals(
            listOf(
                "fallback=speaker_route_preference accepted=false reason=built_in_speaker_unavailable",
                "fallback=speaker_route_preference accepted=false reason=api_unsupported",
                "fallback=speaker_route_preference accepted=false reason=preferred_device_rejected"
            ),
            logs
        )
    }

    @Test
    fun unknownRouteCanSettleToBuiltInSpeakerBeforeTimeout() {
        val logs = mutableListOf<String>()

        assertEquals(
            SpeakerRouteCheckResult.PENDING,
            verifyBuiltInSpeakerRoute(
                actualDevice = null,
                elapsedMs = 0,
                timeoutMs = 900,
                log = logs::add
            )
        )
        assertEquals(
            SpeakerRouteCheckResult.VERIFIED,
            verifyBuiltInSpeakerRoute(
                AlertAudioOutputDevice(id = 2, type = AudioDeviceInfo.TYPE_BUILTIN_SPEAKER),
                elapsedMs = 150,
                timeoutMs = 900,
                log = logs::add
            )
        )

        assertEquals(
            listOf(
                "fallback=route_verified actual_device=built_in_speaker"
            ),
            logs
        )
    }

    @Test
    fun routeMismatchAndPersistentUnknownFailClosed() {
        val logs = mutableListOf<String>()

        assertEquals(
            SpeakerRouteCheckResult.REJECTED,
            verifyBuiltInSpeakerRoute(
                AlertAudioOutputDevice(id = 12, type = AudioDeviceInfo.TYPE_BLUETOOTH_A2DP),
                elapsedMs = 100,
                timeoutMs = 900,
                log = logs::add
            )
        )
        assertEquals(
            SpeakerRouteCheckResult.PENDING,
            verifyBuiltInSpeakerRoute(null, elapsedMs = 899, timeoutMs = 900, log = logs::add)
        )
        assertEquals(
            SpeakerRouteCheckResult.TIMED_OUT,
            verifyBuiltInSpeakerRoute(null, elapsedMs = 900, timeoutMs = 900, log = logs::add)
        )
        assertEquals(
            listOf(
                "fallback=failed reason=route_not_built_in_speaker actual_device=bluetooth_a2dp",
                "fallback=failed reason=route_verification_timeout actual_device=unknown"
            ),
            logs
        )
    }

    @Test
    fun routeChangeAfterSpeakerVerificationIsRejectedImmediately() {
        val logs = mutableListOf<String>()
        val speaker = AlertAudioOutputDevice(id = 2, type = AudioDeviceInfo.TYPE_BUILTIN_SPEAKER)
        val bluetooth = AlertAudioOutputDevice(id = 12, type = AudioDeviceInfo.TYPE_BLUETOOTH_A2DP)

        assertEquals(
            SpeakerRouteCheckResult.VERIFIED,
            verifyBuiltInSpeakerRoute(
                speaker,
                elapsedMs = 100,
                timeoutMs = 900,
                log = logs::add
            )
        )
        assertEquals(
            SpeakerRouteCheckResult.REJECTED,
            verifyBuiltInSpeakerRoute(
                bluetooth,
                elapsedMs = 150,
                timeoutMs = 900,
                previouslyVerified = true,
                log = logs::add
            )
        )
        assertEquals(
            SpeakerRouteCheckResult.REJECTED,
            verifyBuiltInSpeakerRoute(
                actualDevice = null,
                elapsedMs = 151,
                timeoutMs = 900,
                previouslyVerified = true,
                log = logs::add
            )
        )
        assertEquals(
            listOf(
                "fallback=route_verified actual_device=built_in_speaker",
                "fallback=failed reason=route_changed_after_verification actual_device=bluetooth_a2dp",
                "fallback=failed reason=route_changed_after_verification actual_device=unknown"
            ),
            logs
        )
    }

    @Test
    fun speakerPreferenceDoesNotBypassExistingMuteOrDndEligibilityGates() {
        val eligible = AudibleAlertEligibilityState(
            audioManagerAvailable = true,
            ringerModeNormal = true,
            notificationVolume = 1,
            dndAllowsAlerts = true,
            channelRequired = true,
            channelExists = true,
            channelImportance = NotificationManager.IMPORTANCE_DEFAULT,
            channelHasSound = false
        )
        val speaker = AlertAudioOutputDevice(id = 2, type = AudioDeviceInfo.TYPE_BUILTIN_SPEAKER)
        assertTrue(
            requestBuiltInSpeakerPreference(
                apiLevel = 28,
                outputDevices = listOf(speaker),
                setPreferredDevice = { true },
                log = {}
            )
        )

        assertEquals(
            AudibleAlertBlockReason.NOTIFICATION_VOLUME_MUTED,
            AudibleAlertEligibility.blockReason(eligible.copy(notificationVolume = 0))
        )
        assertEquals(
            AudibleAlertBlockReason.DO_NOT_DISTURB_ACTIVE,
            AudibleAlertEligibility.blockReason(eligible.copy(dndAllowsAlerts = false))
        )
    }

    @Test
    fun bubbleShortcutUsesTheRequestIdentityRatherThanTheEventIdentity() {
        val content = NotificationMapper.map(notification("request.created"))

        assertEquals("hotel-alert-request-request-1", NotificationMapper.bubbleShortcutId(content))
    }

    private fun notification(eventName: String): RequestNotification = RequestNotification(
        eventName = eventName,
        eventId = "event-surfaces",
        eventSequence = 1,
        occurredAt = "2026-09-19T00:00:00Z",
        request = requestSnapshot("area-a")
    )

    private fun eligibleChannelState() = AudibleAlertEligibilityState(
        audioManagerAvailable = true,
        ringerModeNormal = true,
        notificationVolume = 1,
        dndAllowsAlerts = true,
        channelRequired = true,
        channelExists = true,
        channelImportance = NotificationManager.IMPORTANCE_DEFAULT,
        channelHasSound = false
    )
}
