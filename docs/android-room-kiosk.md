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

HOME selection and immersive fullscreen provide a convenient Basic mode, not a security boundary. This release does not configure Device Owner or Lock Task. Android screen pinning is user-exitable and must not be described as strict kiosk lockdown. Optional Device Owner/Lock Task setup is a separate operator procedure and is not required for normal ROOM use.

Test each supported manufacturer and Android release with boot, app replacement, screen-off presence, HOME selection, and manual recovery. No device-specific behavior is guaranteed by this guide.
