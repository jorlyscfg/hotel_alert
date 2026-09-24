# Native Android ROOM mode

This guide covers the native Hotel Alert Android app as a ROOM station. It keeps the existing web login and room-assignment flow; Android does not register a second room device or select a room independently.

## Commission a ROOM device

1. Install and open Hotel Alert, then configure its server URL and port.
2. Sign in through the shared web flow, choose **Habitación**, and select the unassigned room.
3. After the native ROOM session is saved, Android may ask whether Hotel Alert should be the Home app. Approve the system prompt to have Android open Hotel Alert as the launcher.
4. If the prompt is unavailable or declined, open native maintenance and use **Choose Home app**. Android 10+ (API 29+) asks for the HOME role through Android's consent UI; older versions open **Home app** settings. If a device has no dedicated HOME settings page, the app opens general Android Settings and shows a message. The name and location vary by Android version and manufacturer.
5. Reopen the app and confirm the room display appears without the system status/navigation bars. Swiping from an edge can temporarily reveal system bars; immersive display is not strict device lockdown.

Android 10+ (API 29+) uses the system HOME-role consent flow when available. A declined request is not repeated automatically; the operator can choose Hotel Alert later from native maintenance. The screen reports the current HOME/default state. If Hotel Alert is provisioned as Device Owner, maintenance also offers an explicit action to set or clear this app's persistent HOME preference; without Device Owner, the app only asks Android for user consent and never writes protected system settings. AREA and Admin assignments do not request the HOME role and do not enter ROOM immersive mode.

## Native maintenance access

- While an active ROOM view is open, tap quickly four times anywhere on the screen to open the native maintenance PIN prompt. The taps still work normally in the web platform.
- The default Android configuration PIN is `0623`. It may remain unchanged; changing it is optional from the native maintenance screen. PIN entry and storage stay on Android and are not sent to the web application.
- Five failed attempts pause PIN entry for 60 seconds. Use Back or **Return to ROOM** to close maintenance; the existing ROOM session and presence continue.
- Native maintenance contains the Android Settings shortcut, Home-app selection, and optional strict Lock Task controls. The PIN gate authorizes access to these local controls but does not grant Android Device Owner authority.
- Use **Open Android Settings** for device-specific adjustments. Before opening an external screen, the app checks Android's actual lock state. It stops Lock Task when this Activity started it; after Activity recreation, Device Owner may remove Hotel Alert from the allowlist and the app proceeds only after Android confirms the task is inactive. If screen pinning is active or the state cannot be safely cleared/confirmed, it does not open another app. Maintenance remains open if Android recreates the Activity during this round-trip: Android saved-instance state contains only a non-secret “maintenance settings open” marker, never the PIN, and the app restores it only after validating an active ROOM session and confirming it is not in diagnostics mode. A PIN prompt alone is never restored. The normal maintenance refresh may restore the allowlist, but immersive mode and strict Lock Task are not re-entered until **Save & Return** (or Back) is selected.
- **Strict Lock Task** is an optional, locally persisted opt-in. It is unavailable unless Hotel Alert is Device Owner and its package is allowlisted. The app checks Android's allowlist before calling `startLockTask()` and reports the actual ActivityManager state. Android screen pinning is not strict Lock Task and remains user-exitable. When strict mode is not available, Basic immersive ROOM mode continues to work.
- **Save & Return** closes only the native maintenance overlay, preserves the existing web ROOM session and presence, restores immersive display, and re-enters strict mode only when opted in and Android confirms the app is eligible. Changing HOME or kiosk settings does not assign or unregister a room.

## Reboot and app updates

- The app listens for `BOOT_COMPLETED` and `MY_PACKAGE_REPLACED`. It checks the protected native ROOM session before restarting only the ROOM presence service. It does not launch an Activity from either broadcast.
- Select Hotel Alert as the system Home app if the ROOM screen should return automatically after boot. Without that selection, the operator must open the app; the presence service may still restart in the background.
- Boot restoration runs after Android makes the app's normal private storage available (after the device's first unlock). This app is not Direct-Boot-aware.
- Android can suppress automatic restart after an operator force-stops the app. Some manufacturers add background-start or battery policies; configure and validate those per device.
- The ROOM service uses the declared `specialUse` foreground-service type and keeps a low-priority service notification. Android 15 target-35 restrictions prohibit boot-starting `dataSync` foreground services; the ROOM restore path does not start the separate AREA `dataSync` service. Foreground-service classification and OEM behavior still require release verification.

