# Android ROOM HOME selection recovery

## Objective

Make it clear whether Android has actually selected Hotel Alert as the HOME app, and let an operator safely resume or directly open Android's HOME-app selection settings when that selection is inconsistent, so cold-boot behavior is diagnosable rather than assumed.

## Problem and why

The ROOM boot receiver restores the native presence service but does not launch the visible Activity. The visible ROOM screen after a reboot depends on Android resolving Hotel Alert as HOME. The current automatic role prompt records that it was attempted immediately after launching Android's chooser; a canceled/denied prompt is not retried automatically. A recent read-only diagnosis found the ROOM's HOME role holder and the HOME intent resolver disagree, so operators need a direct path to Android's Home selection settings in addition to the role-request chooser.

## Scope and constraints

- Preserve Android's HOME-role consent flow on API 29+, add the public `Settings.ACTION_HOME_SETTINGS` route to Android's Home selection screen with a safe fallback if the OEM has no handler, and preserve the Device Owner persistent-HOME path.
- Re-read actual Android HOME role/resolution after the operator returns from the chooser; never treat opening the chooser as proof that Hotel Alert became default.
- Keep declined/canceled automatic prompting from looping, while retaining a clear explicit operator-initiated retry in native maintenance.
- Keep visible native feedback in Spanish and make an unsuccessful selection/retry understandable.
- Do not launch `MainActivity` directly from `BOOT_COMPLETED`; do not change the ROOM heartbeat service, role enrollment, Device Owner policy, AREA/Admin, or screen-wake behavior.
- Update operator guidance to distinguish a running/restored presence service from the Android HOME app actually opening after a cold boot.
- Preserve unrelated staged, unstaged, and untracked work and the shared Git index. No push or PR.
- The user wants every APK improvement rolled out to both authorized test devices as the final APK step unless explicitly opted out.

## Authorized scope

The user approved implementing a separate native button that opens Android's HOME selection settings, so they can change the selected launcher themselves. Destinations for the standing final APK rollout are ROOM device `192.168.0.243` and operator tablet `192.168.0.214`, using the previously approved ADB wireless/USB connections. This task may open the system page but must not select a launcher, alter HOME state automatically, provision Device Owner, or power-cycle the ROOM; cold-boot physical behavior remains a manual device check.

## Tasks

### ROOM-HOME-01 — Make HOME confirmation truthful and retryable

- [x] Inspect the Activity Result flow, maintenance HOME status/actions, pure HOME policy, existing tests, and kiosk operator guide; preserve existing platform fallbacks.
- [x] Ensure chooser return refreshes and displays Android's actual HOME state; distinguish a granted role from a dismissed/denied chooser.
- [x] Keep the automatic first prompt from repeating on every resume, but provide a reliable explicit retry from native maintenance when Hotel Alert is not the actual default.
- [x] Add focused policy/behavior tests and update the operator guide with the cold-boot/HOME distinction and retry steps.
- [x] Run focused tests, prescribed Android verification, and whitespace checks.
- [x] Commit only this task's source/test/doc hunks with an isolated Git index.

### ROOM-HOME-02 — Roll out the verified APK

- [x] Install the verified debug APK on ROOM device `192.168.0.243` using the user-provided ADB connection port `38655`.
- [x] Install the verified debug APK on operator tablet `192.168.0.214` using its previously approved USB ADB connection.
- [x] Record exact device/ADB outcomes; do not change Android HOME selection or power-cycle settings.

### ROOM-HOME-03 — Open Android's HOME selection settings directly

- [x] Add a distinct Spanish maintenance action that opens Android's Home selection settings (`Settings.ACTION_HOME_SETTINGS`) rather than the generic Settings home or only the RoleManager consent chooser.
- [x] Preserve user control: do not programmatically select/clear a preferred launcher or request Device Owner; fall back to the existing consent-based chooser with understandable feedback if the system settings action cannot be opened.
- [x] Re-read and display the actual HOME status after returning from Android settings; confirmed the existing `onResume`/maintenance refresh path performs this check.
- [x] Run the Android unit-test/build/lint/check suite and `git diff --check`.
- [x] Commit only the scoped source and tracker changes.

### ROOM-HOME-04 — Roll out the direct HOME settings APK

