# ODD Task: Room localization and operator request alerts

## Objective

Keep every ROOM-facing customer message and catalog value available in English and Spanish, including admin-authored guest information; pin all staff-facing Admin/AREA surfaces and request alerts to Spanish; remove redundant alert copy; and make Android request alerts audibly verifiable.

## Problem and Why

The app already scopes most route UI to Spanish for staff and lets ROOM devices select a persisted locale, but locale coverage can silently fall back to English and custom area/service names were not persisted as language variants. Some staff-route errors were built in the outer ROOM locale context. The information carousel also stores only responsive (`square480`/`wide`) image variants, not language variants, so image-based guest information can remain single-language. Android posts a high-importance channel notification, but the operator still reports no audible alert; software `start()`/channel state alone cannot prove sound at the tablet speaker.

## Authorized Scope

- Web locale boundaries, Spanish message completeness, and persistence/editing/resolution of English/Spanish area and service names shown to ROOM customers.
- Explicit English/Spanish variants for admin-authored ROOM-facing hotel name and information-carousel assets while preserving responsive image sizing and a visible manual-completion path for legacy values/assets.
- Android operator notification copy and bounded sound-fallback diagnostics for background `request.created` events only.
- Route the app-owned Android request-alert sound to the tablet's built-in speaker even when Bluetooth is connected, and verify the actual output route on the already authorized SM-T220.
- Focused web/server/Android tests and local build/device verification on the already authorized SM-T220 (`R9PT70GX3PA`).
- Preserve all unrelated staged/unstaged/untracked work. Do not register, assign, delete, or otherwise mutate station assignments. Do not push or open a PR.

## Constraints and Decisions

- Preserve the ROOM language preference; Admin, AREA, bootstrap, and loading views must remain Spanish regardless of that preference.
- Admin-managed custom ROOM-facing area/service names and descriptions need explicit English and Spanish values; Spanish remains the canonical staff-facing value. Do not machine-translate user-authored names. Existing custom rows without an English value must be surfaced for manual completion and retain a safe legacy fallback until completed.
- Admin-authored guest information must be stored with explicit language identity, not inferred from responsive dimensions. Never machine-translate uploaded artwork; require/record separate Spanish and English guest-information assets and surface legacy single-language content for manual completion. App-owned UI labels and status copy remain in complete locale dictionaries.
- The configurable hotel name is guest-visible text: keep Spanish canonical for staff and require an explicit English variant for new settings; show a Spanish-safe fallback plus an Admin warning for legacy settings until completed. A hotel logo remains a shared brand asset, not translated by the app.
- Keep request alerts limited to a new request created by a ROOM device while the operator app is backgrounded. Do not alert on status updates.
- For the app-owned alert sound, explicitly prefer the tablet's built-in speaker rather than Bluetooth; verify the actual route rather than treating route-request acceptance as proof. Preserve Android's user-selected notification-channel, volume/ringer, mute, and DND behavior.
- Respect Android user-selected mute, ringer, notification-channel, and DND settings; do not bypass them with alarm/audio focus tricks.
- Effective TDD: off, based on the latest project task configuration. Run ordinary functional checks.
- Runners: root `corepack pnpm test:unit`, `corepack pnpm test:integration`, and `corepack pnpm typecheck`; Android `source /home/jorlys/.local/share/hotel-alert-env/android-toolchain.sh && ./gradlew :app:testDebugUnitTest :app:assembleDebug :app:lintDebug :app:check` from `apps/android-notification-receiver`.
- Receipt-driven review: disabled/unmanaged (`gentle-ai review mode status` reported off; do not start reviews).
- Implementation route: delegated direct. Mapping trigger evidence: behavior crosses route provider, callback, translations, DTO/validation, persistence, admin forms, notification mapper/sink, and tests. Writer trigger evidence: each implementation task modifies 2+ non-trivial files.
- Delivery: forecast approximately 850–1,000 authored changed lines after the newly scoped LRA-04 work; use `feature-branch-chain` on the existing `jorlys/feat/lan-notification-agent` branch, consistent with the prior continuation decision. Record the new LRA-04 work-unit slice/boundary after verification and commit. No push/PR.

## Tasks

### LRA-01 — Enforce staff Spanish and complete translation coverage

