# ODD Task: Android ROOM kiosk and persistent presence

## Objective

Make the Hotel Alert Android APK a practical replacement for the separate ROOM kiosk app: keep the existing shared web registration flow, enter a full-screen ROOM experience after assignment, return to it after reboot, and keep the ROOM station heartbeating while the display is off.

## Problem and Why

ROOM assignment and live presence currently depend on the WebView's browser storage and JavaScript timers. When Android suspends the WebView or the device restarts, the station may stop reporting presence. The APK has no HOME launcher or kiosk policy today. Full-screen immersive UI is not strict lockdown; Android Lock Task requires Device Owner policy. FreeKiosk's useful lesson is to distinguish a low-friction Basic mode from an optional fully managed/strict mode instead of promising both through an ordinary launcher setting.

## Authorized Scope

- Add native ROOM credential/session handoff after the existing web `/devices/bootstrap` registration succeeds; keep the web login, target selection, and server registration as the single enrollment flow.
- Keep ROOM native presence separate from the existing AREA Socket.IO/snapshot/commands pipeline. Use the authenticated server session and heartbeat contracts, persist secrets in Android Keystore-backed storage, reconnect with bounded backoff, and clear native ROOM credentials after a confirmed revoked/inactive assignment.
- Add a generic Android HOME/boot restoration path, fullscreen immersive ROOM mode, and a concealed repeated-tap maintenance gate protected by a per-device operator PIN; preserve setup/admin/AREA behavior.
- For a dependency-closed ARKP-01 work-unit commit, include the already-pending shared web login/role/room-target assignment flow and only its required styles, translations, persistence helpers, and focused tests. The user explicitly authorized this related commit scope on 2026-09-23; keep unrelated admin/media/localization changes out.
- Support two deployment levels: ordinary manual installation + operator-selected HOME/immersive mode as the default, and optional Device Owner/Lock Task for strict single-app lockdown. Do not run ADB, configure a physical device, require factory reset, or claim ordinary HOME is a strict kiosk.
- Provide operator instructions for HOME selection, optional Device Owner activation/removal, maintenance, and Android/OEM limitations. All behavior must remain generic across supported Android 26–35 devices.
- Preserve all unrelated staged, unstaged, and untracked work; do not push, open a PR, or mutate room/area assignments.

## Constraints and Decisions

- User confirmed ROOM devices are permanently connected to mains power; use that to reduce Doze exposure, but do not promise identical screen-off networking across every OEM.
- Use a native Room presence runtime, not WebView timers and not the current AREA `dataSync` service. Target SDK is 35; verify foreground-service type/start rules and keep a visible low-priority service notification where Android requires it.
- Keep the API's existing token/heartbeat semantics and server stale/offline thresholds; do not increase heartbeat frequency beyond the server's documented rate limit.
- Use the same APK as both kiosk UI and (only when explicitly activated by an operator) its own Device Policy Controller. Device Owner is optional; do not make it a prerequisite for basic setup.
- Never embed a shared maintenance PIN in the APK. Create/configure a device-specific PIN during ROOM commissioning and persist it using Android protected storage; support recovery by leaving the current shared admin authentication path available.
- Existing changes are extensive and mixed; no broad reformat/revert. Use isolated staging for only the work-unit files/hunks. Existing `MM` files and the shared index must remain untouched.
- Effective TDD: OFF, according to the active Android task configuration. Run ordinary functional checks.
- Android runner (from `apps/android-notification-receiver`): `source /home/jorlys/.local/share/hotel-alert-env/android-toolchain.sh && ./gradlew :app:testDebugUnitTest :app:assembleDebug :app:lintDebug :app:check`.
- Receipt-driven review: disabled/unmanaged; do not start reviews.
- Implementation route: delegated direct for both tasks. Mapping trigger evidence: flow crosses Android activity/manifest/storage/service, the JS bridge, web bootstrap, server heartbeat, and lifecycle cleanup; CodeGraph mapping completed before source changes. Writer trigger evidence: each task modifies multiple non-trivial Android/web/test/documentation files.
- Delivery: strategy `stacked-to-main`, selected by the user on 2026-09-23. The dependency-closed ARKP-01 forecast is 3,304 authored lines, naturally split into two behavior slices: shared web onboarding/bridge plus focused tests/docs (2,323 lines: 2,201 additions, 122 deletions), followed by native Android ROOM presence (981 lines: 974 additions, 7 deletions). This is a platform boundary, not a size-only split. Do not create a new branch: continue on the already-existing `jorlys/feat/lan-notification-agent` feature branch. Work-unit commits stay on that feature branch; push/PR remains unrequested and requires separate authorization.

## Tasks

### ARKP-01 — Give ROOM a native durable presence session

