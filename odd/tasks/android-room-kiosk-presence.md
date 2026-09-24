# ODD Task: Android ROOM kiosk and persistent presence

## Objective

Make the Hotel Alert Android APK a practical replacement for the separate ROOM kiosk app: keep the existing shared web registration flow, enter a full-screen ROOM experience after assignment, return to it after reboot, and keep the ROOM station heartbeating while the display is off.

## Problem and Why

ROOM assignment and live presence currently depend on the WebView's browser storage and JavaScript timers. When Android suspends the WebView or the device restarts, the station may stop reporting presence. The APK has no HOME launcher or kiosk policy today. Full-screen immersive UI is not strict lockdown; Android Lock Task requires Device Owner policy. FreeKiosk's useful lesson is to distinguish a low-friction Basic mode from an optional fully managed/strict mode instead of promising both through an ordinary launcher setting.

## Authorized Scope

- Add native ROOM credential/session handoff after the existing web `/devices/bootstrap` registration succeeds; keep the web login, target selection, and server registration as the single enrollment flow.
- Keep ROOM native presence separate from the existing AREA Socket.IO/snapshot/commands pipeline. Use the authenticated server session and heartbeat contracts, persist secrets in Android Keystore-backed storage, reconnect with bounded backoff, and clear native ROOM credentials after a confirmed revoked/inactive assignment.
- Add a generic Android HOME/boot restoration path, fullscreen immersive ROOM mode, and a concealed four-tap maintenance gate protected by a four-digit configuration PIN; preserve setup/admin/AREA behavior.
- Keep the ROOM platform experience in the existing web session. All Android maintenance and kiosk controls must be native and must not pass the PIN through JavaScript or the WebView bridge.
- For a dependency-closed ARKP-01 work-unit commit, include the already-pending shared web login/role/room-target assignment flow and only its required styles, translations, persistence helpers, and focused tests. The user explicitly authorized this related commit scope on 2026-09-23; keep unrelated admin/media/localization changes out.
- Support two deployment levels: ordinary manual installation + operator-selected HOME/immersive mode as the default, and optional Device Owner/Lock Task for strict single-app lockdown. Do not run ADB, configure a physical device, require factory reset, or claim ordinary HOME is a strict kiosk.
- Provide operator instructions for HOME selection, optional Device Owner activation/removal, maintenance, and Android/OEM limitations. All behavior must remain generic across supported Android 26–35 devices.
- Preserve all unrelated staged, unstaged, and untracked work; do not push, open a PR, or mutate room/area assignments.

## Constraints and Decisions