- Keep ROOM as the only route inheriting the saved English/Spanish selection; pin all staff-route UI and errors to Spanish.
- Make the Spanish message catalog statically complete, add the currently missing Spanish native-device-command message, and prevent silent missing-key fallback from hiding future catalog gaps.
- Add regression coverage for Admin/AREA/bootstrap errors when the outer ROOM preference is English and for preserving the ROOM locale preference.
- Route: delegated direct writer.
- Checks: focused locale/admin/room tests, web typecheck.
- Progress: ✅ Implemented. Spanish catalog now requires every message key, includes the native-device-command translation, and assignment/session restore errors are formatted explicitly in Spanish without changing the saved ROOM preference. Three focused suites passed (51/51), web typecheck passed, and `git diff --check` passed.

### LRA-02 — Persist bilingual custom ROOM catalog labels

- Persist English/Spanish variants for custom area/service names and descriptions through migration, DTO/validation, server mapping/mutations, and Admin create/edit forms. Keep the existing base fields as the canonical Spanish values so Admin/AREA remain Spanish.
- Resolve customer-facing strings and catalog values in ROOM according to the selected language; resolve staff-facing catalog values in Spanish.
- Surface custom legacy rows with missing English variants so an administrator can fill them manually; preserve backward compatibility and a non-destructive fallback until then. Never invent translations for custom values.
- Route: delegated direct writer.
- Checks: focused resolver/admin/server integration tests, shared/server/web typechecks, migration and unit/integration suites.
- Progress: ✅ Implemented Spanish-canonical and explicit English area/service names and descriptions through strict API validation, migration 11, server persistence/mapping, ROOM service/catalog snapshots, and Admin create/edit forms. New forms require English names; English descriptions are required whenever a Spanish description is entered. Legacy custom items keep their original text and are visibly flagged in Admin when English text is missing; built-in catalog entries continue using the app's reviewed dictionaries. Request snapshots also preserve service/area English names for ROOM status/history localization. Focused Admin/server/resolver tests passed (73/73), the full unit suite passed (443), the full integration suite passed (37), all-workspace typecheck passed, and `git diff --check` passed.

### LRA-03 — Simplify and diagnose Android request alerts

- Remove “New request” from the heads-up title; show direct identifying data and Spanish labels for the operator.
- Keep alert eligibility limited to background-created requests. Log actionable, bounded reasons when fallback audio is ineligible or playback fails/starts; add unit coverage for title, Spanish content, and eligibility without overriding Android mute/DND.
- Build/install the updated APK and inspect the real tablet channel/audio state; verify an actual background request if safely available. Do not claim audible playback without device evidence.
- Route: delegated direct writer.
- Checks: Android unit tests, assemble, lint, check; local tablet diagnostics/smoke; `git diff --check`.
- Progress: ✅ Removed the redundant title and corrected the fallback root cause: the prepared-player factory was followed by a forbidden audio-attribute change, aborting playback before `start()`. It now uses the factory overload that accepts attributes and a generated session ID. Android unit tests, assemble, lint, check, and `git diff --check` passed. Updated APK installed with `adb install -r`; app launch restored the receiver foreground service. Current source maps a heads-up directly to `Habitación <code> · <servicio>` and contains no “New request” copy. Physical sound still needs a fresh request event and audible confirmation.

### LRA-04 — Localize guest information carousel assets