- Bridge successful ROOM bootstrap credentials from the shared web flow into a dedicated Android Keystore-backed ROOM session store.
- Add a separate native ROOM foreground presence service that reads the authenticated role-aware session/configuration as needed, sends server-authenticated heartbeats on the server-supported interval, reconnects safely, and distinguishes transient network failure from revoked/inactive credentials.
- Start/stop/update the service with ROOM assignment, token rotation, and confirmed revocation; keep AREA pairing, snapshot persistence, and request-command behavior unchanged. Ensure a removed ROOM device eventually clears both native credentials and browser-persisted device state and returns to onboarding.
- Add focused Android/web unit tests for handoff, heartbeat/retry/auth-revocation behavior, token updates, and cleanup. Add concise runtime diagnostics without logging tokens.
- Route: delegated direct writer. Scope owner: ROOM bridge/session/presence files plus focused tests; preserve unrelated shared-file edits.
- Checks: focused web/Android tests, Android assemble/lint/check runner, relevant web typecheck/unit tests, and `git diff --check`.
- Verification observed: 60 focused web unit tests and `corepack pnpm typecheck` passed. Android `:app:testDebugUnitTest :app:assembleDebug :app:lintDebug :app:check` passed. Focused token-rotation and HTTP redirect regression tests passed; no Android device was touched.
- Hardening: reject HTTP redirects on ROOM bearer-token requests; if the staged token changes after it was validated, report `RETRYING` rather than `ONLINE` and validate the current token on the next cycle.
- Commit isolation: `App.tsx` now uses separate `native-room-bridge.ts` and minimal `native-station-bridge.ts` modules. The station bridge retains only versioned pairing/snapshot/receiver status needed by shared AREA/ROOM onboarding; it does not expose T3 device commands. ROOM restore/invalidation no longer depends on the generic station bridge. An independent audit confirmed App no longer imports mixed `native-bridge.ts` or passes T3-only `DeviceScreen` props; select behavior-level App/test hunks rather than staging full mixed files.
- Latest focused web verification: `corepack pnpm exec vitest run tests/unit/app.test.ts tests/unit/native-room-bridge.test.ts tests/unit/native-station-bridge.test.ts tests/unit/app-model.test.ts tests/unit/api.test.ts tests/unit/admin-login.test.ts tests/unit/bootstrap-screen.test.ts tests/unit/device-role-assignment.test.ts tests/unit/ui-styles.test.ts` — 9 files, 151 tests passed; `corepack pnpm typecheck` and `git diff --check` passed. Android runner `:app:testDebugUnitTest :app:assembleDebug :app:lintDebug :app:check` passed (incremental Gradle: 78 tasks, 1 executed, 77 up-to-date). Runtime harness not run: no device or emulator scenario was operated. No physical Android device was touched.
- Progress: ☐ Implementation and verification complete; task remains open until the web onboarding slice and native Android presence slice are dependency-closed, verified, and committed while excluding unrelated mixed AREA/admin changes.

### ARKP-02 — Make assigned ROOM devices boot into an operator-maintainable kiosk

- Make the APK eligible for Android HOME selection and request/select HOME after ROOM onboarding where supported; use a documented operator fallback on older/OEM-specific Android versions.
- Apply edge-to-edge immersive fullscreen only to assigned ROOM mode; restore HOME/ROOM view after reboot/app update and avoid imposing kiosk behavior on AREA/Admin devices.
- Add optional same-app Device Owner/DeviceAdmin support for strict Lock Task, allowlist the APK only when owner policy is active, and never mistake user-exitable screen pinning for strict lockdown.
- Add a hidden repeated-tap maintenance entry, local device-specific PIN verification, safe unlock/exit controls, and a recovery route through existing admin authentication. Do not hardcode a fleet PIN.
- Add tests and operator documentation covering Basic vs strict setup, Android version/OEM variance, PIN recovery, and the fact that device operation/ADB must be performed by the operator outside this code task.
- Route: delegated direct writer. Scope owner: MainActivity/kiosk/admin/manifest/docs and focused tests; preserve ARKP-01 and unrelated changes.
- Checks: Android unit tests, assemble/lint/check runner, manifest/launcher behavior tests where feasible, and `git diff --check`. Physical multi-OEM behavior remains pending until operator-run device-matrix testing.
- Progress: ☐ Not started.

## Acceptance Criteria

- ROOM devices keep the current shared login/assignment/bootstrap experience; no separate native room-registration path is introduced.
- When WebView JavaScript is paused or the activity is not visible, a native ROOM runtime continues posting authenticated heartbeats; it never routes ROOM through AREA-only snapshots or commands.
- Server/network transient errors retain valid credentials and retry with backoff; confirmed revocation clears local ROOM state without erasing the configured server origin and causes onboarding to reappear.
- ROOM mode restores after device reboot and uses fullscreen immersive UI. Basic mode is available without Device Owner; strict Lock Task is enabled only when Android confirms the app is allowlisted by its Device Owner.
- A repeated-tap gesture requires the device-specific maintenance PIN before exiting strict mode; no universal PIN is embedded. Existing admin login offers a documented recovery path.
- Area/admin behavior and all pre-existing project work remain intact. Tests/build/lint/check results and unavailable physical-device/OEM checks are reported honestly.