- User confirmed ROOM devices are permanently connected to mains power; use that to reduce Doze exposure, but do not promise identical screen-off networking across every OEM.
- Use a native Room presence runtime, not WebView timers and not the current AREA `dataSync` service. Target SDK is 35; verify foreground-service type/start rules and keep a visible low-priority service notification where Android requires it.
- Keep the API's existing token/heartbeat semantics and server stale/offline thresholds; do not increase heartbeat frequency beyond the server's documented rate limit.
- Use the same APK as both kiosk UI and (only when explicitly activated by an operator) its own Device Policy Controller. Device Owner is optional; do not make it a prerequisite for basic setup.
- The user explicitly approved `0623` as the default Android configuration PIN. It may remain unchanged; changing it is optional and available only from the native maintenance settings screen. This intentionally shared default supersedes the earlier per-device-only PIN requirement. Persist the active verifier using Android-protected storage, keep PIN entry/verification/change native, and never expose the PIN to JavaScript or WebView state.
- The native maintenance screen is available only for an active ROOM session. It must remain independent of the ROOM assignment and continue to preserve ROOM presence while maintenance is open or Android Settings is in the foreground.
- Android HOME selection must use system consent where available; only Device Owner policy can persistently enforce HOME or enable strict Lock Task. Basic screen pinning must never be presented as a strict kiosk lock.
- When Android Settings is opened from maintenance, exit Lock Task safely first and suppress automatic kiosk re-entry while maintenance is active. Re-enter the ROOM view and apply the requested strict lock only after the operator selects Save/Return and Android reports the policy is ready.
- Existing changes are extensive and mixed; no broad reformat/revert. Use isolated staging for only the work-unit files/hunks. Existing `MM` files and the shared index must remain untouched.
- Effective TDD: OFF, according to the active Android task configuration. Run ordinary functional checks.
- Android runner (from `apps/android-notification-receiver`): `source /home/jorlys/.local/share/hotel-alert-env/android-toolchain.sh && ./gradlew :app:testDebugUnitTest :app:assembleDebug :app:lintDebug :app:check`.
- Receipt-driven review: disabled/unmanaged; do not start reviews.
- Implementation route: delegated direct for both tasks. Mapping trigger evidence: flow crosses Android activity/manifest/storage/service, the JS bridge, web bootstrap, server heartbeat, and lifecycle cleanup; CodeGraph mapping completed before source changes. Writer trigger evidence: each task modifies multiple non-trivial Android/web/test/documentation files.
- Delivery: strategy `stacked-to-main`, selected by the user on 2026-09-23. At the current commit boundary, ARKP-01 totals 3,311 authored lines: shared web onboarding/bridge plus focused tests/docs (2,323 lines: 2,201 additions, 122 deletions), followed by native Android ROOM presence, tests, and progress evidence (988 lines: 978 additions, 10 deletions; Android code/tests are 981 lines and the tracker delta is 7). This is a platform boundary, not a size-only split. Do not create a new branch: continue on the already-existing `jorlys/feat/lan-notification-agent` feature branch. Work-unit commits stay on that feature branch; push/PR remains unrequested and requires separate authorization.

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
- Commit isolation: `App.tsx` uses separate `native-room-bridge.ts` and minimal `native-station-bridge.ts` modules. The station bridge retains only versioned pairing/snapshot/receiver status needed by shared AREA/ROOM onboarding; it does not expose T3 device commands. ROOM restore/invalidation no longer depends on the generic station bridge. An independent audit confirmed App no longer imports mixed `native-bridge.ts` or passes T3-only `DeviceScreen` props; the reviewed, dependency-closed App flow was included while the mixed adapters and unrelated changes stayed out.
- Latest focused web verification: `corepack pnpm exec vitest run tests/unit/app.test.ts tests/unit/native-room-bridge.test.ts tests/unit/native-station-bridge.test.ts tests/unit/app-model.test.ts tests/unit/api.test.ts tests/unit/admin-login.test.ts tests/unit/bootstrap-screen.test.ts tests/unit/device-role-assignment.test.ts tests/unit/ui-styles.test.ts` — 9 files, 151 tests passed; `corepack pnpm typecheck` and `git diff --check` passed. Android runner `:app:testDebugUnitTest :app:assembleDebug :app:lintDebug :app:check` passed (incremental Gradle: 78 tasks, 1 executed, 77 up-to-date). Runtime harness not run: no device or emulator scenario was operated. No physical Android device was touched.
- Work-unit 1 committed: `d5d8e87` (`feat(web): preserve station role through shared onboarding`), 2,323 authored lines; work-unit 2 below closes the native implementation boundary.
- Work-unit 2 committed: `790ed96` (`feat(android): keep room stations present in background`), 988 authored lines including tracker evidence.
- Progress: ☑ ARKP-01 complete: shared onboarding and native ROOM presence are committed in dependency-closed slices; unrelated mixed AREA/admin changes remain out.

### ARKP-02 — Make assigned ROOM devices boot into an operator-maintainable kiosk

**Forecast:** approximately 700–1,100 authored lines across Android implementation, focused tests, and operator documentation. Delivery remains `stacked-to-main` on the existing feature branch; this forecast is split by behavior boundary, not to satisfy a line-count limit.

**Route:** delegated direct. Mapping trigger evidence: lifecycle spans MainActivity, Android manifest/receivers, native ROOM session storage/service, DevicePolicyManager, tests, and operator documentation. `/root/map_arkp01_commit_hunks` completed the read-only map using CodeGraph and committed-source evidence. Writer trigger evidence: each behavior crosses multiple non-trivial Android, test, manifest, and documentation files. Effective TDD is OFF; runner is the Android Gradle command recorded above.

