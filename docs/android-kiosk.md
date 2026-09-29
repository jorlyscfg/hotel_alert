# Android Kiosk Guide

This guide covers the existing managed browser/MDM kiosk deployment only. The web application supports Android room devices through a modern kiosk browser, but hardware power, auto-start, Wi-Fi persistence, and watchdog behavior are deployment responsibilities rather than browser guarantees. It does not provide native OS background notification delivery.

The separate native Jetpack Compose target is not implemented yet. Its lifecycle, notification permission, secure storage, cursor, and verification boundary are documented in [`notification-receiver.md`](notification-receiver.md).

## Device checklist

Record the following for every supported device/browser combination:

- Device model and Android major version
- Kiosk browser package and exact version
- Kiosk or MDM policy version
- Screen-on-while-charging and rotation settings
- Wi-Fi network and captive-portal exclusion
- LAN URL reachability
- Browser site-data persistence behavior
- Audio permission and user-gesture behavior
- Browser/application crash recovery behavior

A combination is release-supported only after every item passes on the actual hardware.

## First bootstrap

1. Review the starter area/service catalog and add or edit entries from an administrator session as needed.
2. Use the admin device-bootstrap flow for the installation ID and assignment.
3. Record the returned device token in the approved secure provisioning process.
4. Enter the token once in the room device.
5. Verify the device receives its configuration and reaches `ONLINE` after a heartbeat.
6. Confirm a request appears in the assigned room/area queue.

Tokens are bearer credentials. Do not place them in screenshots, tickets, shell history, source control, or shared chat.

## Browser storage recovery

If browser storage is cleared, the device cannot recover its bearer token from the server. An administrator must use the protected rebind flow, display the newly issued token once, and provision it again. The rebind operation requires an idempotency key; repeating the same request safely replays the original result, while reusing the key for different input is rejected.

## Runtime behavior

- `ONLINE`: heartbeat is within the stale threshold.
- `STALE`: heartbeat is older than the stale threshold but not yet offline.
- `OFFLINE`: no recent heartbeat or a confirmed transport failure.
- `DISABLED`: administrator disabled the device.

The device reports connection and synchronization state, but presence does not prove that the physical display is visible or that audio is audible. Enable audio from a user gesture and define a visible fallback for pending alerts.

## Managed kiosk boundary

MDM can keep the kiosk URL, browser site data, screen policy, and crash-restart policy in place. It cannot guarantee that the browser process, JavaScript event loop, or WebSocket remains alive after the page is hidden, the process is reclaimed, or the device is force-stopped. Browser permissions and site-data storage are also not equivalent to a native OS notification sink or a Keystore-backed token store.

Use the kiosk as the current web-display path. Do not describe it as T3-A support or as a substitute for a native Compose application with a platform-owned background delivery lifecycle.

## Recovery checks

Exercise these before rollout and after kiosk-policy changes:

- Drop and restore Wi-Fi during a request.
- Disconnect Socket.IO while REST remains available.
- Restart the server and verify automatic reconnect/full snapshot behavior.
- Clear browser storage and perform protected rebind.
- Revoke a token while the device is connected and verify immediate disconnect.
- Confirm the kiosk browser restarts after a crash and preserves the configured site data.