- Add an explicit language dimension to information-carousel assets in addition to the existing responsive size dimension; ROOM requests the selected language and size.
- Persist an explicit English hotel-name value alongside the Spanish canonical name, edit both from Admin, and resolve the displayed name with the ROOM language; legacy names without an English variant need a visible manual-completion warning and a non-destructive Spanish fallback.
- Update Admin upload/repair UI and APIs so new guest-information slides can be supplied in Spanish and English without guessing/translating artwork. Show which language/size variants are missing for legacy slides and retain a safe fallback until an operator replaces them.
- Preserve existing carousel order/timing, old database content, and old cached snapshots; add migration, server, web, and API regression coverage.
- Route: delegated direct writer. Mapping trigger evidence: flow crosses Admin upload UI, multipart API, server storage/DTO, SQLite migration, device content route, and responsive carousel. Writer trigger evidence: implementation changes multiple non-trivial layers.
- Checks: focused image API/carousel/Admin tests, root unit and integration suites, workspace typecheck, Android-independent web/server behavior checks, and `git diff --check`.
- Progress: ✅ Implemented explicit English/Spanish image variants alongside legacy responsive variants, with migration 12 preserving existing artwork and seeding an empty `hotelNameEn` setting for existing databases. New Admin uploads require at least one asset per language; legacy slides show the specific missing language/size fields and can be repaired manually without translation. ROOM requests the selected locale and size, falling back within that locale before legacy/base artwork; hotel names retain Spanish as the staff/canonical value and ROOM resolves the persisted English value when present. Admin edits both hotel-name values and visibly warns on legacy blanks. Focused checks passed (8 suites/138 tests), full unit suite passed (450 tests), full integration suite passed (38 tests), all-workspace typecheck passed, and `git diff --check` passed. Estimated LRA-04 contribution: ~350–500 authored lines. No commit was created because the shared index already contains unrelated staged files and multiple changed paths contain broad concurrent work; parent review/selective staging is needed to avoid capturing unrelated edits.

### LRA-05 — Route Android request-alert sound through tablet speakers

- Route the app-owned sound for eligible background `request.created` alerts to the tablet's built-in speaker even when Bluetooth audio is connected.
- Keep the existing request eligibility and honor Android mute, ringer/notification volume, notification-channel, and DND settings; do not use alarm usage or audio-focus tricks. Log whether the built-in-speaker preference was accepted and the actual routed device after playback starts; never report a speaker route based only on a successful request.
- Add Android unit coverage for speaker discovery, route preference, and unavailable/rejected routes. Build/install the APK and, with Bluetooth connected if available, verify a real background ROOM request reaches the tablet speaker and inspect correlated `HotelAlertSound` logs. No physical audibility claim without operator confirmation.
- Route: delegated direct writer. Writer trigger evidence: the change spans the Android audio fallback and its tests.
- Checks: Android unit tests, assemble, lint, check; authorized SM-T220 route/audio smoke; `git diff --check`.
- Progress: ⚠️ Implemented API 28+ built-in-speaker selection and fail-closed behavior for missing/rejected/mismatched routes. Android unit tests, assemble, lint, check, and `git diff --check` passed; the rebuilt APK was installed on SM-T220 (Android API 34) with app data preserved, and the receiver foreground service is running. A fresh ROOM request has not triggered playback since installation, so the effective player route and physical audibility remain unverified. Android's notification-channel sound remains a separate system-managed route and was not changed.

## Acceptance Criteria

- ROOM uses its selected English or Spanish UI strings and persisted localized custom room/area/service values, without changing the language of Admin/AREA screens. All guest-visible custom catalog names and descriptions have explicit translations.
- Admin/AREA/bootstrap/loading text and the Android request popup are Spanish even when ROOM preference is English; the Spanish dictionary cannot compile with an omitted key.
- Missing translation values on legacy custom catalog rows are visible to Admin for correction and are never silently machine-translated.
- ROOM information-carousel assets resolve by both selected language and screen-size variant; legacy assets missing a language are visibly flagged for manual replacement and never machine-translated.
- The ROOM hotel name uses the selected language variant; Admin/AREA continue to display its Spanish canonical value, with legacy missing English flagged.
- A new background ROOM request produces a notification with no “New request” prefix and contains concise room/service/area information; status updates and foreground events remain silent.
- Audio fallback reports why it starts or is suppressed, routes the app-owned alert sound to the tablet's built-in speaker even if Bluetooth is connected, continues to respect Android silence/DND/channel settings, and verifies the actual routed device separately from notification visibility.

## Verification Evidence

