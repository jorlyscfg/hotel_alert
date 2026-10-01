# ODD Task: Android ROOM App-Window Brightness Control

## Objective

Add a native maintenance-screen control for the brightness used while Hotel Alert is open on a ROOM device.

## Problem and Why

Android adaptive brightness can leave the ROOM panel too dim to read. Operators need to set an app-specific brightness without changing the device-wide brightness policy.

## Authorized Scope

- Change the native Android Activity window brightness and its maintenance-screen controls.
- Persist the operator's choice for Hotel Alert on that device.
- Build the Debug APK and, under prior explicit authorization, install with `adb install -r` only on AREA `R9PT70GX3PA`, ROOM `192.168.0.243:44999`, and ROOM `192.168.0.121:36259`.
- Preserve all unrelated staged, unstaged, and untracked work; do not modify station assignments, server state, or other devices.
- No push, PR, or merge.

## Constraints and Decisions

- The user selected the recommended unset behavior: keep Android's automatic/preferred brightness until manual mode is enabled and configured.
- Manual brightness applies only to Hotel Alert's native Activity window while the app is foreground; it must not modify global system brightness or request `WRITE_SETTINGS`.
- Provide a way to restore Android automatic brightness. Bound the manual slider above zero so the app cannot intentionally blank its own display.
- Preview draft changes in maintenance; save on the existing Save/Return action and restore the persisted value if maintenance is dismissed without saving.
- Effective TDD: OFF, inherited from `odd/tasks/android-room-kiosk-presence.md`.
- Android runner (from `apps/android-notification-receiver`): `source /home/jorlys/.local/share/hotel-alert-env/android-toolchain.sh && ./gradlew :app:testDebugUnitTest :app:assembleDebug :app:lintDebug :app:check`.
- Receipt-driven review: disabled/unmanaged in the active Android task configuration; do not start reviews.
- Existing branch: `jorlys/feat/lan-notification-agent`. Preserve the shared dirty worktree and do not stage unrelated paths.
- Implementation route: delegated direct. Mapping trigger evidence: understanding crossed the Activity/window lifecycle, maintenance Compose UI, SharedPreferences persistence, and Android policy tests (4+ relevant files); delegated CodeGraph-first mapping completed in `brightness_map`. Writer trigger evidence: Activity lifecycle/persistence and the Compose control/tests require changes to multiple non-trivial files.
- Forecast: approximately 180 authored changed lines, generated APK excluded. Delivery strategy: `ask-on-risk`; this is forecast below the ~400-line delivery budget.

## Tasks

### BRIGHT-01 — Configure and persist app-window brightness

- [x] Add an automatic/manual choice and bounded percentage slider to the native ROOM maintenance screen; retain adaptive brightness until the operator opts into a level.
- [x] Apply the manual override to the Hotel Alert Activity window while foreground, including lifecycle/focus restoration; restore the platform default in automatic mode.
- [x] Persist on Save/Return, preview while configuring, and discard/revert an unsaved draft when maintenance closes.
- [x] Add focused JUnit4 policy tests for automatic default and manual level bounds; run the Android runner above.
- [x] Build the Debug APK and run the Android runner successfully. Direct `adb install -r` returned `Success` for `R9PT70GX3PA` and `192.168.0.243:44999`. The authorized `192.168.0.121:36259` target returned `adb: device '192.168.0.121:36259' not found`; no reconnect or device discovery was attempted.
- [x] Create an isolated work-unit commit on the existing feature branch and record its identity here if Git metadata permits; preserve unrelated staged content. Commit: `831b91ccf40e70174226d44da1f04a2991b091f6` (`feat(android): add ROOM app brightness control`).

## Acceptance Criteria

1. Maintenance offers an explicit automatic-brightness mode and a manual app-window level control.
2. A fresh install or unset preference follows Android's preferred/adaptive brightness; no global settings permission or mutation is introduced.
3. A saved manual level is applied while Hotel Alert is foreground and restored after Activity focus/resume; automatic mode clears the override.
4. Draft slider changes preview in maintenance and are persisted only on Save/Return; dismissing without save restores the prior setting.
5. JUnit4 tests, assemble, lint, and Android check pass; the packaged Debug APK installs on authorized reachable targets without clearing app data.

## Progress and Evidence

- [x] CodeGraph-first read-only mapping completed; confirmed `updateRoomWindowMode()` currently manages immersive system bars only, maintenance persists strict-kiosk mode, and there is no Compose UI-test dependency.
- [x] Default behavior decision resolved by user: preserve adaptive brightness until a manual level is configured.
- [x] BRIGHT-01 implementation, verification, and packaging completed. The full runner passed (78 Gradle tasks; 19 executed), including unit tests, Debug assembly, lint, and check. APK: `apps/android-notification-receiver/app/build/outputs/apk/debug/app-debug.apk`, SHA-256 `d08f9c9279a4fd52575e42298bbdf9093ea0c928916f52ce45e5240900bb9c8d`.
- [x] Installed with `adb install -r` on `R9PT70GX3PA` and `192.168.0.243:44999` (both returned `Success`). Installation to `192.168.0.121:36259` remains pending because that exact authorized ADB target was not connected.
- [x] Isolated work-unit commit created as `831b91ccf40e70174226d44da1f04a2991b091f6` (`feat(android): add ROOM app brightness control`). It contains only brightness implementation/tests and this feature tracker; unrelated staged and unstaged changes were excluded.

## Next Step

The `.121` installation can be retried only after its previously authorized ADB session is available; do not reconnect or discover devices in this task.

## Relevant Files

- `apps/android-notification-receiver/app/src/main/java/com/hotelalert/notificationreceiver/MainActivity.kt` — Activity lifecycle, window attributes, and current SharedPreferences persistence.
- `apps/android-notification-receiver/app/src/main/java/com/hotelalert/notificationreceiver/ui/RoomMaintenanceScreens.kt` — native Compose maintenance settings screen.
- `apps/android-notification-receiver/app/src/main/java/com/hotelalert/notificationreceiver/RoomKioskPolicy.kt` and `app/src/test/.../RoomKioskPolicyTest.kt` — existing pure-policy/JUnit4 testing pattern.
- `odd/tasks/android-room-kiosk-presence.md` — active Android TDD mode, runner, and delivery constraints.
