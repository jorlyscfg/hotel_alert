# Android ROOM boot-visible launch recovery

## Objective
Make the configured Hotel Alert ROOM station attempt to reopen its ROOM activity after Android finishes booting, keep background presence restoration, and report Android's actual resolved HOME launcher truthfully.

> **Supersession:** Hotel Alert's APK owns the ROOM display and in-app screensaver lifecycle. FreeKiosk comparisons in this task are historical evidence only; no separate app, configuration, API key, or integration is required.

## Problem and why
After a power interruption the device returned to the vendor app instead of Hotel Alert. Code inspection confirms `RoomPresenceRestoreReceiver` currently starts only `RoomPresenceService`; it never explicitly launches `MainActivity`. FreeKiosk separately attempts a delayed explicit launch from its boot receiver when Auto Launch is enabled, including its legacy path without Device Owner. A second, related issue is that native HOME status trusts the RoleManager role before checking the concrete HOME Activity resolved by Android, so it can report Hotel Alert even when the resolved launcher is Akubela.

## Scope
- Gate boot UI relaunch on a configured ROOM session and the existing supported boot/package-replacement actions.
- Keep the existing background presence service restoration intact.
- Add deterministic policy coverage and operator-facing documentation of OEM/background-start limits.
- Prefer a concrete resolved HOME package when reporting the active launcher; use RoleManager only when the resolver cannot identify one.
- Build and verify the APK. Update previously authorized test targets only if their already-authorized ADB endpoints are reachable; do not rediscover ports or alter HOME/Device Owner settings.

## Constraints and authorization
- Authorized by the user's standing development authorization and their established ROOM kiosk requirement.
- Android-only; no web changes, no new branch, no Device Owner enrollment, no changing HOME selection, and no remote reboot/power-cycle.
- Preserve all pre-existing dirty worktree and Git index changes. Do not stage unrelated files or claim a commit if a safe isolated work-unit commit cannot be made.
- Cold-boot launch is best-effort where Android/OEM background activity policy allows it; do not promise universal behavior across devices.