- [x] Install the verified APK on ROOM device `192.168.0.243` using the authorized ADB transport `192.168.0.243:38655`.
- [x] Install the same verified APK on operator tablet `192.168.0.214` via its previously approved ADB device `R9PT70GX3PA`.
- [x] Record exact installation and package verification outcomes; do not change HOME selection or power-cycle either device.

## Acceptance criteria

- The app reports Hotel Alert as HOME only when Android's current role/resolver state confirms it.
- A dismissed/denied automatic chooser is not reported as success and does not cause repeated prompt loops.
- An operator can explicitly reopen HOME selection from native maintenance and see the refreshed actual status after returning.
- A separate maintenance action opens Android's specific HOME selection settings screen; when unsupported, it falls back to the existing user-consented HOME chooser without claiming a selection succeeded.
- ROOM presence restoration continues without direct Activity launch from the boot receiver; AREA/Admin and screen-wake behavior remain unchanged.
- Focused tests and Android test/assemble/lint/check pass; `git diff --check` passes.
- The resulting debug APK is installed on both authorized test devices unless the user explicitly opts out. A physical cold-boot power-cycle test is not claimed unless actually performed.

## Applicable checks

- TDD: OFF, inherited from `odd/tasks/android-room-kiosk-presence.md`.
- Runner: `cd apps/android-notification-receiver && source /home/jorlys/.local/share/hotel-alert-env/android-toolchain.sh && ./gradlew :app:testDebugUnitTest :app:assembleDebug :app:lintDebug :app:check`.
- Focused HOME policy tests and `git diff --check`.
- RDD: disabled by clone-local configuration (`gentle-ai review mode status`); delivery is disabled/unmanaged.
- Do not run adb reboot, change role/default settings, provision Device Owner, or claim physical cold-boot validation.

## Route and trigger evidence

- Route: delegated direct.
- Mapping trigger: HOME boot behavior spans at least four Android files. CodeGraph mapped the flow, and `/root/room_reboot_path_audit` completed the delegated read-only audit before implementation.
- Writer trigger: the correction crosses MainActivity/role handling, native maintenance display, policy tests, and operator documentation; one bounded writer will own those files.
- Forecast: approximately 120–220 authored changed lines, excluding generated files.
- ROOM-HOME-03 writer trigger: the direct system-settings launch belongs in `MainActivity.kt`, while the separate native button belongs in `RoomMaintenanceScreens.kt`; these are two non-trivial files, so one bounded writer owns both. Expected scope is under 100 authored lines; tracker files remain parent-owned.
- ROOM-HOME-03 preparation: CodeGraph mapped the maintenance screen/Activity callback and Android's official `Settings.ACTION_HOME_SETTINGS` contract was checked before the writer begins.
- Delivery strategy: `stacked-to-main`, inherited from the existing Android ROOM feature; continue on `jorlys/feat/lan-notification-agent` without creating a branch.

## Progress and verification evidence

