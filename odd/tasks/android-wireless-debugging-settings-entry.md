# ROOM wireless debugging settings shortcut

## Objective
Add a native ROOM-maintenance shortcut that opens Android's Developer Options so an operator can quickly re-enable Wireless debugging after a power cycle.

## Problem and why
The ROOM device disables wireless debugging and changes its ADB port after losing power. The user wants a direct in-app route back to the relevant Android settings. A regular application can open Developer Options but cannot silently turn on Wireless debugging; Android requires the operator to enable it and approve the current ADB connection/port.

## Scope
- Add a distinct button to the native ROOM maintenance screen to open Developer Options, with a fallback to general Android Settings if the specific settings Activity is unavailable.
- Use Spanish UI copy that tells operators to enable Wireless debugging and read the current port shown by Android.
- Build/verify the APK and install it on previously authorized test devices whose exact authorized ADB endpoints are reachable.

## Constraints and authorization
- Authorized by the user's standing development authorization and current request.
- Android-only. Do not attempt to change Wireless debugging programmatically, pair/authorize ADB, change HOME, enroll Device Owner, or reboot/power-cycle the ROOM device.
- Only use the exact ROOM ADB endpoint provided by the user: `192.168.0.243:39007`; no discovery or port scans.
- Preserve pre-existing staged/unstaged work and the shared Git index. Do not stage unrelated files. A safe isolated commit may be impossible while the shared worktree/index is broadly dirty; report that honestly.
- Android Settings/OEM layouts vary; the shortcut opens Developer Options, not a guaranteed Wireless debugging subpage.

## TDD and verification configuration
- TDD: OFF, inherited from the active Android project/session task configuration (`odd/tasks/android-room-boot-visible-launch.md`).
- Runner: `source /home/jorlys/.local/share/hotel-alert-env/android-toolchain.sh && ./gradlew :app:testDebugUnitTest :app:assembleDebug :app:lintDebug :app:check`.
- Receipt-driven review: disabled by clone-local configuration (`gentle-ai review mode status`).
- CodeGraph was used before source exploration; its index reports pending worktree changes. Preserve the current shared state.
- Forecast: approximately 60 authored changed lines; delivery strategy `ask-on-risk`.

## Tasks
- [x] WDBG-01 (delegated direct): Added the truthful Developer Options shortcut and Activity wiring; full Android checks passed; installed the debug APK to both exact authorized devices. Physical button-tap verification remains for the operator.

## Acceptance criteria
- The maintenance screen presents a clear Spanish action to configure Wireless debugging.
- Tapping it opens Android Developer Options, falling back safely to general Settings when necessary.
- UI text accurately explains that the operator must toggle Wireless debugging manually and use the current ADB port shown by Android.
- Android tests/build/lint/check and scoped whitespace checks pass; install outcome is recorded per authorized device.
- No HOME/Device Owner/wireless-debugging state change or reboot is performed by the assistant.

## Route and evidence
- Route: delegated direct. Writer trigger: the behavior requires non-trivial edits to both `RoomMaintenanceScreens.kt` and `MainActivity.kt`.
- Mapping: CodeGraph explored `RoomMaintenanceSettingsScreen` and `openAndroidSettings`; no additional 4+ file architecture mapping was needed.
- Current user-provided ROOM endpoint connected successfully as `192.168.0.243:39007`; device reports Android 12, model `rk3566_s`.
- Android's public `Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS` opens Developer Options. A regular app cannot write the protected wireless-debugging setting; Android `WRITE_SECURE_SETTINGS` is signature/privileged. Sources: https://developer.android.com/reference/android/provider/Settings and https://developer.android.com/reference/android/Manifest.permission#WRITE_SECURE_SETTINGS.

## Progress / evidence
- 2026-09-24: Confirmed ADB connectivity only at the user-provided endpoint `192.168.0.243:39007`; no settings or device state were changed.
- 2026-09-24: Added the native “Depuración inalámbrica” section and “Configurar depuración inalámbrica” button. It opens `Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS` after the existing maintenance/strict-lock safety checks, falling back to general Android Settings with Spanish feedback. The explanatory text states that Wireless debugging must be toggled manually and that Android may change the port after restart.
- 2026-09-24: The prescribed Android runner passed (`BUILD SUCCESSFUL`, 78 tasks; 21 executed, 57 up-to-date). Scoped `git diff --check` for `MainActivity.kt` and trailing-whitespace scan of the untracked UI file passed.
- 2026-09-24: Built debug APK at `apps/android-notification-receiver/app/build/outputs/apk/debug/app-debug.apk`; SHA-256 `f1cc1213a67c08a9b6ad6161d8c93a5dee2d3286a366947f20cdd3de2c86d96a`. Installed successfully with `adb install -r` on ROOM `192.168.0.243:39007` and tablet `R9PT70GX3PA`; both report package `com.hotelalert.notificationreceiver`, versionCode 1, versionName 0.1.0, targetSdk 35, and a valid `pm path`.
- 2026-09-24: Read-only package-manager resolution on the ROOM Android 12 device confirmed the Developer Options intent resolves to `com.android.settings/.Settings$DevelopmentSettingsDashboardActivity`.
- 2026-09-24: Did not open/tap the maintenance UI on the physical device, change Wireless debugging, pair ADB, alter HOME/Device Owner, or reboot. Physical confirmation of the button round-trip remains pending.
- 2026-09-24: No commit was created. The shared worktree/index contains extensive pre-existing staged deletions and mixed edits; isolating these file changes into a safe work-unit commit would risk including or altering unrelated work. No files were staged.

## Next step
Operator can enter native maintenance, tap “Configurar depuración inalámbrica,” enable Wireless debugging manually, and use the current port displayed by Android. A future isolated commit and physical UI round-trip verification remain pending; do not change device settings or reboot remotely.