## Lockdown boundary

HOME selection and immersive fullscreen provide a convenient Basic mode, not a security boundary. They do not require Device Owner and remain the default for ROOM stations. Android screen pinning is user-exitable and must not be described as strict kiosk lockdown.

Hotel Alert is registered as a possible same-app Device Policy Controller and includes a guarded ROOM Lock Task policy wrapper. Native maintenance can configure a local strict-mode preference, but strict mode is usable only after Android has provisioned Hotel Alert as Device Owner and allowed the package for Lock Task. The app does not provision itself or write protected DPM settings without verifying Device Owner status. The device-admin metadata requests no legacy Device Admin policies; Lock Task policy is only available to the app when Android has provisioned it as Device Owner.

## Optional Device Owner commissioning

Device Owner is optional and is not needed for ordinary ROOM use. Only an authorized operator should provision it on a dedicated ROOM device. Device Owner is a powerful, device-wide management state; the app cannot grant itself that role after installation.

For a production fleet, use the organization's approved fully managed-device provisioning flow (for example, QR enrollment during Android setup or an EMM). Device support and eligibility depend on the Android/OEM setup state. Only enable Device Owner on a production ROOM device through the approved fleet-management process; do not attempt to grant it from the app or improvise provisioning on a deployed device.

For an isolated development device running Android 9 (API 28) or later only, Android's DPM shell command can provision the receiver after installing the APK when the device/account state permits it. Android's development instructions require removing device accounts first; this command is not the production enrollment workflow:

```sh
adb shell dpm set-device-owner com.hotelalert.notificationreceiver/.admin.HotelAlertDeviceAdminReceiver
```

This command is documentation only; it was not run as part of this change. A successful Device Owner provisioning does not automatically enable strict mode. The app's explicit native maintenance action can set a persistent HOME preference, and strict-mode readiness will only allowlist Hotel Alert after confirming a persisted ROOM session and Device Owner authority. The operator must separately opt in to strict Lock Task and save; the app does not change lock-task system UI features.

## Device Owner removal and recovery

This release has no in-app Device Owner relinquish flow. Do not treat uninstalling Hotel Alert as a removal procedure: Android protects the Device Owner package from ordinary deactivation/uninstall. The DPM `remove-active-admin` shell command is restricted to test-only admin apps, and this production manifest is not marked `android:testOnly`. For a production device, use the organization's approved EMM/provisioning recovery procedure; if it cannot relinquish ownership, factory-reset the device before reusing it. Do not use the deprecated `clearDeviceOwnerApp()` API as a production recovery mechanism.

Strict Lock Task does not auto-start from HOME, boot, package-replacement, or ROOM session callbacks. Entry is tied to the explicit local opt-in and Save & Return path. Validate Settings round-trips and manual recovery on each supported Android/OEM combination before fleet rollout.

Android platform references: [Lock Task mode](https://developer.android.com/work/dpc/dedicated-devices/lock-task-mode), [RoleManager HOME role](https://developer.android.com/reference/android/app/role/RoleManager), [Home app settings](https://developer.android.com/reference/android/provider/Settings#ACTION_HOME_SETTINGS), [DPM persistent preferred activity](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#addPersistentPreferredActivity(android.content.ComponentName,android.content.IntentFilter,android.content.ComponentName)), [DeviceAdminReceiver](https://developer.android.com/reference/android/app/admin/DeviceAdminReceiver), [DPM shell commands](https://developer.android.com/tools/adb).

Test each supported manufacturer and Android release with boot, app replacement, screen-off presence, HOME selection, and manual recovery. No device-specific behavior is guaranteed by this guide.