- Discovery: `RoomPresenceRestoreReceiver` restores only `RoomPresenceService`; Android HOME resolution is what returns the visible Activity after boot. Role selection remains consent-based without Device Owner. Android background Activity launch restrictions make boot-receiver Activity launch an unsafe generic workaround.
- ADB state at task start: known ROOM serial `192.168.0.243:40975` was not connected; no device state or HOME role was inspected. That old serial continued to return `device not found`. After the user provided port `38655`, connecting only to `192.168.0.243:38655` succeeded; `get-state` returned `device`.
- Implementation: `homeRoleRequestLauncher` now ignores the chooser result code and asynchronously re-reads actual HOME role/resolver state; Spanish feedback reports confirmed, not confirmed, or unknown. The automatic one-shot marker is saved before opening the chooser to avoid retry loops, while native maintenance retains an explicit retry button whose label now says it can be chosen again. The boot receiver was not changed.
- Checks: parent ran `:app:testDebugUnitTest`, `:app:assembleDebug`, `:app:lintDebug`, and `:app:check` successfully (78 tasks: 17 executed, 61 up-to-date); `git diff --check` and a scoped trailing-whitespace scan passed. Worker also reported both focused HOME policy test classes passed. APK SHA-256: `4ec8d8a1984b322833055d41d83b7e008910a587d37341650e21cf07ed885`.
- Work-unit commit: `17b1cab` (`fix(android): report actual room home selection`), 159 authored lines; only the scoped Android flow/policy, focused test, operator guide, and this tracker were included. The shared Git index hash remained unchanged.
- Device rollout: the operator tablet connected as `R9PT70GX3PA` accepted the verified debug APK (`adb install -r`: `Success`); `pm path` confirms the installed package and `dumpsys package` reports `versionCode=1`, `targetSdk=35`. The ROOM device connected at user-provided transport `192.168.0.243:38655` also accepted the APK (`adb install -r`: `Success`); `pm path` confirms the installed package and `dumpsys package` reports `versionCode=1`, `targetSdk=35`. APK SHA-256 matched the verified build on both installs: `4ec8d8a1984b322833055d41d83b7e008910a587d37341650e21cf07ed885`.
- Next step: physically validate ROOM's HOME selection and cold-boot behavior separately. Both-device APK rollout is complete; no HOME setting was changed and no cold boot was performed.
- Follow-up diagnosis: `dumpsys role` reports `com.hotelalert.notificationreceiver` as the ROOM's `android.app.role.HOME` holder, while `cmd package resolve-activity` still resolves the HOME intent to `com.akubela.panel/.activity.init.InitActivity` with `isDefault=true`. This task adds a direct settings entry point for the operator to correct/inspect that mismatch; the system setting itself remains user-controlled.
- ROOM-HOME-03 implementation: added the separate “Cambiar aplicación de inicio en Android” action and wired it to `Settings.ACTION_HOME_SETTINGS`; if Android cannot open that system page, the app offers its existing consent-based RoleManager flow and a safe general-Settings fallback. No HOME preference is set or cleared by Hotel Alert.
- ROOM-HOME-03 verification: `:app:testDebugUnitTest :app:assembleDebug :app:lintDebug :app:check` passed (BUILD SUCCESSFUL; 78 actionable tasks, 21 executed, 57 up-to-date). `git diff --check` passed. The shared Git index remains unchanged at tree `de340c670a8e120c7db6f10dd48656f96f712286`.
- ROOM-HOME-03 work-unit commit: `251317e` (`feat(android): open Home selection settings`), 56 insertions and 8 deletions across the two native files and this task tracker. The commit was created from an isolated index; the shared Git index remains unchanged.
- ROOM-HOME-04 rollout: built APK SHA-256 `3d8b1621b508ffebc0fee73fb8a0ad5173486a443334e40b95f1158d91f74d3d` installed successfully (`adb install -r`: `Success`) on ROOM `192.168.0.243:38655` and tablet `R9PT70GX3PA`. Both `pm path` queries returned the installed package and both report `versionCode=1`, `minSdk=26`, `targetSdk=35`. No HOME setting was changed and no device was rebooted.
- ROOM-HOME-04 system-action check: read-only `cmd package resolve-activity --brief -a android.settings.HOME_SETTINGS` returned `com.android.permissioncontroller/.role.ui.HomeSettingsActivity` on ROOM and `com.google.android.permissioncontroller/com.android.permissioncontroller.role.ui.HomeSettingsActivity` on the tablet. The system page was not launched and no setting was changed.
- ROOM-HOME-04 work-unit commit: `6d68ff8` (`docs(android): record Home settings rollout`), recording both verified installs; the shared Git index remained unchanged.

## Relevant files

- `apps/android-notification-receiver/app/src/main/AndroidManifest.xml` — HOME intent filter and boot receiver declarations.
- `apps/android-notification-receiver/app/src/main/java/com/hotelalert/notificationreceiver/MainActivity.kt` — role chooser and native maintenance status/actions.
- `apps/android-notification-receiver/app/src/main/java/com/hotelalert/notificationreceiver/RoomHomeLauncherPolicy.kt` — pure HOME status/request policy.
- `apps/android-notification-receiver/app/src/main/java/com/hotelalert/notificationreceiver/admin/AndroidRoomHomePolicy.kt` — actual Android role/resolver status and Device Owner path.
- `apps/android-notification-receiver/app/src/main/java/com/hotelalert/notificationreceiver/ui/RoomMaintenanceScreens.kt` — operator-facing HOME state/action copy.
- `apps/android-notification-receiver/app/src/test/java/com/hotelalert/notificationreceiver/RoomHomeLauncherPolicyTest.kt` — focused HOME policy tests.
- `apps/android-notification-receiver/app/src/main/java/com/hotelalert/notificationreceiver/receiver/RoomPresenceRestoreReceiver.kt` — service-only restoration after boot/package replacement.
- `docs/android-room-kiosk.md` — operator HOME, maintenance, and boot guidance.
