package com.hotelalert.notificationreceiver.admin

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RoomLockTaskControllerTest {
    @Test
    fun `controller leaves Basic mode when no ROOM session or Device Owner is present`() {
        val noSessionPolicy = FakeRoomLockTaskDevicePolicy(isDeviceOwner = true)
        val noSessionController = controller(noSessionPolicy)
        assertEquals(
            RoomLockTaskPreparation.ROOM_SESSION_REQUIRED,
            noSessionController.prepareForRoomSession(hasRoomSession = false)
        )
        assertTrue(noSessionPolicy.allowedPackages.isEmpty())

        val unmanagedPolicy = FakeRoomLockTaskDevicePolicy(isDeviceOwner = false)
        assertEquals(
            RoomLockTaskPreparation.DEVICE_OWNER_REQUIRED,
            controller(unmanagedPolicy).prepareForRoomSession(hasRoomSession = true)
        )
        assertTrue(unmanagedPolicy.allowedPackages.isEmpty())
    }

    @Test
    fun `controller allowlists only this app and verifies Android accepted the policy`() {
        val policy = FakeRoomLockTaskDevicePolicy(isDeviceOwner = true)
        val controller = controller(policy)

        assertEquals(
            RoomLockTaskPreparation.POLICY_READY,
            controller.prepareForRoomSession(hasRoomSession = true)
        )
        assertEquals(setOf(APP_PACKAGE), policy.allowedPackages)
        assertTrue(controller.isStrictModeReady(true, true, true))
    }

    @Test
    fun `controller fails closed when allowlisting is unavailable or rejected`() {
        val notAllowed = FakeRoomLockTaskDevicePolicy(isDeviceOwner = true, acceptsPolicy = false)
        val notAllowedController = controller(notAllowed)
        assertEquals(
            RoomLockTaskPreparation.PACKAGE_NOT_ALLOWLISTED,
            notAllowedController.prepareForRoomSession(hasRoomSession = true)
        )
        assertFalse(notAllowedController.isStrictModeReady(true, true, true))

        val rejected = FakeRoomLockTaskDevicePolicy(isDeviceOwner = true, rejectPolicy = true)
        assertEquals(
            RoomLockTaskPreparation.POLICY_REJECTED,
            controller(rejected).prepareForRoomSession(hasRoomSession = true)
        )
    }

    @Test
    fun `strict readiness is false until maintenance exit is available`() {
        val policy = FakeRoomLockTaskDevicePolicy(isDeviceOwner = true)
        val controller = controller(policy)
        assertFalse(controller.isStrictModeReady(true, true, false))
        assertFalse(controller.isStrictModeReady(true, false, true))
        assertEquals(0, policy.ownerChecks)
    }

    @Test
    fun `unsupported Android versions do not query or change device policy`() {
        val policy = FakeRoomLockTaskDevicePolicy(isDeviceOwner = true)
        assertEquals(
            RoomLockTaskPreparation.ANDROID_VERSION_UNSUPPORTED,
            RoomLockTaskController(APP_PACKAGE, 25, policy).prepareForRoomSession(hasRoomSession = true)
        )
        assertTrue(policy.allowedPackages.isEmpty())
        assertEquals(0, policy.ownerChecks)
    }

    private fun controller(policy: FakeRoomLockTaskDevicePolicy) =
        RoomLockTaskController(APP_PACKAGE, MIN_ROOM_LOCK_TASK_API_LEVEL, policy)

    private class FakeRoomLockTaskDevicePolicy(
        private val isDeviceOwner: Boolean,
        private val acceptsPolicy: Boolean = true,
        private val rejectPolicy: Boolean = false
    ) : RoomLockTaskDevicePolicy {
        var allowedPackages: Set<String> = emptySet()
            private set
        var ownerChecks = 0
            private set

        override fun isDeviceOwner(packageName: String): Boolean {
            ownerChecks += 1
            return isDeviceOwner
        }

        override fun setLockTaskPackages(packages: Set<String>) {
            if (rejectPolicy) throw SecurityException("Device Owner is not authorized.")
            allowedPackages = packages
        }

        override fun isLockTaskPermitted(packageName: String): Boolean = acceptsPolicy && packageName in allowedPackages
    }

    private companion object {
        const val APP_PACKAGE = "com.hotelalert.notificationreceiver"
    }
}