## TDD and verification configuration
- TDD: OFF, inherited from the current project/session Android implementation record (Engram observation #1462).
- Runner: `source /home/jorlys/.local/share/hotel-alert-env/android-toolchain.sh && ./gradlew :app:testDebugUnitTest :app:assembleDebug :app:lintDebug :app:check`.
- Receipt-driven review: disabled by clone-local configuration (`gentle-ai review mode status`).
- Git state is heavily dirty with staged deletions and untracked replacements; isolate all edits and preserve the shared index.

## Tasks
- [x] BOOT-01 (delegated): Add the guarded explicit boot activity launch path and pure policy tests, preserving service restoration and current worktree content.
- [x] BOOT-02 (delegated): Document the behavior/limitations, run focused and full Android checks, inspect the built APK, and install only to already-authorized endpoints that are reachable without discovery.
- [x] HOME-01 (delegated): Correct HOME status precedence and add regression coverage for a Hotel Alert role holder while Android resolves another package.
- [x] BOOT-03 (direct inline): Rerun full Gradle verification, inspect the rebuilt APK, and update already-authorized reachable devices; leave ROOM install/power-cycle pending if its authorized endpoint remains offline.

## Acceptance criteria
- A valid ROOM session on supported boot/package-replacement broadcasts triggers an explicit best-effort launch attempt for the ROOM UI as well as restoring heartbeat presence.
- No visible launch is attempted for non-ROOM/unconfigured installations or unsupported broadcasts.
- If Android resolves a concrete HOME app other than Hotel Alert, native maintenance must not report Hotel Alert as the default merely because RoleManager reports its role held.
- Android/OEM launch restrictions are accurately documented; tests do not claim physical boot success or depend on third-party kiosk behavior.
- Gradle checks and `git diff --check` results are recorded; device install/physical cold boot are marked pending if the authorized endpoint is unavailable.

## Route and evidence
- Route by task: BOOT-01 delegated direct; BOOT-02 delegated direct; HOME-01 delegated direct; BOOT-03 direct inline (verification/rollout only).
- Mapping/delegation trigger: understanding required manifest, boot receiver, presence service, HOME policy, FreeKiosk receiver/config, and Android startup restrictions (4+ files/sources).
- Writer trigger: implementation requires non-trivial changes across receiver, policy/tests, and documentation.
- Forecast: approximately 220 authored changed lines; ask-on-risk delivery strategy.

## Progress / evidence
- 2026-09-24: CodeGraph audit confirmed the app boot receiver starts only ROOM presence service; its screen-wake activity attempt is a separate runtime SCREEN_ON path. FreeKiosk's current source has a distinct delayed legacy activity launch path when auto-launch is enabled.
- 2026-09-24: BOOT-01 added a ROOM-session/action-gated activity launch after a 3-second delay while preserving immediate presence restoration. Focused `RoomKioskPolicyTest` passed; no ADB or device settings were touched.
- 2026-09-24: Updated `docs/android-room-kiosk.md` to distinguish service restoration from visible Activity launch and document Android 10+/OEM limits.
- 2026-09-24: Full Gradle runner passed (`BUILD SUCCESSFUL`, 78 tasks); `git diff --check` and APK archive verification passed. APK package is `com.hotelalert.notificationreceiver`, versionCode 1, versionName 0.1.0; SHA-256 `22c1b5f05bbb23bab0332661817854eecc0cac9da53422be06ea8093d5921e36`.
- 2026-09-24: Installed and verified the APK on the authorized tablet (`R9PT70GX3PA`; `pm path` succeeded, versionCode 1/targetSdk 35). The authorized ROOM endpoint `192.168.0.243:38655` remains unreachable (`device not found`), so its install and physical cold-boot check are pending. No port scan, settings change, or remote reboot performed.
- 2026-09-24: Follow-up code review found `resolveRoomHomeStatus` prioritized a held HOME role over a concrete resolved launcher package; previous ROOM ADB evidence showed those values disagreeing (Hotel Alert role, Akubela resolved). HOME-01 now reports a concrete resolved launcher first and uses RoleManager only when PackageManager returns no resolved package. Regression and fallback cases passed focused policy tests.
- 2026-09-24: After HOME-01, the full Gradle runner passed again (`BUILD SUCCESSFUL`, 78 tasks), `git diff --check` and scoped whitespace checks passed, and APK archive inspection succeeded. Final APK SHA-256 `3393db406cce0ad1dc7b564061339706c880842feb1224d7454dda863f07e70e`; package `com.hotelalert.notificationreceiver`, versionCode 1, versionName 0.1.0.
- 2026-09-24: Reinstalled and verified the final APK on tablet `R9PT70GX3PA` (`pm path` succeeded; versionCode 1/targetSdk 35). ROOM `192.168.0.243:38655` still returned `device not found`; it was not updated and no power-cycle test was possible.
- 2026-09-24: No commit was created because the shared worktree/index contains broad pre-existing staged deletions and untracked replacements; isolating a commit safely was not established. No unrelated files were staged.
- Next: user reconnects ROOM wireless ADB and shares its current authorized endpoint so the final APK can be installed there; then verify a physical power-cycle. Do not promise cross-OEM boot launch until validated.

## Relevant files
- `apps/android-notification-receiver/app/src/main/java/com/hotelalert/notificationreceiver/receiver/RoomPresenceRestoreReceiver.kt` — system boot/package-replacement restoration receiver.
- `apps/android-notification-receiver/app/src/main/java/com/hotelalert/notificationreceiver/receiver/RoomPresenceService.kt` — ROOM heartbeat and display-wake recovery.
- `apps/android-notification-receiver/app/src/main/java/com/hotelalert/notificationreceiver/RoomKioskPolicy.kt` — pure kiosk launch policy.
- `apps/android-notification-receiver/app/src/test/java/com/hotelalert/notificationreceiver/RoomKioskPolicyTest.kt` — deterministic policy tests.
- `docs/android-room-kiosk.md` — operator guide and platform limits.
