# Native Android ROOM mode

This guide covers the native Hotel Alert Android app as a ROOM station. It keeps the existing web login and room-assignment flow; Android does not register a second room device or select a room independently.

## Commission a ROOM device

1. Install and open Hotel Alert, then configure its server URL and port.
2. Sign in through the shared web flow, choose **Habitación**, and select the unassigned room.
3. After the native ROOM session is saved, Android may ask whether Hotel Alert should be the Home app. Approve the system prompt to have Android open Hotel Alert as the launcher.
4. If the prompt is unavailable or declined, open the device's **Default apps / Home app** setting and select Hotel Alert. The name and location vary by Android version and manufacturer. Android 8–9 devices (API 26–28) require this manual selection.
5. Reopen the app and confirm the room display appears without the system status/navigation bars. Swiping from an edge can temporarily reveal system bars; immersive display is not strict device lockdown.

Android 10+ (API 29+) uses the system HOME-role consent flow when available. A declined request is not repeated automatically; the operator can choose Hotel Alert later in Settings. AREA and Admin assignments do not request the HOME role and do not enter ROOM immersive mode.

## Reboot and app updates

- The app listens for `BOOT_COMPLETED` and `MY_PACKAGE_REPLACED`. It checks the protected native ROOM session before restarting only the ROOM presence service. It does not launch an Activity from either broadcast.
- Select Hotel Alert as the system Home app if the ROOM screen should return automatically after boot. Without that selection, the operator must open the app; the presence service may still restart in the background.
- Boot restoration runs after Android makes the app's normal private storage available (after the device's first unlock). This app is not Direct-Boot-aware.
- Android can suppress automatic restart after an operator force-stops the app. Some manufacturers add background-start or battery policies; configure and validate those per device.
- The ROOM service uses the declared `specialUse` foreground-service type and keeps a low-priority service notification. Android 15 target-35 restrictions prohibit boot-starting `dataSync` foreground services; the ROOM restore path does not start the separate AREA `dataSync` service. Foreground-service classification and OEM behavior still require release verification.

## Lockdown boundary

HOME selection and immersive fullscreen provide a convenient Basic mode, not a security boundary. They do not require Device Owner and remain the default for ROOM stations. Android screen pinning is user-exitable and must not be described as strict kiosk lockdown.

This release registers Hotel Alert as a possible same-app Device Policy Controller and includes a guarded ROOM Lock Task policy wrapper. It does not provision Device Owner, invoke that wrapper from the app flow, enable strict mode, or call `startLockTask()`. Strict mode stays unavailable until a later release adds and verifies a local maintenance exit. The device-admin metadata requests no legacy Device Admin policies; Lock Task policy is only available to the app when Android has provisioned it as Device Owner.

## Optional Device Owner commissioning

Device Owner is optional and is not needed for ordinary ROOM use. Only an authorized operator should provision it on a dedicated ROOM device. Device Owner is a powerful, device-wide management state; the app cannot grant itself that role after installation.

For a production fleet, use the organization's approved fully managed-device provisioning flow (for example, QR enrollment during Android setup or an EMM). Device support and eligibility depend on the Android/OEM setup state. Do not enable Device Owner on a production room device with this release: it has no local maintenance exit yet.

For an isolated development device running Android 9 (API 28) or later only, Android's DPM shell command can provision the receiver after installing the APK when the device/account state permits it. Android's development instructions require removing device accounts first; this command is not the production enrollment workflow:

```sh
adb shell dpm set-device-owner com.hotelalert.notificationreceiver/.admin.HotelAlertDeviceAdminReceiver
```

This command is documentation only; it was not run as part of this change. A successful Device Owner provisioning does not start Lock Task in this release. If invoked by a future commissioning flow, the policy wrapper will allowlist only the Hotel Alert package after confirming a persisted ROOM session and Device Owner authority; it does not start the app in Lock Task or change lock-task system UI features.

## Device Owner removal and recovery

This release has no in-app Device Owner relinquish flow. Do not treat uninstalling Hotel Alert as a removal procedure: Android protects the Device Owner package from ordinary deactivation/uninstall. The DPM `remove-active-admin` shell command is restricted to test-only admin apps, and this production manifest is not marked `android:testOnly`. For a production device, use the organization's approved EMM/provisioning recovery procedure; if it cannot relinquish ownership, factory-reset the device before reusing it. Do not use the deprecated `clearDeviceOwnerApp()` API as a production recovery mechanism.

Strict Lock Task must remain disabled until ARKP-02C supplies the local PIN-protected maintenance exit. In particular, do not add automatic Lock Task entry to HOME, boot, package-replacement, or ROOM session callbacks before that exit exists and has been tested.

Android platform references: [Lock Task mode](https://developer.android.com/work/dpc/dedicated-devices/lock-task-mode), [DeviceAdminReceiver](https://developer.android.com/reference/android/app/admin/DeviceAdminReceiver), [DPM shell commands](https://developer.android.com/tools/adb).

Test each supported manufacturer and Android release with boot, app replacement, screen-off presence, HOME selection, and manual recovery. No device-specific behavior is guaranteed by this guide.