## Verification Evidence

- FreeKiosk's current installation/features documentation distinguishes Basic auto-start/partial lock from Device Owner strict Lock Task. Its setup guide documents `dpm set-device-owner` and says factory reset is typically not needed when account/device state allows; some OEM/device states may still require remediation.
- Android official Lock Task documentation confirms only DPC-allowlisted apps can enter real Lock Task; screen pinning is user-exitable: https://developer.android.com/work/dpc/dedicated-devices/lock-task-mode.
- Android target-35 documentation prohibits launching `dataSync` FGS from `BOOT_COMPLETED` and imposes a six-hour-per-day `dataSync` cap; FGS starts also have background restrictions. Do not reuse AREA's `dataSync` service for ROOM presence: https://developer.android.com/about/versions/15/changes/foreground-service-types ; https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start.
- Android `specialUse` FGS requires manifest subtype disclosure and may be subject to Play review; verify the exact service classification before implementation and document it: https://developer.android.com/about/versions/14/changes/fgs-types-required.
- CodeGraph confirmed current app `MainActivity` has no HOME/kiosk handling; ROOM bootstrap stores credentials in WebView state while native pairing is AREA-specific. Server supports bearer-authenticated `/api/v1/device/heartbeat` and role-aware `/api/v1/device/session`; preserve these contracts and the AREA-only parser/command guards.
- ROOM native session requests now refuse redirects so Authorization cannot be forwarded to a redirected endpoint. Token promotion is compare-and-promote; a failed compare is reported as a retry, not falsely marked online. Regression tests cover both cases.
- Worktree contains broad staged/unstaged/untracked changes, including mixed `MM` paths; avoid changing the shared index. No Android device/ADB has been touched for this feature.

## Next Step

The user selected `stacked-to-main` and authorized including the pending shared login/role/room-assignment web block if required for a buildable ARKP-01 commit. The minimal base station bridge and separate ROOM bridge are implemented and verified. Create the first dependency-closed work-unit for the shared web onboarding/bridge boundary (2,323 authored lines), then a second work-unit for native Android ROOM presence (981 authored lines). Keep the mixed `native-bridge.ts`, `DeviceScreen.tsx`, admin/media/catalog localization, AREA T3 alerts/commands, and all other dirty work out. The web slice includes only role/assignment/ROOM restore handoff logic, its selected API/model helpers, English and Spanish keys required by the shared flow, relevant styles, and focused tests; include `parseDeviceSyncSnapshot` only with the station bridge. Continue on the existing feature branch, preserve the shared index, and do not create another branch or push/open a PR. No device/ADB verification is authorized or claimed.

## Relevant Files

- `apps/android-notification-receiver/app/src/main/AndroidManifest.xml` — Android app/Activity/service/component declarations.
- `apps/android-notification-receiver/app/src/main/java/com/hotelalert/notificationreceiver/MainActivity.kt` — WebView Activity and lifecycle.
- `apps/android-notification-receiver/app/src/main/java/com/hotelalert/notificationreceiver/web/NativeWebViewBridge.kt` — native bridge called from web onboarding.
- `apps/android-notification-receiver/app/src/main/java/com/hotelalert/notificationreceiver/protocol/RoomPresence.kt` — ROOM lifecycle, heartbeat, and token-rotation protocol.
- `apps/android-notification-receiver/app/src/main/java/com/hotelalert/notificationreceiver/network/HttpRoomPresenceClient.kt` — authenticated ROOM session and heartbeat HTTP client.
- `apps/android-notification-receiver/app/src/test/java/com/hotelalert/notificationreceiver/RoomPresenceTest.kt` and `HttpRoomPresenceClientTest.kt` — focused native protocol and redirect regression tests.
- `apps/android-notification-receiver/app/src/main/java/com/hotelalert/notificationreceiver/storage/AndroidStores.kt` — secure token and configuration storage.
- `apps/web/src/App.tsx`, `apps/web/src/native-room-bridge.ts`, and `apps/web/src/native-station-bridge.ts` — shared bootstrap/assignment, ROOM presence handoff, and narrow generic station bridge; keep the mixed `native-bridge.ts` out of this work unit.
- `apps/server/src/domain/hotel-service.ts` and `apps/server/src/http/app.ts` — session, heartbeat, and bootstrap behavior; no server contract change planned.
