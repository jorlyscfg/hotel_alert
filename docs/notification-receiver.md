# Notification Receiver Architecture

This is the canonical T3-DOC for additive, read-only notifications on area-assigned devices. T2's TypeScript LAN Socket.IO runtime is implemented and verified. T3-W (Windows) and T3-A (Android) are not implemented, so this document describes their boundaries and verification requirements rather than claiming platform support.

## Decisions and current status

| Target | Chosen model | Current state |
| --- | --- | --- |
| Shared behavior | Transport-agnostic receiver core behind `NotificationSink` and `DurableCursorStore` | Implemented in the TypeScript workspace |
| LAN runtime | Node.js/TypeScript runtime using the existing REST snapshot and Socket.IO `/realtime` namespace | T2 implemented and verified |
| Windows | A Node.js service reusing the verified TypeScript LAN runtime | T3-W not implemented; Windows verification is unavailable here |
| Android | A native Kotlin/Jetpack Compose application with a native background-delivery boundary | T3-A not implemented; Java, Gradle, and Android SDK configuration are unavailable here |

The transport remains LAN/VPN only. The receiver never accepts, transitions, acknowledges, or otherwise mutates a hotel request. `client.event.received` is a transport receipt, not a business acknowledgement.

## Scope and non-goals

- The current web and managed-browser kiosk workflows remain unchanged.
- The receiver reads the authoritative device snapshot and durable realtime events.
- Only request events that are valid, assigned to the device's current area, and newer than the tracked aggregate version reach the sink.
- `activeRequests` from a snapshot restores state only. It never synthesizes a notification; notifications come from future eligible durable events.
- No cloud push service, public internet exposure, request mutation, or platform support is introduced by T3-DOC.

## Data path and boundaries

```text
Hotel Alert server
  ├─ GET /api/v1/device/session       authoritative snapshot
  └─ Socket.IO /realtime (/socket.io) durable events and transport acknowledgements
             │
             ▼
      LAN receiver runtime
             │  synchronized event stream
             ▼
      transport-agnostic core
        ├─ NotificationSink       platform notification delivery
        └─ DurableCursorStore     durable local event cursor
```

### Transport-agnostic core

The core receives an unknown event plus a synchronization flag. It validates the durable event envelope, filters request events by event identity, sequence, aggregate version, request validity, and assigned area, and serializes processing through a queue.

The core can ignore duplicates, out-of-order events, unsupported events, unassigned-area events, and older aggregate versions. A malformed supported request event is not treated as safely consumed. A sink failure also leaves the event uncommitted and blocks later queued events until the failed event is retried. This prevents a later event from bypassing a notification that could not be delivered.

The core has no Socket.IO, filesystem, Windows, Android, or OS-notification dependency. It does not know how a notification is displayed or where a cursor is stored.

### LAN Socket.IO runtime boundary

The current `@hotel/notification-receiver-lan` package is the Node.js boundary around that core:

| Boundary | Contract |
| --- | --- |
| Snapshot | `GET <serverOrigin>/api/v1/device/session` with `Authorization: Bearer <device-token>` |
| Socket | Socket.IO at `<serverOrigin>/realtime` with path `/socket.io` and reconnection enabled |
| Handshake | Device identity, bearer token, client instance ID, client version, last event sequence, and device configuration version |
| Synchronization | `connection.ready`, optional replay, `sync.required`, and acknowledged `connection.sync` |
| Delivery receipt | `client.event.received` after successful sink handling and cursor persistence |
| Presence | Acknowledged `device.heartbeat` messages at the interval supplied by the snapshot |
| Platform seam | `NotificationSink`, `DurableCursorStore`, snapshot/status callbacks, and auth/error callbacks |

The runtime fetches an authoritative snapshot before opening the socket, buffers durable events until synchronization is acknowledged, and recreates the core when the authoritative area assignment changes. It exposes lifecycle status such as `connecting`, `synchronizing`, `synchronized`, `auth-failed`, `error`, and `stopped` to the future platform shell.

## Adapter contracts

The current seam is intentionally small:

```typescript
export interface NotificationSink {
  deliver(notification: RequestNotification): void | Promise<void>;
}

export interface DurableCursorStore {
  readonly lastSeenEventSequence: number;
  advanceTo(eventSequence: number): void | Promise<void>;
}
```

### `NotificationSink`

