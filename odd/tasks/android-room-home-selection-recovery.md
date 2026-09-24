# Android ROOM HOME selection recovery

## Objective

Make it clear whether Android has actually selected Hotel Alert as the HOME app, and let an operator safely resume HOME selection when Android did not grant it, so cold-boot behavior is diagnosable rather than assumed.

## Problem and why

The ROOM boot receiver restores the native presence service but does not launch the visible Activity. The visible ROOM screen after a reboot depends on Android resolving Hotel Alert as HOME. The current automatic role prompt records that it was attempted immediately after launching Android's chooser; a canceled/denied prompt is not retried automatically. The current device's HOME role is not yet verified because its authorized ADB serial was offline during diagnosis.

## Scope and constraints

- Preserve Android's HOME-role consent flow on API 29+, the legacy HOME Settings fallback, and the Device Owner persistent-HOME path.
- Re-read actual Android HOME role/resolution after the operator returns from the chooser; never treat opening the chooser as proof that Hotel Alert became default.
- Keep declined/canceled automatic prompting from looping, while retaining a clear explicit operator-initiated retry in native maintenance.
- Keep visible native feedback in Spanish and make an unsuccessful selection/retry understandable.
- Do not launch `MainActivity` directly from `BOOT_COMPLETED`; do not change the ROOM heartbeat service, role enrollment, Device Owner policy, AREA/Admin, or screen-wake behavior.
- Update operator guidance to distinguish a running/restored presence service from the Android HOME app actually opening after a cold boot.
- Preserve unrelated staged, unstaged, and untracked work and the shared Git index. No push or PR.
- The user wants every APK improvement rolled out to both authorized test devices as the final APK step unless explicitly opted out.

## Authorized scope

The user approved implementing the root correction to HOME confirmation/retry and testing the APK on the two authorized test devices. Destinations are ROOM device `192.168.0.243` and operator tablet `192.168.0.214`, using the previously approved ADB wireless/USB connections. No power-cycle, system-settings, HOME-role, or device-owner mutation is authorized by this task; cold-boot physical behavior remains a manual device check.

## Tasks

### ROOM-HOME-01 — Make HOME confirmation truthful and retryable

- [x] Inspect the Activity Result flow, maintenance HOME status/actions, pure HOME policy, existing tests, and kiosk operator guide; preserve existing platform fallbacks.
- [x] Ensure chooser return refreshes and displays Android's actual HOME state; distinguish a granted role from a dismissed/denied chooser.
- [x] Keep the automatic first prompt from repeating on every resume, but provide a reliable explicit retry from native maintenance when Hotel Alert is not the actual default.
- [x] Add focused policy/behavior tests and update the operator guide with the cold-boot/HOME distinction and retry steps.
- [x] Run focused tests, prescribed Android verification, and whitespace checks.
- [ ] Commit only this task's source/test/doc hunks with an isolated Git index.

### ROOM-HOME-02 — Roll out the verified APK

- [ ] Install the verified debug APK on ROOM device `192.168.0.243` and operator tablet `192.168.0.214` using the previously approved ADB connections.
- [ ] Record exact device/ADB outcomes; do not change Android HOME selection or power-cycle settings.

## Acceptance criteria

- The app reports Hotel Alert as HOME only when Android's current role/resolver state confirms it.
- A dismissed/denied automatic chooser is not reported as success and does not cause repeated prompt loops.
- An operator can explicitly reopen HOME selection from native maintenance and see the refreshed actual status after returning.
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
- Delivery strategy: `stacked-to-main`, inherited from the existing Android ROOM feature; continue on `jorlys/feat/lan-notification-agent` without creating a branch.

## Progress and verification evidence

- Discovery: `RoomPresenceRestoreReceiver` restores only `RoomPresenceService`; Android HOME resolution is what returns the visible Activity after boot. Role selection remains consent-based without Device Owner. Android background Activity launch restrictions make boot-receiver Activity launch an unsafe generic workaround.
- ADB state at task start: known ROOM serial `192.168.0.243:40975` was not connected; no device state or HOME role was inspected.
- Implementation: `homeRoleRequestLauncher` now ignores the chooser result code and asynchronously re-reads actual HOME role/resolver state; Spanish feedback reports confirmed, not confirmed, or unknown. The automatic one-shot marker is saved before opening the chooser to avoid retry loops, while native maintenance retains an explicit retry button whose label now says it can be chosen again. The boot receiver was not changed.
- Checks: parent ran `:app:testDebugUnitTest`, `:app:assembleDebug`, `:app:lintDebug`, and `:app:check` successfully (78 tasks: 17 executed, 61 up-to-date); `git diff --check` and a scoped trailing-whitespace scan passed. Worker also reported both focused HOME policy test classes passed. APK SHA-256: `4ec8d8a1984b322833055d41d83b7e008910a587d37341650e21cf07ed885`.
- Work-unit commit: pending.
- Device rollout: pending; do this only after code verification as the final APK rollout step.
- Next step: complete ROOM-HOME-01, then ROOM-HOME-02.

## Relevant files

- `apps/android-notification-receiver/app/src/main/AndroidManifest.xml` — HOME intent filter and boot receiver declarations.
- `apps/android-notification-receiver/app/src/main/java/com/hotelalert/notificationreceiver/MainActivity.kt` — role chooser and native maintenance status/actions.
- `apps/android-notification-receiver/app/src/main/java/com/hotelalert/notificationreceiver/RoomHomeLauncherPolicy.kt` — pure HOME status/request policy.
- `apps/android-notification-receiver/app/src/main/java/com/hotelalert/notificationreceiver/admin/AndroidRoomHomePolicy.kt` — actual Android role/resolver status and Device Owner path.
- `apps/android-notification-receiver/app/src/main/java/com/hotelalert/notificationreceiver/ui/RoomMaintenanceScreens.kt` — operator-facing HOME state/action copy.
- `apps/android-notification-receiver/app/src/test/java/com/hotelalert/notificationreceiver/RoomHomeLauncherPolicyTest.kt` — focused HOME policy tests.
- `apps/android-notification-receiver/app/src/main/java/com/hotelalert/notificationreceiver/receiver/RoomPresenceRestoreReceiver.kt` — service-only restoration after boot/package replacement.
- `docs/android-room-kiosk.md` — operator HOME, maintenance, and boot guidance.