- CodeGraph confirmed the route providers already pin most staff views to Spanish; callbacks in `App.tsx` can still inherit the outer ROOM locale.
- Before LRA-01, the Spanish dictionary had 517 of 518 English keys; `device.nativeDeviceCommandsUnavailable` was the only missing key. LRA-01 now makes both catalogs statically complete.
- `dumpsys notification` on SM-T220 showed channel `hotel-alert-requests-v3` at HIGH importance with a valid app-resource sound URI (`mSoundMissingReason=0`) and an interruptive/noisy notification; notification permission is granted and Zen mode is off. This confirms notification/channel configuration, not audible physical playback.
- Read-only ADB inspection later showed Android selects `AUDIO_DEVICE_OUT_BLUETOOTH_A2DP` for the notification sonification strategy, and the selected A2DP output is marked `SUPPRESSED`. Ringer is NORMAL, notification volume is positive, DND is off, channel sound is present, and notification permission is granted. No recent `HotelAlertSound` playback logs were available, so Bluetooth routing is a strong current cause to test, not proof of a past alert's output. The user chose the tablet's built-in speaker as the required app-owned alert output even when Bluetooth is connected; verify actual routing and audibility without bypassing user mute/DND/channel choices.
- The [official Android MediaPlayer API](https://developer.android.com/reference/android/media/MediaPlayer) states that `create(Context, resId)` calls `prepare()` automatically and that its audio attributes cannot then be changed. The fallback had applied attributes after this prepared factory returned, so the exception was caught before playback started; it now uses the overload that supplies attributes during creation.
- LRA-01 touched `apps/web/src/i18n.tsx`, `apps/web/src/App.tsx`, `tests/unit/i18n.test.ts`, and `tests/unit/app.test.ts`; focused web checks passed.
- LRA-03 Android unit tests passed (including new factory-configuration/failure tests); `:app:assembleDebug`, `:app:lintDebug`, `:app:check`, and `git diff --check` passed. The rebuilt APK at `apps/android-notification-receiver/app/build/outputs/apk/debug/app-debug.apk` was installed with `adb install -r` on SM-T220, preserving app data. `dumpsys activity services` showed `HotelNotificationReceiverService` foreground after launch; no new ROOM request was generated, so no playback log or physical-audio confirmation is available.
- LRA-02 added schema migration 11 with `{}` defaults for localized variants, preserving all existing canonical values. Server round-trip tests verify create/edit retention and localization data in ROOM service lists, snapshots, and newly created request references; migration tests verify existing area/service values are unchanged. `corepack pnpm typecheck`, `corepack pnpm test:unit` (443 tests), `corepack pnpm test:integration` (37 tests), focused Admin/Room/server tests, and `git diff --check` passed.
- LRA-04 added migration 12 with a separate `(image, language, responsive size)` table and a seeded blank `hotelNameEn`; an upgrade-path regression verifies canonical hotel text and legacy image metadata remain unchanged. Server/API tests exercise bilingual creation, same-language size fallback, repair, ROOM authorization, and invalid locale rejection. Admin tests render all four EN/ES size fields for create/repair, visible legacy missing-artwork guidance, and missing-English hotel-name warning; ROOM view tests verify localized hotel-name display and old-snapshot fallback. `corepack pnpm test:unit` passed (450 tests), `corepack pnpm test:integration` passed (38 tests), `corepack pnpm typecheck` and `git diff --check` passed.
- LRA-05 adds a built-in-speaker preference to the app-owned alert MediaPlayer on API 28+, then checks `getRoutedDevice()` while playback is active and releases/logs instead of falling back to Bluetooth if the route is unavailable or wrong. Android unit tests cover speaker discovery, accepted/rejected preference, actual-route mismatch/unknown output, and unchanged mute/DND gates. The complete Android runner passed (`:app:testDebugUnitTest`, `:app:assembleDebug`, `:app:lintDebug`, `:app:check`; Gradle reported `BUILD SUCCESSFUL`, 78 tasks). The Debug APK was installed with `adb install -r` on the authorized SM-T220 (API 34), preserving app data; the foreground receiver service is running. Current policy still shows the system notification sonification strategy selecting suppressed Bluetooth A2DP. No fresh `HotelAlertSound` log or new ROOM request occurred after install, so neither the MediaPlayer's effective output nor physical audibility has yet been observed. The notification channel's own sound remains independently routed by Android and was not modified.

## Next Step

Selective LRA-04 commit remains pending because unrelated staged and broad mixed worktree changes make safe isolation uncertain; preserve the shared index unless an isolated commit can be demonstrated. To finish LRA-05, trigger one normal background ROOM request with the tablet app minimized while Bluetooth remains connected if available; confirm the correlated `HotelAlertSound` log says `route_verified actual_device=built_in_speaker` and the operator hears it. The system notification-channel tone can still follow Android's independent routing. Do not change station assignments.