- `deliver` receives the normalized event ID, event sequence, timestamp, event name, and read-only request DTO.
- The returned value means that the platform adapter has completed the delivery boundary it promises. A promise must not resolve before the OS notification has been accepted by the adapter.
- The sink must not call request mutation APIs. It may display, group, replace, or deduplicate an OS notification, but it must preserve the event ID needed for recovery.
- The adapter must tolerate a repeated event after a crash between OS delivery and cursor persistence. Event-ID deduplication is therefore a platform responsibility, not a claim that the core has an exactly-once OS guarantee.
- If delivery cannot be completed, reject or throw. The runtime must then leave the cursor and transport receipt unchanged.

### `DurableCursorStore`

- `lastSeenEventSequence` is the locally persisted durable event barrier used for replay decisions.
- `advanceTo` must not resolve until the new sequence is durably written. The adapter must reject regressions and use an atomic or crash-safe update strategy.
- A cursor write follows successful sink handling for a delivered request event. The runtime then sends `client.event.received` when the socket is still connected.
- A crash before a cursor write may cause a replay; that is safer than advancing before delivery and losing an alert.
- The cursor is not a hotel-server acknowledgement and must not be used to infer that a request was accepted or completed.

## Authentication, storage, and synchronization

### Authentication and token handling

The receiver uses a device bearer credential, not an administrator cookie. The REST snapshot sends the token in the `Authorization` header. The Socket.IO handshake sends the device ID, device token, client instance ID, client version, last seen event sequence, and current device configuration version. The server verifies that the device ID matches the token and rejects ambiguous administrator-cookie/device-token combinations.

Platform adapters own provisioning and secure retrieval of the bearer token. They must not place tokens in source control, screenshots, tickets, shell history, command-line arguments, ordinary configuration files, logs, crash reports, or telemetry. The server's `DEVICE_TOKEN_REVOKED`, `TOKEN_ROTATION_EXPIRED`, `DEVICE_INACTIVE`, and related authentication failures are terminal for the current runtime: it stops reconnecting and reports `auth-failed`. Operators must use the approved device rebind/rotation process before restarting with a replacement token.

The runtime recognizes pending token-rotation state in the snapshot but does not choose a secure storage provider or perform a platform-specific token rotation. Those responsibilities remain in T3-W and T3-A.

### Snapshot and replay sequence

1. Load the persisted cursor and platform configuration.
2. Fetch and validate the authoritative device snapshot before connecting.
3. Restore `activeRequests` and configuration through the snapshot callback only; do not call the sink for those rows.
4. Connect to `/realtime` with the device identity, token, cursor, and configuration version.
5. Buffer incoming durable events while the runtime is not synchronized.
6. On `connection.ready`, request acknowledged `connection.sync` with the cursor and configuration version. The server may replay events, report `UP_TO_DATE`, or require a full snapshot.
7. If the server sends `sync.required`, or a device configuration/assignment change requires it, fetch a fresh snapshot. A refresh may advance the cursor to the snapshot's current event sequence before synchronization resumes.
8. Mark the stream synchronized only after the sync acknowledgement succeeds, drain buffered events in order, and start the heartbeat timer.

This ordering makes a snapshot a state-recovery boundary rather than a source of duplicate startup alerts. An event that is not safely synchronized remains deferred rather than advancing the cursor.

### Heartbeat and reconnect

After synchronization, the runtime sends `device.heartbeat` with the client version and socket-connected state at the interval provided by the device configuration. The server records presence and applies its heartbeat rate limit. Disconnects clear the heartbeat timer, mark the runtime unsynchronized, and leave normal Socket.IO reconnection enabled. Reconnection must complete the same synchronization barrier before buffered events are delivered.

Authentication failures disable reconnection and require operator intervention. Non-authentication failures are reported through the runtime error callback and remain subject to the platform service's restart policy.

### Acknowledgement behavior

| Message | Meaning | When it is sent |
| --- | --- | --- |
| `connection.sync` acknowledgement | The server accepted the synchronization request and reports the replay state | Before the runtime becomes synchronized |
| `client.event.received` acknowledgement | The receiver consumed an event after its local delivery/cursor barrier | After sink handling and a successful cursor advance; not for deferred or failed events |
| `device.heartbeat` acknowledgement | The server accepted the presence update | After the server records the heartbeat |

None of these acknowledgements changes request status. A sink failure, cursor failure, disconnected socket, or authentication failure must not be converted into a successful delivery receipt.

## Windows target: Node.js service

### Decision