#### ARKP-02A — Restore the ROOM HOME/immersive experience

- Add Android HOME eligibility and request HOME role with user consent after successful ROOM onboarding where the platform supports it; provide a clear manual operator fallback otherwise.
- Restore only a persisted ROOM station after boot and app replacement, including native ROOM presence, without sending AREA/Admin users into kiosk mode.
- Apply immersive fullscreen only while a valid native ROOM assignment is active; keep setup, recovery, diagnostics, AREA, and Admin behavior available as appropriate.
- Add focused tests for HOME/restoration/fullscreen policy and update operator guidance.
- Route: delegated direct writer `/root/map_arkp01_commit_hunks`; scope owner is Android kiosk/HOME/lifecycle code, manifest, focused tests, and new `docs/android-room-kiosk.md`. Keep the pre-existing unstaged browser-only `docs/android-kiosk.md` edits untouched.
- Checks: focused Android tests, Android assemble/lint/check runner, manifest/lifecycle checks where feasible, `git diff --check`. Physical OEM/device verification remains pending.
- Verification observed: focused `RoomKioskPolicyTest` passed; prescribed Gradle `:app:testDebugUnitTest :app:assembleDebug :app:lintDebug :app:check` passed (78 tasks: 23 executed, 55 up-to-date); `git diff --check` passed. No device, emulator, or ADB was used.
- Work-unit committed: `fbf67b9` (`feat(android): restore room kiosk after reboot`), 257 authored lines across Android lifecycle/HOME restoration, focused tests, and the native ROOM operator guide.
- Progress: ☑ ARKP-02A complete: HOME role consent/manual fallback, ROOM-only immersive UI, and session-gated service restoration are implemented and automated checks pass. Physical OEM/device verification remains pending.

#### ARKP-02B — Add optional strict Device Owner Lock Task

- Add a same-app DeviceAdminReceiver and Device Owner-only Lock Task allowlist/configuration; query Android policy before entering, and never fall back to screen pinning as if it were strict mode.
- Keep actual Lock Task entry disabled until ARKP-02C adds a tested local maintenance PIN and a safe exit; ARKP-02B prepares only DPC registration and a guarded policy/controller.
- Provide explicit operator-facing activation/removal instructions; do not configure a device or execute ADB during this code task.
- Add policy decision tests and documentation. Preserve a working Basic mode without Device Owner.
- Route: delegated direct. Read-only mapping completed by `/root/map_arkp01_commit_hunks` against `HEAD=0c08e6d`. Writer `/root/map_arkp01_commit_hunks` owned only manifest DPC registration, new receiver/policy/XML, focused tests, and `docs/android-room-kiosk.md`; `MainActivity` was not changed to enter Lock Task.
- Checks: focused policy tests, Android assemble/lint/check runner, and `git diff --check`. Device Owner provisioning remains operator/device-matrix verification.
- Verification observed: focused policy/controller unit tests passed; parent reran `source /home/jorlys/.local/share/hotel-alert-env/android-toolchain.sh && ./gradlew :app:testDebugUnitTest :app:assembleDebug :app:lintDebug :app:check` successfully (78 tasks, 1 executed and 77 up-to-date); `git diff --check` passed. No device, emulator, ADB, staging, or shared-index mutation was used.
- Implemented: same-app `DeviceAdminReceiver` registration with system-protected binding permission and XML metadata; a Device Owner guarded policy adapter allowlists only Hotel Alert after a ROOM session is present; strict-mode readiness requires a valid ROOM session, Device Owner authority, package allowlisting, explicit opt-in, and a local maintenance exit. The wrapper is not yet called by the app and no `startLockTask()` entry exists. Operator docs distinguish ordinary Basic mode from optional, operator-provisioned Device Owner and include recovery constraints.
- Work-unit committed: `dccd79a` (`feat(android): prepare room device owner lock task`), 344 authored lines across DPC registration, guarded Device Owner policy, focused tests, and operator guidance.
- Progress: ☑ ARKP-02B complete and committed. Strict Lock Task must not be activated before a safe maintenance exit exists in ARKP-02C.

