package com.hotelalert.notificationreceiver

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RoomHomeLauncherPolicyTest {
    @Test
    fun `HOME selection uses owner policy role consent or Settings by platform capability`() {
        assertEquals(
            HomeSelectionAction.SET_PERSISTENT_PREFERRED_HOME,
            chooseHomeSelectionAction(apiLevel = 35, roleAvailable = true, isDeviceOwner = true)
        )
        assertEquals(
            HomeSelectionAction.REQUEST_HOME_ROLE,
            chooseHomeSelectionAction(apiLevel = 29, roleAvailable = true, isDeviceOwner = false)
        )
        assertEquals(
            HomeSelectionAction.OPEN_HOME_SETTINGS,
            chooseHomeSelectionAction(apiLevel = 28, roleAvailable = false, isDeviceOwner = false)
        )
        assertEquals(
            HomeSelectionAction.OPEN_HOME_SETTINGS,
            chooseHomeSelectionAction(apiLevel = 35, roleAvailable = false, isDeviceOwner = false)
        )
    }

    @Test
    fun `concrete resolved HOME package takes precedence and RoleManager is the fallback`() {
        assertEquals(
            RoomHomeStatus.ANOTHER_APP_DEFAULT,
            resolveRoomHomeStatus(35, true, true, "other.launcher", "hotel.alert")
        )
        assertEquals(
            RoomHomeStatus.HOTEL_ALERT_DEFAULT,
            resolveRoomHomeStatus(35, true, false, "hotel.alert", "hotel.alert")
        )
        assertEquals(
            RoomHomeStatus.HOTEL_ALERT_DEFAULT,
            resolveRoomHomeStatus(28, false, false, "hotel.alert", "hotel.alert")
        )
        assertEquals(
            RoomHomeStatus.ANOTHER_APP_DEFAULT,
            resolveRoomHomeStatus(28, false, false, "other.launcher", "hotel.alert")
        )
        assertEquals(
            RoomHomeStatus.HOTEL_ALERT_DEFAULT,
            resolveRoomHomeStatus(35, true, true, null, "hotel.alert")
        )
        assertEquals(
            RoomHomeStatus.ANOTHER_APP_DEFAULT,
            resolveRoomHomeStatus(35, true, false, null, "hotel.alert")
        )
        assertEquals(
            RoomHomeStatus.UNKNOWN,
            resolveRoomHomeStatus(28, false, false, null, "hotel.alert")
        )
    }

    @Test
    fun `chooser feedback follows the refreshed Android HOME state instead of the activity result code`() {
        assertEquals(
            HomeSelectionFeedback.CONFIRMED,
            homeSelectionFeedback(RoomHomeStatus.HOTEL_ALERT_DEFAULT)
        )
        assertEquals(
            HomeSelectionFeedback.NOT_CONFIRMED,
            homeSelectionFeedback(RoomHomeStatus.ANOTHER_APP_DEFAULT)
        )
        assertEquals(
            HomeSelectionFeedback.UNKNOWN,
            homeSelectionFeedback(RoomHomeStatus.UNKNOWN)
        )
        assertTrue(homeSelectionFeedbackMessage(HomeSelectionFeedback.CONFIRMED).contains("Selección confirmada"))
        assertTrue(homeSelectionFeedbackMessage(HomeSelectionFeedback.NOT_CONFIRMED).contains("no confirmada"))
    }

    @Test
    fun `persistent Home writes and clears are reserved for the Device Owner`() {
        assertTrue(shouldSetPersistentPreferredHome(isDeviceOwner = true))
        assertTrue(shouldClearPersistentPreferredHome(isDeviceOwner = true))
        assertFalse(shouldSetPersistentPreferredHome(isDeviceOwner = false))
        assertFalse(shouldClearPersistentPreferredHome(isDeviceOwner = false))
    }

    @Test
    fun `strict lock resumes only for opted in ROOM sessions outside maintenance when Android allows it`() {
        assertTrue(shouldRestoreStrictRoomLockTask(true, true, false, true))
        assertFalse(shouldRestoreStrictRoomLockTask(false, true, false, true))
        assertFalse(shouldRestoreStrictRoomLockTask(true, false, false, true))
        assertFalse(shouldRestoreStrictRoomLockTask(true, true, true, true))
        assertFalse(shouldRestoreStrictRoomLockTask(true, true, false, false))
    }

    @Test
    fun `PIN-authorized maintenance settings restore only for an active ROOM session outside diagnostics`() {
        assertTrue(
            shouldRestorePinAuthorizedMaintenanceSettings(
                settingsWereOpenWhenActivityWasSaved = true,
                hasRoomSession = true,
                diagnosticsMode = false
            )
        )
        assertFalse(
            shouldRestorePinAuthorizedMaintenanceSettings(
                settingsWereOpenWhenActivityWasSaved = false,
                hasRoomSession = true,
                diagnosticsMode = false
            )
        )
        assertFalse(
            shouldRestorePinAuthorizedMaintenanceSettings(
                settingsWereOpenWhenActivityWasSaved = true,
                hasRoomSession = false,
                diagnosticsMode = false
            )
        )
        assertFalse(
            shouldRestorePinAuthorizedMaintenanceSettings(
                settingsWereOpenWhenActivityWasSaved = true,
                hasRoomSession = true,
                diagnosticsMode = true
            )
        )
    }

    @Test
    fun `only the verified settings route persists the maintenance marker`() {
        assertTrue(
            shouldPersistPinAuthorizedMaintenanceSettingsMarker(
                settingsAreOpen = true,
                restoreIsPending = false,
                hasRoomSession = true,
                diagnosticsMode = false
            )
        )
        assertTrue(
            shouldPersistPinAuthorizedMaintenanceSettingsMarker(
                settingsAreOpen = false,
                restoreIsPending = true,
                hasRoomSession = false,
                diagnosticsMode = false
            )
        )
        assertFalse(
            shouldPersistPinAuthorizedMaintenanceSettingsMarker(
                settingsAreOpen = false,
                restoreIsPending = false,
                hasRoomSession = true,
                diagnosticsMode = false
            )
        )
        assertFalse(
            shouldPersistPinAuthorizedMaintenanceSettingsMarker(
                settingsAreOpen = true,
                restoreIsPending = false,
                hasRoomSession = true,
                diagnosticsMode = true
            )
        )
    }

    @Test
    fun `screen pinning is reported separately from strict Lock Task`() {
        assertEquals(RoomLockTaskStatus.STRICT_LOCKED, roomLockTaskStatus(isLockedMode = true, isPinnedMode = false))
        assertEquals(RoomLockTaskStatus.SCREEN_PINNING, roomLockTaskStatus(isLockedMode = false, isPinnedMode = true))
        assertEquals(RoomLockTaskStatus.INACTIVE, roomLockTaskStatus(isLockedMode = false, isPinnedMode = false))
    }

    @Test
    fun `maintenance exits strict Lock Task only through its owner or Device Owner policy`() {
        assertEquals(
            RoomLockTaskMaintenanceExitAction.ALREADY_INACTIVE,
            roomLockTaskMaintenanceExitAction(RoomLockTaskStatus.INACTIVE, startedByThisActivity = false, isDeviceOwner = false)
        )
        assertEquals(
            RoomLockTaskMaintenanceExitAction.STOP_ACTIVITY_OWNED_LOCK_TASK,
            roomLockTaskMaintenanceExitAction(RoomLockTaskStatus.STRICT_LOCKED, startedByThisActivity = true, isDeviceOwner = false)
        )
        assertEquals(
            RoomLockTaskMaintenanceExitAction.REMOVE_DEVICE_OWNER_ALLOWLIST,
            roomLockTaskMaintenanceExitAction(RoomLockTaskStatus.STRICT_LOCKED, startedByThisActivity = false, isDeviceOwner = true)
        )
        assertEquals(
            RoomLockTaskMaintenanceExitAction.BLOCK_UNOWNED_STRICT_LOCK_TASK,
            roomLockTaskMaintenanceExitAction(RoomLockTaskStatus.STRICT_LOCKED, startedByThisActivity = false, isDeviceOwner = false)
        )
    }

    @Test
    fun `maintenance does not mistake pinning or unreadable state for a safe external launch`() {
        assertEquals(
            RoomLockTaskMaintenanceExitAction.BLOCK_SCREEN_PINNING,
            roomLockTaskMaintenanceExitAction(RoomLockTaskStatus.SCREEN_PINNING, startedByThisActivity = false, isDeviceOwner = true)
        )
        assertEquals(
            RoomLockTaskMaintenanceExitAction.BLOCK_UNKNOWN_STATUS,
            roomLockTaskMaintenanceExitAction(RoomLockTaskStatus.UNKNOWN, startedByThisActivity = true, isDeviceOwner = true)
        )
        assertTrue(mayLaunchExternalActivityAfterRoomLockTaskExit(RoomLockTaskStatus.INACTIVE))
        assertFalse(mayLaunchExternalActivityAfterRoomLockTaskExit(RoomLockTaskStatus.STRICT_LOCKED))
        assertFalse(mayLaunchExternalActivityAfterRoomLockTaskExit(RoomLockTaskStatus.SCREEN_PINNING))
        assertFalse(mayLaunchExternalActivityAfterRoomLockTaskExit(RoomLockTaskStatus.UNKNOWN))
    }
}