Windows will use a background Node.js service that reuses the verified TypeScript LAN runtime. This avoids duplicating the LAN protocol in a second JavaScript implementation and keeps Windows delivery behind the existing core contracts. It is not an Electron window and is not the current browser kiosk.

### Still to implement

T3-W must add, without changing the server or web request workflow:

1. A Windows service host that loads configuration, creates the LAN runtime, and maps service start/stop events to `start()` and `stop()`.
2. A Windows `NotificationSink` that integrates with the supported Windows toast/Action Center API and resolves only when its delivery boundary is complete.
3. A protected `DurableCursorStore` and protected token provisioning/retrieval. The concrete Windows provider is not selected yet; it must be tied to the service identity and must support crash-safe cursor updates.
4. Configuration validation, structured redacted diagnostics, graceful shutdown, bounded restart/backoff behavior, and terminal handling for revoked or expired credentials.
5. A packaging and upgrade path that installs/registers the service, includes the compatible Node.js runtime or an approved runtime prerequisite, and supports removal and rollback without deleting unrelated hotel data.

### Lifecycle and storage requirements

- Install and configure the service under a least-privilege service identity.
- Start it at the required boot boundary; a service that is stopped or fully terminated cannot receive LAN events.
- On stop or upgrade, stop accepting new work, call the runtime's `stop()`, and preserve the last durable cursor.
- Keep the token out of command-line arguments, plain-text service definitions, ordinary logs, and crash dumps. A Windows protected store such as a service-account-scoped credential/DPAPI design may be evaluated, but T3-W must select and verify the actual provider.
- Store the cursor atomically in protected application data. Never reset it as a routine recovery step; use snapshot/replay synchronization instead.
- Separate token replacement from cursor recovery. Rebinding a device must not silently discard the cursor or synthesize notifications from `activeRequests`.

### Windows-only verification gate

T3-W cannot be considered supported until an actual Windows environment verifies all of the following:

- install, upgrade, uninstall, service start, graceful stop, automatic restart, and boot-start behavior;
- notification visibility, grouping/deduplication, permission/policy behavior, and delivery while no UI is open;
- sink failure followed by retry without cursor advancement or event acknowledgement;
- server restart, LAN/VPN loss, reconnect, replay, event-gap full snapshot, and assignment/configuration changes;
- token revocation, inactive-device response, expired rotation response, and secure replacement-token provisioning;
- cursor persistence across service restart, crash recovery, upgrade, and rollback;
- proof that the receiver remains read-only and that the existing web/kiosk workflow is unaffected.

No Windows service, toast integration, package, or Windows test is claimed by T3-DOC.

## Android target: native Jetpack Compose application

### Decision and project boundary

Android will use a new, separately buildable Gradle/Kotlin application boundary with Jetpack Compose for setup, status, and operational UI. The Compose UI is not the delivery process. A native Android lifecycle component must own the LAN connection, synchronization, sink, and cursor while the UI is not visible.

The TypeScript LAN package is not automatically reusable from a native Kotlin application. T3-A must preserve the same protocol and delivery semantics in Kotlin, or introduce a separately designed and verified JavaScript-runtime bridge. No bridge is selected or implemented. The native project must not be represented as support for the existing managed browser merely because it displays the same server URL.

### Lifecycle, permission, and storage requirements