#### ARKP-02C — Add native ROOM maintenance and kiosk controls

**Forecast:** approximately 600–900 authored lines across native Android UI/policy, focused tests, and operator documentation. Preserve the established `stacked-to-main` delivery strategy on the existing feature branch. The two slices below are behavior boundaries, not size-only splits.

**Route:** delegated direct. Mapping trigger evidence: the behavior crosses `MainActivity`, Compose UI, Android-protected storage, HOME role handling, DevicePolicyManager, tests, and operator documentation. Read-only mapping completed by `room_maint_surface_map` and CodeGraph. Writer trigger evidence: both slices modify multiple non-trivial Android, test, and documentation files. Effective TDD is OFF; use the Android Gradle runner recorded above.

##### ARKP-02C.1 — Add native four-tap PIN maintenance entry

- Observe four rapid taps anywhere in the active ROOM view without consuming or changing the underlying WebView gestures; only ROOM mode may open the gate.
- Show a native Compose PIN-entry screen. Initialize the Android configuration PIN to `0623`; do not require changing it. The PIN may be changed from the native maintenance settings screen.
- Keep PIN entry, verification, and updates native; use Android-protected storage for the verifier and persistent failed-attempt throttling. Do not route secrets through WebView/JavaScript or clear the ROOM assignment when entering maintenance.
- Add focused unit tests for the four-tap recognition window, ROOM-only eligibility, default PIN initialization, verify/change behavior, and failed-attempt throttling.
- Route: delegated direct writer; scope owner is the Android gesture policy, MainActivity state, native PIN Compose UI, PIN verifier/storage, focused tests, and the ARKP-02C operator documentation section. Preserve unrelated staged/unstaged changes.
- Checks: focused Android tests, prescribed Android assemble/lint/check runner, and `git diff --check`. No device/ADB testing is included in this code task.
- Verification observed: `RoomMaintenancePolicyTest`, `storage.RoomMaintenancePinPolicyTest`, and `RoomKioskPolicyTest` passed; prescribed `:app:testDebugUnitTest :app:assembleDebug :app:lintDebug :app:check` passed (78 tasks; 1 executed, 77 up-to-date); `git diff --check` passed. No ADB, emulator, or device was used. The native operator guide now documents the four-tap gate, default/optional PIN change, throttling, and return to ROOM.
- Progress: ☑ complete. Work-unit committed as `39bee81` (`feat(android): add native room maintenance pin gate`), 727 authored lines across native Activity/Compose entry, encrypted PIN verifier/throttling, focused tests, operator documentation, and tracker evidence. The shared index was preserved and was not staged.
- Planned work-unit commit: `feat(android): add native room maintenance pin gate`.

##### ARKP-02C.2 — Add native Android settings, HOME, and strict-lock controls

