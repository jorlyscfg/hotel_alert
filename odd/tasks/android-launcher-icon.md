# ODD Task: Replace the Android app launcher icon

## Objective

Use the user's `logo-chico.png` artwork as the Android app launcher icon, with correct padding and background treatment so the design remains legible when Android masks the icon.

## Problem and Why

The installed APK still shows its previous custom vector icon. The user supplied the intended hotel logo and explicitly asked for it to replace the APK icon.

## Authorized Scope

- Replace only the Android app launcher icon resource(s) with artwork based on the supplied `logo-chico.png`.
- Build the updated Debug APK and install it on the previously authorized SM-T220 (`R9PT70GX3PA`) using `adb install -r`, preserving app data.
- Preserve the request notification icon/sound behavior, current server/device configuration, sessions, and all station assignments.
- Preserve all unrelated staged, unstaged, and untracked work. Do not push or open a PR.

## Constraints and Decisions

- Treat repository-root `logo-chico.png` as the user-owned source; do not edit or delete it.
- Keep the existing launcher resource identifier used by `android:icon`/`android:roundIcon`; minSdk is 26, so use an adaptive icon resource for all supported devices.
- Preserve the logo artwork and its proportions; add only transparent safe-area padding needed to prevent launcher-mask clipping.
- Keep the current launcher background color `#1D2A27` unless verification shows it makes the supplied blue/teal artwork unreadable.
- Do not change notification small icons or other UI assets.
- Effective TDD: off, following the latest project task configuration in `odd/tasks/room-localization-and-request-alerts.md`.
- Android runner: `source /home/jorlys/.local/share/hotel-alert-env/android-toolchain.sh && ./gradlew :app:testDebugUnitTest :app:assembleDebug :app:lintDebug :app:check` from `apps/android-notification-receiver`.
- Receipt-driven review: disabled/unmanaged per the latest project task record; do not start reviews.
- Implementation route: delegated direct. Writer trigger evidence: correctly preserving the user PNG while replacing the Android launcher drawable requires coordinated edits to an image resource and its XML wrapper.
- Forecast: under 100 authored text lines, generated raster excluded. Delivery strategy: `ask-on-risk`; no chain is forecast because this is a one-task, under-budget change on the existing feature branch.

## Tasks

### AICON-01 — Replace and package the Android launcher icon

- Use the supplied transparent logo as the foreground artwork for an adaptive launcher icon, with safe-area padding and a compatible resource fallback only if required.
- Keep manifest resource references stable where possible; do not alter notification UI, receiver behavior, or unrelated resources.
- Route: delegated direct writer. File ownership: launcher-only resource XML, any launcher background color token, and the new derived icon bitmap. The task document and source `logo-chico.png` remain parent-owned/read-only for the writer.
- Checks: inspect the generated resource and its transparent margins; `:app:testDebugUnitTest`, `:app:assembleDebug`, `:app:lintDebug`, `:app:check`; inspect the packaged APK icon resource; install with `adb install -r` without clearing data; `git diff --check`.
- Progress: ✅ Implemented, built, and installed on the authorized SM-T220.

## Acceptance Criteria

- Android launcher and round launcher icon display the supplied hotel logo instead of the previous vector artwork.
- Logo colors and proportions are preserved, and launcher masking does not cut off the bed, bell, or decorative arcs.
- Updated Debug APK builds, contains the new launcher asset, and is installed on SM-T220 without clearing app data or changing station assignments.
- Existing request-notification icons, sounds, and speaker-only routing remain unchanged.

## Verification Evidence

- CodeGraph and targeted resource inspection found `AndroidManifest.xml` points `android:icon` and `android:roundIcon` to `@drawable/ic_hotel_alert_launcher`; minSdk 26 supports the adaptive resource. The supplied source is a 251×251 RGBA PNG.
- `drawable-v26/ic_hotel_alert_launcher.xml` packages an adaptive icon; its foreground uses the exact supplied bitmap through a 10dp inset, and its background remains `#1D2A27`.
- `cmp` and SHA-256 confirmed the packaged artwork source is byte-for-byte identical to repository-root `logo-chico.png` (`b145632077ea66c1e58588d8c4797ca0a28682d6e7e29cab5a7cd516970a3d38`). The source logo was not modified.
- `source /home/jorlys/.local/share/hotel-alert-env/android-toolchain.sh && ./gradlew :app:testDebugUnitTest :app:assembleDebug :app:lintDebug :app:check` completed with `BUILD SUCCESSFUL` (78 actionable tasks; 33 executed, 45 up-to-date).
- `aapt dump badging` on `app/build/outputs/apk/debug/app-debug.apk` resolves all launcher densities and the manifest icon to `res/drawable-v26/ic_hotel_alert_launcher.xml`; `unzip -l` confirms both the adaptive XML and logo artwork are packaged.
- `adb -s R9PT70GX3PA install -r app/build/outputs/apk/debug/app-debug.apk` returned `Success`; `-r` upgraded the APK without clearing app data. No station assignments were changed. The installed launcher appearance was not independently captured from the tablet UI.
- Scoped `git diff --check` passed for the icon resources and task document.
- Work-unit commit: pending.

## Next Step

Record the work-unit commit identity in this document. Do not register, assign, or otherwise change devices.