- Use an Android-approved background boundary for a live LAN connection; a user-visible foreground service is the expected option to evaluate for continuous delivery. A Composable, Activity, or periodic scheduler is not by itself a reliable socket owner.
- Handle process death, configuration changes, screen lock, Wi-Fi loss, reconnect, and OS background restrictions explicitly. A force-stopped or OS-terminated application cannot promise delivery until Android starts it again.
- Create notification channels for supported Android versions. On Android 13/API 33 and later, request `POST_NOTIFICATIONS` at an intentional foreground UI point and show a clear disabled-delivery state when it is denied. See the [Android notification permission guidance](https://developer.android.com/develop/ui/compose/notifications/notification-permission).
- Store the device token in an Android Keystore-backed encrypted store or an approved equivalent. Do not use plain preferences, logs, intents, screenshots, or exported files for bearer credentials.
- Persist the cursor in app-private durable storage with an atomic/transactional update. Resolve the Kotlin equivalent of `deliver` only after the OS notification boundary succeeds, then advance the cursor, then send the transport receipt.
- Keep token rotation, cursor recovery, and notification-permission recovery separate. Permission denial or secure-store failure must not advance the cursor as if delivery succeeded.
- Expose connection, synchronization, heartbeat, permission, and authentication state to Compose through a lifecycle-aware state holder; do not make composables responsible for network ownership.

### Android-only verification gate

T3-A cannot be considered supported until a real Android build and target tablet verify:

- Gradle/Kotlin build, signing, install, upgrade, uninstall, and rollback of the new project;
- first-run provisioning, secure token storage, token replacement, cursor persistence, and no secret leakage in `adb` output;
- notification-channel creation, Android 13+ permission grant/deny, locked-screen delivery, denied-permission recovery, and OS policy behavior;
- background/foreground transitions, process death/restart, service restart, screen lock, Wi-Fi/LAN loss, reconnect, replay, full snapshot, and assignment changes;
- sink failure and retry barriers, duplicate event handling, heartbeat status, and read-only behavior;
- coexistence with the non-dedicated tablet's normal hotel applications without relying on a browser kiosk URL.

No Android project, Compose app, native service, or Android test is claimed by T3-DOC.

## Why managed browser/MDM kiosk is not native delivery

The current managed browser/MDM kiosk controls a browser page, its site data, screen policy, Wi-Fi policy, and crash restart policy. It does not provide a native OS notification sink or guarantee that JavaScript, a WebSocket, or the browser process can run after the page is hidden, the process is reclaimed, or the device is force-stopped. Browser audio and site-notification permissions also remain browser-specific.

The kiosk is therefore a supported web-display deployment shape, not an equivalent implementation of a background notification receiver. Native Windows and Android targets must own their service/application lifecycle, OS notification permission, secure storage, cursor durability, and platform-specific verification. The kiosk guide remains in [`android-kiosk.md`](android-kiosk.md); deployment and operational boundaries are in [`deployment.md`](deployment.md) and [`operations-runbook.md`](operations-runbook.md).

## Toolchain limits and implementation order

The T3-DOC environment currently provides:

| Capability | Observed evidence | Consequence |
| --- | --- | --- |
| Node.js | `v24.13.1` | Compatible with the repository's `>=20.18.0 <26` engine range |
| Corepack | `0.34.6` | The existing pnpm workflow is available |
| Java | `java` not found | No Android Gradle/Kotlin build can be verified |
| Gradle | `gradle` not found | No native Android project can be built here |
| Android tooling | `adb` 1.0.41 available; `ANDROID_HOME` and `ANDROID_SDK_ROOT` unset | Device communication exists, but the SDK/build environment is incomplete |
| Windows | No Windows runtime or OS-notification environment | No Windows service, packaging, or toast verification |

The honest implementation order is:

1. Keep the shared TypeScript core and T2 LAN runtime as the protocol reference; T3-DOC records their boundary without changing them.
2. Implement T3-W only after a Windows-capable build, service, secure-storage, and notification test environment is available.
3. Implement T3-A only after Java, Gradle, Android SDK/toolchain configuration, and a target tablet are available.
4. Run the platform-specific verification gates before documenting either platform as supported.
5. Keep the existing browser/kiosk workflow as the fallback while either native adapter is unavailable.

## Operator and deployment checklist

For a platform adapter that has passed its verification gate:

- [ ] Confirm the server health endpoint, exact LAN/VPN origin, firewall scope, and Socket.IO path are reachable.
- [ ] Provision an active AREA-assigned device token through the approved protected flow; do not record the token in the deployment record.
- [ ] Confirm the platform's secure token store and durable cursor store are readable by the actual service/application identity.
- [ ] Start or enable the platform receiver and confirm `synchronized` state, heartbeat presence, and current area assignment.
- [ ] Send one controlled test request and confirm the OS notification; verify that a pre-existing `activeRequests` row on restart does not create a duplicate startup alert.
- [ ] Exercise one reconnect or server restart and confirm replay/full-snapshot recovery without request mutation.
- [ ] Record version, device ID, safe error code, event ID, and timestamps only; never record tokens or authorization headers.

### Rollback boundaries

- **T3-DOC:** remove only `docs/notification-receiver.md` and the T3 receiver sections added to the three linked operational documents.
- **T3-W:** stop/disable or uninstall only the Windows service and its adapter/package. Leave the server, shared receiver core, database, and web/kiosk flow intact.
- **T3-A:** stop/disable or uninstall only the Android application and its adapter/project. Leave the server, shared receiver core, database, and web/kiosk flow intact.
- Preserve the cursor during ordinary rollback. Revoke and rebind a device only when its credential is compromised or intentionally replaced.
- Do not delete the server database, outbox, replay history, or unrelated deployment data as a receiver rollback.