- In the native maintenance screen, show actual HOME/default-launcher status and a user-initiated action to choose Hotel Alert as HOME. Use `RoleManager` consent on supported Android versions and a system Settings fallback where needed; when Device Owner is active, allow the existing DPC to set/clear the persistent preferred HOME activity.
- Add a strict kiosk-lock control. Enable actual Lock Task only when Device Owner allowlisting is confirmed; otherwise explain that strict lock is unavailable and preserve Basic mode without claiming screen pinning is unescapable.
- Add an Android System Settings button. If strict Lock Task is active, stop it before launching system Settings; preserve the PIN-authorized maintenance state across Activity resume and do not re-enter kiosk mode until the operator saves/returns.
- Add Save Changes and Return to ROOM behavior that persists the selected local kiosk preference, returns to the existing web-based ROOM session without changing assignment/presence, reapplies immersive mode, and enters strict Lock Task only when Android policy permits.
- Add focused tests for HOME request/status/Device Owner persistence, strict-mode readiness and lifecycle suppression/restore, plus native operator instructions and supported Android/OEM limitations.
- Route: delegated direct writer; scope owner is HOME/DPM policy adapter, MainActivity lifecycle/Settings launch, native maintenance settings UI, focused tests, and `docs/android-room-kiosk.md`. Preserve unrelated staged/unstaged changes.
- Checks: focused Android tests, prescribed Android assemble/lint/check runner, and `git diff --check`. Physical OEM behavior and on-device provisioning remain unverified.
- Progress: ☑ complete. Work-unit committed as `a2d112b` (`feat(android): control room kiosk from native maintenance`), 932 authored lines across native HOME/Lock Task settings, safe Android Settings round-trips, Activity restoration, focused policy tests, operator guidance, and tracker evidence. The settings screen is entirely native Android and the ROOM platform view remains the existing WebView. The configuration PIN defaults to `0623`; changing it is optional and occurs only inside the native maintenance screen.
- Implemented: Native maintenance reports actual HOME/default-launcher status, requests the HOME role through Android consent on supported releases, and uses guarded Device Owner policy only when authorized. Strict Lock Task has a local opt-in and is entered only after Android confirms Device Owner allowlisting. Native System Settings/Home actions safely exit strict Lock Task first, fail closed for screen-pinning/unknown states, and preserve the PIN-authorized settings route across Activity recreation without persisting PIN data. Save/Return preserves the active ROOM assignment and presence, restores immersive mode, and enters strict mode only if the real Android policy is ready. Optional PIN replacement is available from the native screen. Operator guidance distinguishes Basic mode from strict Lock Task and documents OEM/device validation limits.
- Verification observed: Focused maintenance/HOME/Lock Task tests and the prescribed Android `:app:testDebugUnitTest :app:assembleDebug :app:lintDebug :app:check` runner passed; parent reran the full runner successfully (78 tasks: 1 executed, 77 up-to-date). `git diff --check HEAD` passed. No emulator, physical device, or ADB was used, so OEM Settings and Device Owner round-trips remain pending.

#### ARKP-02D — Restore the active ROOM screen after display wake

**Forecast:** approximately 250–450 authored lines across a ROOM-only native wake-recovery path, focused tests, native maintenance access/status, and operator guidance. Continue the established `stacked-to-main` delivery strategy on the existing feature branch.

**Route:** delegated direct. Mapping trigger evidence: CodeGraph plus `/root/room_maint_surface_map` traced HOME selection, `MainActivity` lifecycle, maintenance suppression, the ROOM foreground service, and manifest receivers; no wake receiver or Activity recovery path currently exists. Writer trigger evidence: safe recovery spans service/lifecycle state, native maintenance UI/permission handoff, policy tests, and operator documentation. Effective TDD is OFF; use the Android Gradle runner recorded above.

- Register a runtime-only `ACTION_SCREEN_ON` listener while the native ROOM presence service is active; do not declare a manifest screen-on receiver or poll continuously.
- Reopen `MainActivity` at most once after wake only when the screen is interactive, the native ROOM assignment is still valid, the Activity is not already visible, and native maintenance/Android Settings suppression is inactive. Never launch during screen-off, diagnostics, revoked ROOM, or an operator maintenance round-trip.
- Respect Android background-activity-launch rules. If the OS requires user-granted overlay special access for reliable background Activity recovery, explain its purpose in the native maintenance screen and deep-link to Android's per-app permission settings; never use a full-screen notification as a workaround. Without the access, expose that recovery is best-effort and preserve ordinary HOME behavior.
- Keep the mechanism generic across Android 26–35 and OEMs; no Device Owner requirement is added, and no strict-kiosk guarantee is made. Android 10+ and OEM background-launch restrictions remain a physical-device verification risk.
- Add deterministic policy/service tests for session, screen, visible-Activity, and maintenance guards; update `docs/android-room-kiosk.md` with the recovery behavior, any required special access, limitations, and a manual wake test.
- Preserve unrelated mixed work and the shared Git index. Do not run ADB, configure a physical device, push, or open a PR.
- Checks: focused wake/HOME/maintenance unit tests, prescribed Android assemble/lint/check runner, and `git diff --check`. Device/OEM wake behavior remains pending unless separately authorized.
- Implemented: the active ROOM foreground service registers a dynamic screen on/off receiver only while native ROOM presence is configured, uses a per-wake one-shot gate, rechecks the live session/screen/visibility/maintenance/diagnostics state before launching, and unregisters on session invalidation/service stop. Native maintenance reports and deep-links to user-managed overlay access on Android 10+; no overlay is drawn and no Usage Access or full-screen notification is used.
- Verification observed: focused `RoomKioskPolicyTest` passed; the prescribed Android `:app:testDebugUnitTest :app:assembleDebug :app:lintDebug :app:check` runner passed (78 tasks, 21 executed and 57 up-to-date); `git diff --check` and scoped whitespace check passed. No ADB, emulator, or physical device was used; OEM wake behavior remains pending.
- Progress: ☑ complete. Work-unit committed as `45095cd` (`fix(android): restore room screen after wake`), 346 authored lines across guarded ROOM screen-wake recovery, native overlay-consent status/action, focused tests, operator guidance, and tracker evidence. No device install was attempted; OEM wake behavior remains pending.

