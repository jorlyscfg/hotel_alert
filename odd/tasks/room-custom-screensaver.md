# ODD Task: Hotel Alert ROOM Custom Screensaver

## Objective

Show Hotel Alert's own ROOM screensaver with the current time/date and configured ROOM background, after the existing Información module completes.

## Problem and Why

The Akubela panel currently takes over with its own saver. The user clarified that the existing Información carousel is a separate idle module, not the screensaver; the intended order is ROOM UI → Información module → Hotel Alert screensaver. The .121 panel's public Android sensor service exposes only its accelerometer, so temperature/humidity are not available to this app through a supported current data path.

## Authorized Scope

- Implement the saver in the ROOM web experience hosted by the Android APK, reusing the existing inactivity/module lifecycle, ROOM background setting, and clock/localization patterns.
- Keep the saver visible until user interaction returns to the ROOM UI and restarts the idle flow.
- Do not display fabricated temperature/humidity values; omit those readings until a supported source is available.
- Add focused automated tests and build/type checks. Do not deploy the web app, build/install an APK, or run additional device commands as part of this feature without separate authorization.
- Preserve all unrelated staged, unstaged, and untracked work on `jorlys/feat/lan-notification-agent`; isolate any later commit to this task's files/hunks. Do not push, open a PR, or merge.

## Constraints and Decisions

- The custom saver is a distinct phase after the Información module; do not rename or conflate the module with the saver.
- The saver is ROOM-only. AREA, setup, maintenance, and diagnostics behavior must remain unchanged.
- Use the saved `roomBackground` configuration and existing clock format/locale; keep content legible over image backgrounds.
- .121 verification was read-only: Android 12/SDK 32, `dumpsys sensorservice` reports one AOSP accelerometer, and filtered service lists show no Akubela/environmental sensor service. No device settings or files were changed.
- Effective TDD: OFF, inherited from the active Android task configuration recorded in `odd/tasks/android-room-screen-brightness.md` / `odd/tasks/android-room-kiosk-presence.md`; use ordinary functional checks.
- Focused runner: `corepack pnpm exec vitest run tests/unit/information-carousel.test.ts tests/unit/device-screen.test.ts`.
- Additional checks: `corepack pnpm typecheck`, `corepack pnpm --filter @hotel/web build`, and `git diff --check`.
- Existing branch: `jorlys/feat/lan-notification-agent`; extensive staged and unstaged unrelated changes are present. Preserve the shared index and all unrelated changes.
- Implementation route: delegated direct. Mapping trigger evidence: understanding crossed the Activity/WebView lifecycle, DeviceScreen background/clock, InformationCarousel state machine, native bridge, sensor inventory, and tests (4+ files); `/root/screensaver_mapping` completed read-only CodeGraph-first mapping. Writer trigger evidence: lifecycle, ROOM screen composition/styles/localization, and tests are multiple non-trivial files.
- Forecast: approximately 250 authored changed lines (generated output excluded), under the ~400-line slice budget. Delivery strategy: `ask-on-risk`.
- Receipt-driven review: disabled/unmanaged according to the active Android task record; re-check status before any commit, and do not start reviews if disabled.

## Tasks

### ROOM-SAVER-01 — Add the post-Información ROOM screensaver

- [x] Extend the existing idle lifecycle so the custom Hotel Alert saver starts only after the Información module completes; keep it active until interaction cancels it and returns the ROOM UI.
- [x] Render localized time/date over the saved ROOM background with a readable contrast treatment; keep it restricted to ROOM mode.
- [x] Keep unavailable temperature/humidity out of the UI until a supported device data source exists.
- [x] Add/update focused lifecycle and DeviceScreen tests, then run the focused Vitest suite, web typecheck/build, and `git diff --check`.
- Route: delegated direct writer after this tracker/mirror. Preserve prior dirty edits in overlapping web files.
- Commit evidence: `b866aba` — `feat(web): add post-information ROOM screensaver`.
- Review assessment/outcome: disabled/unmanaged; `gentle-ai review mode status` reported clone-local OFF, so no review was started.

## Acceptance Criteria

1. With configured Information images, the sequence is ROOM → existing Información module → Hotel Alert screensaver; the saver does not replace or interrupt the Information module.
2. The saver shows current localized time/date and the configured ROOM background, remains until user interaction, and interaction returns to ROOM and resets inactivity.
3. The saver is never shown in AREA/setup/maintenance/diagnostics.
4. Temperature and humidity are not fabricated or shown as real measurements while no supported reading source exists.
5. Focused Vitest tests, web typecheck/build, and `git diff --check` pass; unrelated staged/unstaged changes remain unchanged.

## Progress and Evidence

- [x] CodeGraph-first mapping completed; the Android APK normally hosts the web DeviceScreen, which already reads `roomBackground` and clock context.
- [x] User clarified Information-module/saver sequence and approved proceeding while sensor readings remain omitted until a supported source is found.
- [x] Read-only ADB sensor/service discovery on the user-authorized .121 endpoint completed; only the Android accelerometer is publicly exposed.
- [x] ROOM-SAVER-01 implementation complete in commit `b866aba`.
- [x] Focused Vitest: 2 files, 79/79 tests passed.
- [x] `corepack pnpm typecheck` passed.
- [x] `corepack pnpm --filter @hotel/web build` passed; Vite reported the existing large-chunk warning (857.29 kB minified JS).
- [x] `git diff --check` passed; unrelated staged/unstaged changes were preserved.
- [ ] APK build/install and on-device validation remain pending separate authorization; Akubela firmware screensaver takeover is not verified.

## Next Step

If the user wants device verification, obtain explicit authorization for building/installing the APK on .121 before deployment; separately confirm whether the Akubela firmware saver is still taking over.

## Relevant Files

- `apps/web/src/features/device/InformationCarousel.tsx` — existing idle Información lifecycle and external saver hand-off.
- `apps/web/src/features/device/DeviceScreen.tsx` — ROOM composition, saved background, and clock context.
- `tests/unit/information-carousel.test.ts` — idle/cycle/cancellation lifecycle tests.
- `tests/unit/device-screen.test.ts` — ROOM composition and configuration behavior tests.
- `apps/web/src/styles.css` — shared responsive styles; preserve existing pending edits.