## Acceptance Criteria

- ROOM devices keep the current shared login/assignment/bootstrap experience; no separate native room-registration path is introduced.
- When WebView JavaScript is paused or the activity is not visible, a native ROOM runtime continues posting authenticated heartbeats; it never routes ROOM through AREA-only snapshots or commands.
- Server/network transient errors retain valid credentials and retry with backoff; confirmed revocation clears local ROOM state without erasing the configured server origin and causes onboarding to reappear.
- ROOM mode restores after device reboot and uses fullscreen immersive UI. Basic mode is available without Device Owner; strict Lock Task is enabled only when Android confirms the app is allowlisted by its Device Owner.
- Four rapid taps anywhere in active ROOM mode open a native PIN gate; default PIN is `0623`, it can remain unchanged, and it can optionally be changed from native settings. The ROOM web UI/assignment flow remains unchanged and the PIN never enters WebView/JavaScript.
- PIN-authorized native settings can open Android System Settings, request/select the default HOME app, enable strict Lock Task when Device Owner is present, save, and return to ROOM. Lifecycle callbacks preserve maintenance until Save/Return.
- When a valid ROOM device wakes, Hotel Alert returns to its ROOM view when platform policy permits; recovery is suppressed during native maintenance and is documented as best-effort on Android/OEM combinations that block background Activity launches.
- Strict Lock Task is enabled only after Android confirms Device Owner allowlisting and a safe maintenance exit exists; Basic mode remains available without Device Owner and is never described as strict lock.
- Area/admin behavior and all pre-existing project work remain intact. Tests/build/lint/check results and unavailable physical-device/OEM checks are reported honestly.

## Verification Evidence

- FreeKiosk's current installation/features documentation distinguishes Basic auto-start/partial lock from Device Owner strict Lock Task. Its setup guide documents `dpm set-device-owner` and says factory reset is typically not needed when account/device state allows; some OEM/device states may still require remediation.
- Android official Lock Task documentation confirms only DPC-allowlisted apps can enter real Lock Task; screen pinning is user-exitable: https://developer.android.com/work/dpc/dedicated-devices/lock-task-mode.
- Android's DeviceAdminReceiver contract requires the system-protected `BIND_DEVICE_ADMIN` permission, device-admin XML metadata, and `DEVICE_ADMIN_ENABLED` intent filter: https://developer.android.com/reference/android/app/admin/DeviceAdminReceiver.
- Android Device Owner is an operator-provisioned management state; the APK cannot grant itself that authority. Avoid disabling system lock-task features absent an explicit recovery policy: https://developer.android.com/work/dpc/dedicated-devices/cookbook.
- The official ADB reference documents `dpm set-device-owner` as a development command supported on Android 9/API 28+ and requires an eligible device state; production dedicated-device provisioning should use the organization's approved managed-device enrollment flow: https://developer.android.com/tools/adb ; https://developer.android.com/work/dpc/dedicated-devices/.
- Android `RoleManager` is available from API 29; the system checks HOME-role availability, requires a qualifying HOME intent filter, and presents a user-consent request. Older versions need a manual operator fallback: https://developer.android.com/reference/android/app/role/RoleManager.
- Android's `RoleManager.createRequestRoleIntent()` explicitly prompts the user to grant HOME; `DevicePolicyManager.addPersistentPreferredActivity()` requires profile/device-owner authority to set a persistent default intent handler: https://developer.android.com/reference/android/app/role/RoleManager ; https://developer.android.com/reference/android/app/admin/DevicePolicyManager#addPersistentPreferredActivity(android.content.ComponentName,android.content.IntentFilter,android.content.ComponentName).
- Android restricts background Activity launches starting in API 29; a normal HOME selection does not authorize arbitrary foreground launches when the screen wakes: https://developer.android.com/guide/components/activities/background-starts.
- Android documents `ACTION_SCREEN_ON` as a runtime system broadcast; it is not a manifest receiver or a general exemption from background Activity launch restrictions: https://developer.android.com/reference/android/content/Intent#ACTION_SCREEN_ON ; https://developer.android.com/guide/components/activities/secure-bal.
- FreeKiosk's changelog documents a dynamic `SCREEN_ON` watchdog that checked app foreground state and relaunched after wake, tested on Xiaomi MiTV-MSSP3 / Android 9; this is evidence for a best-effort recovery pattern, not proof it bypasses modern Android launch restrictions: https://github.com/RushB-fr/freekiosk/blob/main/CHANGELOG.md.
- Android lists user-granted `SYSTEM_ALERT_WINDOW` as an exception that permits background Activity launches; requesting it is a security-sensitive opt-in and must be explained, user-granted, and checked before recovery: https://developer.android.com/guide/components/activities/secure-bal.
- Android 15 target-35 boot restrictions explicitly prohibit boot-starting selected FGS types (including `dataSync`) but list no generic Activity launch allowance; the app must not start its fullscreen Activity directly from a boot receiver: https://developer.android.com/about/versions/15/behavior-changes-15.
- Android target-35 documentation prohibits launching `dataSync` FGS from `BOOT_COMPLETED` and imposes a six-hour-per-day `dataSync` cap; FGS starts also have background restrictions. Do not reuse AREA's `dataSync` service for ROOM presence: https://developer.android.com/about/versions/15/changes/foreground-service-types ; https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start.
- Android `specialUse` FGS requires manifest subtype disclosure and may be subject to Play review; verify the exact service classification before implementation and document it: https://developer.android.com/about/versions/14/changes/fgs-types-required.
- CodeGraph confirmed current app `MainActivity` has no HOME/kiosk handling; ROOM bootstrap stores credentials in WebView state while native pairing is AREA-specific. Server supports bearer-authenticated `/api/v1/device/heartbeat` and role-aware `/api/v1/device/session`; preserve these contracts and the AREA-only parser/command guards.
- ROOM native session requests now refuse redirects so Authorization cannot be forwarded to a redirected endpoint. Token promotion is compare-and-promote; a failed compare is reported as a retry, not falsely marked online. Regression tests cover both cases.
- Worktree contains broad staged/unstaged/untracked changes, including mixed `MM` paths; avoid changing the shared index. No Android device/ADB has been touched for this feature.

## Next Step

ARKP-01 is complete on the existing feature branch in two dependency-closed commits: web onboarding/bridges `d5d8e87`, then Android ROOM presence `790ed96`; tracker evidence is committed as `cbebab0`. ARKP-02A is complete and committed as `fbf67b9`. ARKP-02B is complete in `dccd79a` with tracker evidence `06812da`. ARKP-02C.1 and C.2 are complete and committed as `39bee81` and `a2d112b` respectively. ARKP-02D is committed as `45095cd`; automated verification passed, with only physical device/OEM wake testing pending. The native configuration screen and PIN remain separate from the web ROOM session. Preserve AREA/Admin behavior and the shared index. Do not run ADB or configure a device, create another branch, push, or open a PR. No on-device wake/OEM verification is claimed.

## Relevant Files

- `apps/android-notification-receiver/app/src/main/AndroidManifest.xml` — Android app/Activity/service/component declarations.
- `apps/android-notification-receiver/app/src/main/java/com/hotelalert/notificationreceiver/RoomKioskPolicy.kt` — pure ROOM fullscreen/HOME/boot restoration predicates.
- `apps/android-notification-receiver/app/src/main/java/com/hotelalert/notificationreceiver/receiver/RoomPresenceRestoreReceiver.kt` — gated ROOM service restoration after boot/package replacement.
- `apps/android-notification-receiver/app/src/test/java/com/hotelalert/notificationreceiver/RoomKioskPolicyTest.kt` — HOME/fullscreen/restoration policy tests.
- `apps/android-notification-receiver/app/src/main/java/com/hotelalert/notificationreceiver/admin/HotelAlertDeviceAdminReceiver.kt` — same-app DPC receiver declaration.
- `apps/android-notification-receiver/app/src/main/java/com/hotelalert/notificationreceiver/admin/RoomLockTaskPolicy.kt` and `AndroidRoomLockTaskDevicePolicy.kt` — pure eligibility predicates and guarded DPM adapter; strict entry remains disabled.
- `apps/android-notification-receiver/app/src/main/res/xml/device_admin.xml` — DPC metadata with no legacy admin policies requested.
- `apps/android-notification-receiver/app/src/test/java/com/hotelalert/notificationreceiver/admin/RoomLockTaskPolicyTest.kt` and `RoomLockTaskControllerTest.kt` — ROOM/owner/allowlist/maintenance-gate policy tests.
- `docs/android-room-kiosk.md` — operator guide for the native ROOM HOME/boot/immersive flow (ARKP-02A).
- `apps/android-notification-receiver/app/src/main/java/com/hotelalert/notificationreceiver/MainActivity.kt` — WebView Activity and lifecycle.
- `apps/android-notification-receiver/app/src/main/java/com/hotelalert/notificationreceiver/RoomHomeLauncherPolicy.kt` and `admin/AndroidRoomHomePolicy.kt` — native HOME status/consent and Device Owner policy decisions.
- `apps/android-notification-receiver/app/src/main/java/com/hotelalert/notificationreceiver/ui/RoomMaintenanceScreens.kt` — native PIN and kiosk maintenance interfaces.
- `apps/android-notification-receiver/app/src/test/java/com/hotelalert/notificationreceiver/RoomHomeLauncherPolicyTest.kt` — HOME, strict Lock Task, and maintenance lifecycle policy tests.
- `apps/android-notification-receiver/app/src/main/java/com/hotelalert/notificationreceiver/web/NativeWebViewBridge.kt` — native bridge called from web onboarding.
- `apps/android-notification-receiver/app/src/main/java/com/hotelalert/notificationreceiver/protocol/RoomPresence.kt` — ROOM lifecycle, heartbeat, and token-rotation protocol.
- `apps/android-notification-receiver/app/src/main/java/com/hotelalert/notificationreceiver/network/HttpRoomPresenceClient.kt` — authenticated ROOM session and heartbeat HTTP client.
- `apps/android-notification-receiver/app/src/test/java/com/hotelalert/notificationreceiver/RoomPresenceTest.kt` and `HttpRoomPresenceClientTest.kt` — focused native protocol and redirect regression tests.
- `apps/android-notification-receiver/app/src/main/java/com/hotelalert/notificationreceiver/storage/AndroidStores.kt` — secure token and configuration storage.
- `apps/web/src/App.tsx`, `apps/web/src/native-room-bridge.ts`, and `apps/web/src/native-station-bridge.ts` — shared bootstrap/assignment, ROOM presence handoff, and narrow generic station bridge; keep the mixed `native-bridge.ts` out of this work unit.
- `apps/server/src/domain/hotel-service.ts` and `apps/server/src/http/app.ts` — session, heartbeat, and bootstrap behavior; no server contract change planned.
