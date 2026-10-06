# ODD Task: Hotel Alert ROOM Custom Screensaver

## Objective

Show Hotel Alert's own ROOM screensaver after the existing Información module, with the configured background, a shared server-selected time zone for every device, localized date/time and weather data, a configured clock cycle independent of locale, hourly weather refresh, and app-window brightness that starts at the maintenance-configured level, steps down by 5 percentage points to a 5% floor, then holds while the saver is active. The left capacitive button toggles room-level Do Not Disturb; the right makes the saver fully black without suspending Android or taking the device offline.

## Problem and Why

The custom ROOM screensaver exists, but device-local time zones can make app-displayed time differ between panels. The server already supplies one UTC instant; device clocks and saver currently format it without a time zone, so each device applies its own local zone. The user requested one centrally configured time zone for every device.

The user also reports that selecting a 12-hour clock should not let the selected display language change the hour cycle. `Intl.DateTimeFormat`'s `hour12: true` can still choose an `h11` cycle for a locale, rendering noon as `0:12 p. m.` rather than `12:12 p. m.`. Pin `h12`/`h23` explicitly while leaving localized day-period labels intact.

The user also wants location-based temperature, humidity, and weather conditions on the saver when the server has Internet. The panels expose no supported environmental sensor source, so any new values must be identified as location-based forecast/model data, never as device measurements. Weather must be omitted when location/data is unavailable or the provider cannot be reached.

The previous saver ramp now starts from maintenance brightness and reaches 10%; the user requests a new 5% floor. They confirm both physical keys respond, but report that the right-key blackout only dims the panel. Android's window brightness override can request the lowest window brightness, not guarantee hardware backlight power-off; an opaque black saver layer is needed to guarantee no visible content while `FLAG_KEEP_SCREEN_ON` and ROOM presence remain active. Restore the configured brightness when the saver ends or wakes. This must not be represented as controlling Akubela's separate OS-level screensaver.

The user has clarified that Hotel Alert's own APK replaces FreeKiosk. The server still contains stale FreeKiosk beep and screensaver-control integrations; the ROOM app already owns its screensaver lifecycle. Separately, REST heartbeat warnings show 429 responses because both the WebView and native APK presence service currently send heartbeats for a ROOM device. The weather flow intentionally collapses missing configuration/provider failures to null, so the saver can silently render only the clock; live provider/config status has not yet been verified.

## Authorized Scope

- Extend the existing ROOM experience and central server settings for a shared IANA time zone selected from a preloaded offline catalog of America zones, defaulting to `America/Cancun`, and applied to app-displayed date/time on the server/admin UI and all ROOM and AREA devices, plus an optional hotel location found through server-side geocoding.
- Fetch and cache location-based weather on the server, expose only server-provided weather to authenticated ROOM clients, and localize saver labels/conditions using each device's selected app locale.
- Dim the Hotel Alert Activity window from the maintenance-configured level only while the custom SAVER phase is active, reducing it by 5 points every 30 seconds to 5%; restore the configured manual/automatic brightness afterward.
- Simplify saver weather presentation by removing explanatory forecast copy, increasing reading sizes, and moving the weather block lower with additional spacing; preserve compact source/license attribution required for MET Norway data. Further refine the weather container's vertical position and enlarge the weather text and condition icon responsively without clipping the clock/date or forecast on the 480x480 panel.
- Begin the saver-only brightness ramp at the maintenance-configured percentage (80% in the reported setup); decrease by 5 percentage points every 30 seconds to a 5% floor, then hold. Preserve automatic brightness on saver exit. Do not alter device-global brightness or the maintenance setting.
- Capture the two front capacitive keys (`KEY_F5` left, `KEY_F6` right) in the Android Activity and route only while the ROOM screensaver is active. Left toggles Hotel Alert room-level Do Not Disturb without leaving the saver; right toggles an opaque black layer plus the lowest app-window brightness and back. Never lock/sleep/suspend Android or stop ROOM presence.
- Show localized, downward-triangle physical-key hints above the matching controls; color the DND hint red while DND is active. Keep hints in the saver only and outside clock/weather content.
- Refresh saver weather immediately on mount and then every 60 minutes; keep server cache/provider-header behavior and weather-unavailable handling unchanged.
- Remove all FreeKiosk runtime integrations/configuration and retain screensaver ownership in the Hotel Alert app; remove the unused legacy beep route rather than preserving a server-to-FreeKiosk dependency.
- Ensure a native ROOM presence service and the browser fallback do not issue duplicate REST heartbeats; honor server Retry-After if a native heartbeat still receives HTTP 429.
- Make weather unavailability diagnosable in server logs and the saver UI while continuing to display valid server forecast values and never fabricating data.
- Add focused tests, typechecks, builds, lint/checks as applicable.
- On 2026-10-02, the user explicitly reauthorized installing this rebuilt APK on the three previously tracked ROOM targets: `.121:36711`, former `.243` now `.246:44017`, and `R9PT70GX3PA`. The user also authorized read-only physical-button testing on `.246:44017` after installation. This does not authorize deploying the web bundle to a server or changing device settings.
- Earlier .243 reset/ADB authorization applied only to that former device and did not authorize changes to other device settings or server `.201`. New 2026-10-02 authorization specifically covers APK installs on `.121:36711`, `.246:44017`, and `R9PT70GX3PA`, plus read-only button tests on `.246`; no server deploy/settings changes.
- Preserve all unrelated staged, unstaged, and untracked work on branch jorlys/feat/lan-notification-agent. Do not push, open a PR, or merge.

## Constraints and Decisions

- The custom saver remains a distinct phase after Información; keep the order ROOM UI → Información → Hotel Alert saver.
- The saver is ROOM-only. AREA, setup, maintenance, and diagnostics behavior must remain unchanged.
- The two capacitive hardware buttons map left=`KEY_F5` to Hotel Alert room-level Do Not Disturb and right=`KEY_F6` to an opaque black app-window layer plus the lowest window-brightness value. The right action MUST NOT sleep/lock/suspend Android, alter global brightness, or stop ROOM presence/heartbeats. Touch or the right button wakes it; saver exit restores the existing manual/automatic brightness mode.
- The saver brightness ramp begins from the maintenance-configured percentage (80% in the reported device) and lowers 5 points per 30 seconds until 5%; this is an Activity-window override only. Automatic brightness is restored on exit. The maintenance slider value is unchanged.
- Weather polling is once per hour after an immediate initial fetch; server-side cache semantics remain controlled by MET response headers.
- The configured clock cycle is independent of locale: use `h12` for 12-hour time and `h23` for 24-hour time, while preserving each locale's AM/PM labels.
- The shared server setting controls every Hotel Alert-rendered date/time on the server/admin UI and ROOM/AREA clients. Keep timestamps and instants transported/stored as UTC ISO values; apply the selected time zone only when formatting for display. This does not change the server host's or Android's OS clock/time-zone settings.
- The time-zone chooser must be populated from a bundled/local catalog containing every IANA identifier under `America/`, include `America/Cancun`, default to `America/Cancun`, and remain usable with no Internet; administrators should select a zone, not type an identifier. Preserve an explicitly admin-configured zone when applying defaults.
- Replace the manual location name/latitude/longitude inputs with one city search field. Search and resolve city names on the server; show selectable, identifiable results, and persist only the selected display name and coordinates. Show the search only when the server key is configured; if a lookup fails because the server is offline or the provider is unavailable, hide/disable location search while keeping timezone settings usable. Do not rely on browser connectivity to infer server connectivity.
- The user explicitly approved Geoapify for geocoding and supplied an API key in chat on 2026-10-01. Never copy the credential into code, logs, task files, memory, or version control, and do not echo it. Geoapify requires the server-only `GEOAPIFY_API_KEY` runtime secret; local implementation reads it from the environment, while configuring any remote server remains separately unauthorized until a destination and operation are specified. Each lookup sends the typed city/place and server egress IP to Geoapify. The free plan permits production/commercial use within quota and feature limits with required Geoapify/data-source attribution; do not exceed provider limits. Public OSM Nominatim is unsuitable for autocomplete because its official usage policy prohibits that use. MET Norway remains weather-only and does not geocode.
- Weather values are forecast/model values for the configured location, not measurements from the panels' sensors. Do not fabricate values or label the forecast as a device reading.
- Use MET Norway Locationforecast 2.0 as the server-side source: official docs confirm coordinate-based worldwide forecast coverage and air-temperature, relative-humidity and symbol-code values. It requires an identifying User-Agent, at most four decimal places for coordinates, caching according to response headers, and appropriate CC BY 4.0 attribution; the API has no delivery guarantee/SLA. Fetch only from the server and gracefully omit unavailable weather. Sources: https://api.met.no/doc/TermsOfService, https://docs.api.met.no/doc/License.html, https://docs.api.met.no/doc/locationforecast/datamodel.html, https://api.met.no/weatherapi/locationforecast/2.0/documentation.
- Configure a human-readable resolved place name plus latitude/longitude centrally; coordinates are rounded to at most four decimals and remain server-side.
- Weather is optional: no configured location, offline server, timeout, provider failure, or missing forecast fields must not block ROOM display or show fabricated values.
- Per-device locale already persists through the ROOM LanguageSelector/useI18n path. Saver date/weather labels and weather-condition names must use that locale (currently English and Spanish).
- .121's exposed Android sensor inventory contains only an accelerometer; temperature/humidity must come from the configured server-side forecast source.
- Existing saver sequence implementation is in commit b866aba. ROOM-SAVER-02 installed APK SHA-256 03eab1c5b6fc10fe369cde54b23068e8320340ed64e0af2e18c709713244e629 to prior authorized targets; physical .243 OEM-overlay validation remains pending. Do not claim this task fixes Akubela's system overlay.
- Effective TDD: OFF, inherited from the active ROOM screensaver task configuration; use ordinary functional checks. Root Vitest runner: corepack pnpm exec vitest run with the affected focused tests; full unit runner: corepack pnpm test:unit. Web checks: corepack pnpm typecheck and corepack pnpm --filter @hotel/web build. Server check: corepack pnpm --filter @hotel/server build. Android runner: source "$HOME/.local/share/hotel-alert-env/android-toolchain.sh" && ./gradlew :app:testDebugUnitTest :app:assembleDebug :app:lintDebug :app:check.
- Existing branch has extensive staged and unstaged unrelated changes. Preserve the shared index and all unrelated changes.
- Implementation route: delegated direct for ROOM-SAVER-03, ROOM-SAVER-04, and ROOM-SAVER-05. Mapping trigger evidence: server system settings, shared validation/contracts, device snapshot, app locale, screensaver lifecycle, and Android window brightness cross well over four files; CodeGraph was used first and a read-only server-configuration mapper completed a CodeGraph-first map. Writer trigger evidence: each task spans multiple non-trivial production/test files; delegate one bounded writer per task and preserve existing dirty edits.
- Forecast: previous feature estimate was approximately 320 authored changed lines; the original settings/weather/localization/brightness extension was approximately 530 additional lines (~850 total). The accepted timezone catalog/formatting refinement adds approximately 300 lines (~1,150 total). New FreeKiosk removal, heartbeat reliability, and weather diagnostics are forecast at approximately 490 additional authored lines (~1,640 cumulative; generated output excluded), above the ~400-line delivery budget. Delivery strategy remains ask-on-risk; the chain-strategy question before the first new work-unit commit remains unanswered. Do not create a PR/push/merge.
- Receipt-driven review was previously disabled/unmanaged; re-check status before a commit and do not start review when disabled.

## Tasks

### ROOM-SAVER-01 — Add the post-Información ROOM screensaver

- [x] Extend the existing idle lifecycle so the custom Hotel Alert saver starts only after Información completes; keep it active until interaction cancels it and returns the ROOM UI.
- [x] Render localized time/date over the saved ROOM background with readable contrast; restrict to ROOM mode.
- [x] Keep unavailable temperature/humidity out of the UI until a supported data source exists.
- [x] Add lifecycle/DeviceScreen tests and run the focused Vitest suite, web typecheck/build, and git diff --check.
- Route: delegated direct writer after the tracker/mirror. Preserve prior dirty edits in overlapping web files.
- Commit: b866aba — feat(web): add post-information ROOM screensaver.
- Review outcome: disabled/unmanaged; clone-local OFF, so no review was started.

### ROOM-SAVER-02 — Keep the active ROOM screensaver visible over system sleep

- [x] Add a pure Android policy that keeps the display awake only while Hotel Alert's ROOM Activity is active, configured, and outside maintenance/diagnostics; clear the flag when those conditions stop applying.
- [x] Add focused policy tests for eligible ROOM and excluded/missing-session states; preserve the existing ROOM → Información → saver lifecycle and all other modes.
- [x] Run the Android unit/build/lint/check runner, assemble the Debug APK, and install with adb install -r on the three previously authorized targets without clearing app data or changing Android system settings. Runner passed; installs returned Success on .121:36711, .243:44999, and R9PT70GX3PA. APK SHA-256: 03eab1c5b6fc10fe369cde54b23068e8320340ed64e0af2e18c709713244e629.
- [ ] Verify on .243 whether Android remains awake through the idle sequence and whether Akubela still draws above the app; FLAG_KEEP_SCREEN_ON does not guarantee OEM-overlay suppression.
- Superseded: Hotel Alert now owns the screensaver; remove the obsolete FreeKiosk control path under ROOM-SAVER-06. No external kiosk API key is part of the target architecture.
- Route: delegated direct. Mapping trigger evidence: CodeGraph traced the Android Activity/window lifecycle, WebView/ROOM saver lifecycle, and device DreamManager state. Writer trigger: implementation and behavior tests span multiple Android files. TDD OFF; runner is the Android Gradle command above.
- Forecast was approximately 320 authored changed lines total before this extension.

### ROOM-SAVER-03 — Configure and propagate the shared time zone and hotel location

- [x] Add validated global settings for an IANA time-zone identifier and optional resolved location name/latitude/longitude; persist defaults/migration.
- [x] Propagate the selected time zone in every device configuration without changing the Android OS time zone; keep location coordinates server-side and return only weather values to clients.
- [x] Cover setting validation, migration, persistence, and ROOM/AREA snapshot propagation with focused tests.
- [x] Replace the free-form timezone field with a bundled, offline selector for all 169 IANA `America/*` identifiers. Default fresh and still-unconfigured installs to `America/Cancun`; preserve an explicitly admin-saved selection.
- [x] Apply the selected zone to every user-visible Hotel Alert date/time on the server/admin UI and ROOM/AREA device views, including the ROOM saver, AREA clock/sync timestamp, and admin event/last-login timestamps. Keep API/storage timestamps as UTC instants and do not change host/device OS zones.
- [x] Replace manual name/coordinate inputs with one city-search field, server-side Geoapify autocomplete, and result selection; store the resolved selected place and coordinates server-side. If the runtime API key is absent, or a lookup fails offline/provider-down, search is unavailable and timezone-only configuration remains usable.
- [x] Cover the bundled America-zone list/default/persistence, time-zone formatting including day-boundary cases, and unchanged UTC transport with focused tests (197 passing across 10 files).
- [x] Cover one-field geocoder search, request authentication/rate limiting, selected-place persistence, missing-key behavior, sanitized provider failures, visible Geoapify attribution, and offline fallback with focused tests (4 files, 81/81 passing). The user approved Geoapify and supplied the key on 2026-10-01; server runtime secret setup remains pending and the key was not persisted.
- Route: delegated direct. CodeGraph and a read-only server-configuration mapper mapped the existing SQLite system_settings → shared validation/DTO → HotelService/API → SettingsPanel path. TDD OFF inherited from this active feature; use focused Vitest and server/web typecheck/build runners above.
- Geocoding gate update: Geoapify use approved by the user on 2026-10-01. Implemented server-only `GEOAPIFY_API_KEY` lookup with admin authentication/rate limiting and visible attribution. The search UI checks server configuration and hides after a failed lookup; it never exposes the secret or coordinates to device snapshots. The user explicitly asked to use the supplied key as the service API configuration; it is now set only in the local, git-ignored root `.env` (file mode 0600), never in source/tests/task/memory. No target server was changed. A live lookup test for the generic city Cancún returned five provider results; the already-running `apps/server dev` process must restart to load the newly configured environment.
- ROOM-SAVER-03 city-search implementation route: delegated direct writer after task/mirror update; the read-only CodeGraph-first city/weather map was reused. Test double fetch only, TDD OFF. Focused Vitest: 4 files/81 tests passed; monorepo typecheck, server build, web build, and `git diff --check` passed. The web build reports Vite's CommonJS Node API deprecation and a 872.70 kB minified JS chunk warning.
- Route update: delegated direct implemented this accepted timezone refinement. CodeGraph-first mapping and a read-only timezone mapper confirmed defaults/persistence, snapshots, and all app-rendered date/time surfaces across more than four files. TDD OFF. Focused Vitest: 10 files, 197/197 passed; `corepack pnpm typecheck`, server build, web build, and `git diff --check` passed. Web build retains the existing large-chunk warning (868.87 kB minified JS).
- Forecast update: this refinement adds approximately 300 authored lines; the cumulative feature estimate is approximately 1,150 authored lines (generated output excluded), above the ~400-line delivery budget. Ask-on-risk remains selected; the previously asked chain-strategy question remains unresolved, so do not create a work-unit commit until the user answers.
- Verification: focused Vitest on six files passed (126 tests); `corepack pnpm typecheck`, server build, web build, and `git diff --check` passed. Web build retains the existing large-chunk warning (864.95 kB minified JS).
- Previous commit gate question remains unanswered; no work-unit commit has been made.

### ROOM-SAVER-04 — Add cached server weather to the localized saver

- [x] Fetch location forecast data server-side from MET Norway Locationforecast 2.0 with a descriptive User-Agent; cache according to provider response headers and avoid one external request per device.
- [x] Provide weather only to authenticated ROOM clients; keep coordinates server-side and show available temperature, relative humidity, and condition on the custom saver with MET Norway and CC BY 4.0 attribution.
- [x] Localize weather labels and condition names using each device's selected locale; apply the shared server time zone to the saver date/time.
- [x] Omit unavailable weather for unconfigured location, offline/provider failure, or missing data; never block ROOM startup or fabricate a value.
- [x] Add focused provider/cache/route/saver/locale tests and run web/server checks.
- Route: delegated direct. Mapping trigger evidence: CodeGraph and a read-only server-configuration mapper identified the snapshot/API, ROOM saver, device locale, and tests. Writer trigger: server fetch/cache/API plus web fetch/poll/render and tests span multiple non-trivial files. TDD OFF inherited from this active feature; use focused Vitest plus server/web checks above.
- Estimated authored changes: approximately 250 lines for server weather cache/endpoint and localized ROOM saver display. The room-location search changes are tracked under ROOM-SAVER-03.
- Weather implementation: added an in-memory server cache honoring cache headers, `If-Modified-Since`/304, timeout, response validation, four-decimal coordinates, and per-coordinate single-flight. The authenticated device-weather API is ROOM-only; coordinates are read from server settings and are not placed in snapshots. `RoomScreensaverContainer` starts and stops its initial fetch/15-minute refresh with the SAVER phase mount, displaying forecast labels/icons and MET Norway/CC BY attribution in English or Spanish.
- Verification: worker reports 5 focused files/101 tests, monorepo typecheck, server build, web build, and `git diff --check` passing. Root independently reran `tests/unit/met-norway-weather-client.test.ts`, `tests/unit/room-screensaver-weather.test.ts`, and `tests/integration/weather-api.test.ts` (3 files/20 tests), plus typecheck, server/web builds, and `git diff --check`; all passed. Web build retains Vite's CJS Node API deprecation notice and 882.98 kB minified JS chunk warning.
- MET User-Agent is identifiable and uses the configured `APP_ORIGIN` origin as contact URL. Official MET guidance requires contact information; verify production `APP_ORIGIN` is a meaningful, externally identifiable website/contact before enabling live forecast traffic. No real provider calls or remote settings were made.

### ROOM-SAVER-05 — Dim only while the custom saver is active

- [x] Bridge the InformationCarousel SAVER phase to Android without affecting normal ROOM, AREA, setup, maintenance, or diagnostics behavior.
- [x] Apply a 15% Activity-window brightness override during SAVER and restore the configured manual level or automatic mode when the saver ends.
- [x] Add focused state/policy tests and run the complete Android unit/build/lint/check runner.
- Route: delegated direct; mapping evidence is the CodeGraph/agent map of InformationCarousel phase, NativeWebViewBridge, MainActivity.applyRoomWindowBrightness, and RoomScreenBrightnessPolicy. Writer trigger: non-trivial web/native bridge, Activity/policy, and test edits. TDD OFF inherited from this active feature.
- Mapping confirmed the JS-interface callback may run off the main thread; dispatch Activity window updates to the UI thread and clear saver state on unmount/reload, Activity pause, focus loss, and when maintenance/diagnostics takes over. The optional bridge only applies with a configured ROOM session/server origin.
- Verification: focused Vitest (4 files, 112 tests), `corepack pnpm typecheck`, focused Kotlin brightness/bridge tests, full Android `:app:testDebugUnitTest :app:assembleDebug :app:lintDebug :app:check`, production web build, and `git diff --check` passed. Web build retains the existing >500 kB JS chunk warning; Kotlin reports existing deprecated WebView file-URL settings.
- Estimated authored changes: approximately 120 lines. Debug APK rebuilt locally at `apps/android-notification-receiver/app/build/outputs/apk/debug/app-debug.apk`, SHA-256 `56528cd53d8f1af328c3f830608f4086fd4781b64c7ec9b1e033c63eb8a1ecf7` (9,573,072 bytes). No install/deployment was performed.

### ROOM-SAVER-09 — Refine saver weather copy and layout

- [x] Remove the verbose “pronóstico de ubicación / no son mediciones del panel” and MET weather-description lines; retain only compact linked source and CC BY 4.0 attribution required for MET Norway forecast reuse.
- [x] Enlarge available temperature, humidity, and condition presentation; add separation from the clock/date and position the weather block lower without clipping on supported display sizes.
- [x] Add/adjust focused UI assertions and run web typecheck/build and diff checks.
- Route: delegated direct writer with ROOM-SAVER-05. Mapping trigger evidence: existing saver rendering, localized strings, responsive CSS, InformationCarousel/native bridge, Activity/policy, and tests span more than four files; CodeGraph-first mapper completed. Writer trigger: multiple non-trivial production/test files. TDD OFF; Vitest via `corepack pnpm exec vitest run <focused files>`.
- Estimated authored changes: approximately 80 lines.
- Compact MET Norway source and CC BY 4.0 license links replace the verbose attribution copy; official API terms require source credit and a link to the license. The unavailable-weather fallback remains localized and non-blocking.
- Verification: focused Vitest (4 files, 112 tests), `corepack pnpm typecheck`, production web build, and `git diff --check` passed. Weather layout uses responsive `clamp()` sizing, a larger icon/value scale, and increased spacing under date/time.

### ROOM-SAVER-10 — Compare thermal and CPU state on .243 and .121

- [x] With explicit read-only ADB authorization, compared former `.243` and `.121`: both were RK3566 / Android 12 / API 32 with identical firmware, APK hash `03eab1c5b6fc10fe369cde54b23068e8320340ed64e0af2e18c709713244e629`, and brightness. Former `.243` measured roughly 10–11°C hotter.
- [x] OEM `api.fcgi` and `netcast` ran on both with matching startup scripts, binaries, and configs; sustained CPU activity was observed only on `.243` (about 24–25% and 9–24%, versus near 0% on `.121`). This is correlation, not cause; do not disable shared services.
- [x] `.243` had `auto_time=0` / a 1970 clock and an extra port-8081 `CLOSE_WAIT` to `.201`; `.201` was not inspected. A one-time time-setting test is recorded in ROOM-SAVER-11.
- Route: delegated direct read-only ADB comparison after destination authorization; no device mutation.

### ROOM-SAVER-11 — Diagnose the .243 runtime load and safely test a confirmed cause

- [x] Confirmed OEM startup inputs match; no `.243`-only mismatch. The authorized one-time `auto_time=1` write reverted to `0`; clock corrected to 2026-10-02 UTC, but CPU stayed high. No cause was proven; no service, timezone, or server change.
- Route: delegated direct read-only investigation; no additional device mutations.

### ROOM-SAVER-12 — Verify the user-reported factory reset on the former .243

- [x] User reset former `.243` and provided `.246`; ADB pairing/read-only verification was authorized only on `.246:44017`. Android 12/fingerprint remained; `user_setup_complete=0`; only third-party Hotel Alert package was visible, so full data wipe was not independently confirmed.
- [x] No `.121` or `.201` command was issued during reset verification. APK install/update authorization was later granted separately and is recorded under ROOM-SAVER-14.
- Route: direct inline read-only device check after explicit pairing authorization; no source change or install during that reset check.

### ROOM-SAVER-13 — Lower and enlarge the weather container

- [x] Move the weather container farther below the clock/date and increase weather labels, values, and condition icon size responsively; target 480x480 weather sizes are 14.4px labels, 28px values, 72px icon, with 44px minimum separation.
- [x] Preserve existing localized content, compact source attribution, and existing scroll/no-overflow behavior; no maintenance or AREA selectors changed. Physical panel fit still needs visual confirmation.
- Route: direct inline for the single CSS file; CodeGraph/source mapping was completed before the write. Effective TDD: OFF; run `corepack pnpm exec vitest run tests/unit/room-screensaver-weather.test.ts`, `corepack pnpm typecheck`, and `corepack pnpm --filter @hotel/web build`.
- Estimated authored changes: approximately 20 lines.

### ROOM-SAVER-14 — Ramp saver brightness from the maintenance setting to a 10% floor

- [x] Seed the saver ramp from the maintenance-configured brightness (80% in the current report), then decrease by 5 percentage points every 30 seconds until reaching 10%; hold at 10% for the rest of the saver.
- [x] Existing behavior starts at 15% and takes only one step to 10% after 30 seconds; it fails the newly clarified configured-level progression.
- [x] Keep the changes scoped to the Activity window and restore manual/automatic mode on saver exit, lifecycle/focus loss, maintenance, diagnostics, or stale bridge events; do not change the maintenance preference or system-global brightness.
- [x] Add policy tests for configured-level initialization, repeated 5-point steps, the 10% floor, 30-second scheduling, zero-brightness blackout, wake, and manual/automatic restoration.
- Route: delegated direct Android writer for `RoomScreenBrightnessPolicy.kt`, `MainActivity.kt`, and tests; trigger: non-trivial cross-file state/lifecycle change. Preserve dirty edits. Effective TDD: OFF; Gradle runner above. User requires every rebuilt APK installed on all 3 targets.
- Verification: Android runner and brightness policy 11/11 passed. Diagnostic Debug APK (9,573,072 bytes), SHA-256 `cefc0d71c60f69af804059ce4c3b632b01307b707f0459118623b9f5d5d27b55`, installed on `.121:36711`, `.246:44017`, and `R9PT70GX3PA`; remote base.apk hashes match. No server deploy/settings change.
- [ ] Last `.246` reading, before this rebuilt APK, showed the saver with `sbrt=0.8` after 60s. Diagnostic logs showed `request=false`; resumed/focused/origin were true, diagnostics/maintenance false, and the override remained 0.8. The static bridge name/wiring matches. `HotelWebView` loads the web UI from the configured server origin rather than APK assets; a stale server-served web bundle is the leading explanation, but its live contents were not inspected. This APK install alone cannot deploy that bundle; remote access/deployment remains unauthorized. Do not claim panel brightness is fixed until the web bundle reports SAVER and the ramp is physically verified.
- Follow-up route: delegated direct Kotlin/state writer, then direct inline transition-only logging in `MainActivity.kt`, then delegated CodeGraph-first read-only bridge/bundle map. Diagnostic APK/build installed on all 3 and verified. No server deployment or access performed. Current follow-up: use the maintenance-configured level as the ramp start; resolve why `.246` still reports `request=false` before claiming hardware brightness works.
- Estimated authored changes: approximately 70 lines.

### ROOM-SAVER-15 — Assess front capacitive-button event delivery

- [x] Source-only map found no Activity/View hardware-key dispatch/listener path; current WebView handler sees screen touch events only.
- [x] Capture the physical presses on `.246:44017` with `adb shell getevent`: the second input event node emitted `EV_KEY KEY_F5` and `EV_KEY KEY_F6` DOWN/UP events. The first pair was F5 then F6, matching the requested left-then-right sequence, so left=F5/right=F6 is likely; confirm this mapping before binding actions if the user did not press in that order.
- [x] Add app-visible handling for left `KEY_F5` and right `KEY_F6`; source/policy/bridge tests cover the app routing. The earlier `getevent` capture proves kernel-level events only, so physical delivery remains pending.
- [x] Implement left=toggle room DND, right=zero Activity-window brightness toggle, with localized icon hints aligned above the two buttons. User specified this mapping and ruled out suspend/lock.
- Route: delegated direct read-only source mapping, followed by authorized read-only ADB `getevent` capture on `.246:44017`; no device settings changed. The implementation is separately tracked under ROOM-SAVER-16.

### ROOM-SAVER-16 — Bind the two capacitive buttons to saver actions

- [x] Add an Activity/WebView event bridge for `KEY_F5` (left) and `KEY_F6` (right), consuming key-down events without allowing the existing InformationCarousel handlers to cancel the saver.
- [x] Left toggles the authenticated Hotel Alert ROOM DND control and refreshes DND state without leaving the saver. Right toggles zero Activity-window brightness without Android lock/sleep; physical right press or touch wakes the display; saver exit restores configured brightness.
- [x] Show localized Moon/DND and display-off icon hints above the corresponding physical controls, responsive on the target 480×480 display. Physical alignment still needs visual verification on the target panel.
- [x] Add focused Android/web tests for mapping, repeat suppression, saver-only gating, online presence, DND success/failure, and wake/brightness restoration.
- [ ] Verify raw buttons reach Activity on `.246`; the user now reports neither physical button does anything. Earlier `getevent` proved kernel-level `KEY_F5`/`KEY_F6` events only, not Activity/WebView receipt.
- Route: delegated direct writer because native key routing, bridge contract, web DND callback, UI hints/i18n/CSS, and tests span multiple non-trivial files. CodeGraph-first mapping completed; preserve all dirty edits. TDD OFF; use the focused Vitest and Android Gradle runners recorded above.
- Estimated authored changes: approximately 220 lines. APK installs are authorized only on `.121:36711`, `.246:44017`, and `R9PT70GX3PA`; web UI runs from the user's local `corepack pnpm dev` server. Do not deploy remotely.

### ROOM-SAVER-17 — Refresh saver weather hourly

- [x] Keep the immediate weather fetch on saver mount, then change the client poll cadence from 15 minutes to 60 minutes.
- [x] Add a focused test for the hourly interval and cancel polling when the saver exits; preserve server cache/provider-header semantics.
- [ ] Verify hourly weather on a panel after the user's local dev server serves the changed UI; APK installation does not update this UI and no remote deployment is needed.
- Route: delegated direct web writer because implementation and timer tests are separate non-trivial files. CodeGraph-first mapping completed; TDD OFF; use focused weather Vitest plus web typecheck/build.
- Estimated authored changes: approximately 35 lines.

### ROOM-SAVER-18 — Keep the panel online while dimming progressively

- [x] Ramp starts from maintenance brightness, steps down 5 points every 30 seconds to 10%, and restores the existing manual/automatic setting; right-key blackout uses window brightness only and retains screen-on/presence.
- [x] Policy tests cover ramp steps/floor, blackout, wake/cancellation, and brightness restoration; APK SHA-256 `21a482c474b5909f2b01ba08ef3fc9a217af3f79d397afe9fe679279f8f460dd` was installed on all three panels.
- [x] Initial `.246` check showed Android `Awake`/`KEEP_SCREEN_ON` but `request=false`; continued in ROOM-SAVER-19. Local dev server only; no remote deployment.
- Route: delegated direct Android writer; CodeGraph map and full Android verification recorded above. TDD OFF.

### ROOM-SAVER-19 — Diagnose the local WebView-to-Activity saver signal

- [x] Reproduced `.246` showing saver at 80% with Android awake but native `request=false`; CodeGraph traced the separate SAVER callback to the injected Android bridge.
- [x] Added bounded handoff outcomes, fixed the unbound method call by invoking `bridge.setRoomScreensaverActive(active)`, and added focused tests (37 web tests; existing native test covers listener acceptance/rejection).
- [x] Local HMR now reports `active=true,result=accepted`; Android reports `request=true,eligible=true`, and the window ramp was observed at 80→75→70→65 while `Awake`. Final installed ramp/floor evidence is in ROOM-SAVER-20.
- Route: delegated direct across web/native bridge and tests; CodeGraph-first mapping completed, TDD OFF. Local dev server only; no remote deployment.

### ROOM-SAVER-20 — Verify and repair physical-button actions end to end

- [x] Root cause: the WebView's SAVER signal was invoked unbound (`call-failed`), disabling both the native brightness ramp and F5/F6 routing. Fixed the bridge receiver call; `.246` now reports `accepted`, `request=true`, and `eligible=true`.
- [x] Intercept F5/F6 in `Activity.dispatchKeyEvent` before the focused WebView. Keep left=room DND and right=zero Activity-window brightness; document the narrow lint suppression and preserve superclass fallback.
- [x] Tests: focused web suite (38), workspace typecheck and diff check; full Android `testDebugUnitTest`, `assembleDebug`, `lintDebug`, and `check` passed (78 tasks, 12 executed).
- [x] Debug APK SHA-256 `6aa9b70cbc7e1765caf5df37cbacfe40c787b844a58d1ecb561a881b03014e7a` (9,574,411 bytes) installed successfully on `.121:36711`, `.246:44017`, and `R9PT70GX3PA`.
- [x] Post-install on `.246`: native saver eligible; brightness reached the 10% floor in 5-point steps every 30 seconds (80%→75%→…→10%). Android stayed `Awake` and `RoomPresenceService` remained running.
- [x] User reports both physical keys now respond; the right key only dims the panel, so fully black presentation is continued under ROOM-SAVER-21.
- Route: delegated direct. Mapping trigger evidence: Activity dispatch, native WebView bridge, web custom-event listener, DND callback and brightness policy/test paths span more than four files; CodeGraph-first map and one narrow read-only explorer are complete. Writer trigger: the fix may touch multiple non-trivial Android/web files. Effective TDD OFF; use existing Vitest and Gradle runners. Preserve unrelated dirty changes.
- APK installation is previously authorized only on `.121:36711`, `.246:44017`, and `R9PT70GX3PA` if a rebuilt APK is needed. UI updates use the user's local dev server; do not deploy remotely.

### ROOM-SAVER-21 — Refine physical-button feedback and blackout

- [x] When right/F6 blackout is active, show an opaque full-screen black app surface and request the lowest Activity-window brightness; touch or right/F6 wakes it. Keep Android awake and ROOM presence online; do not change global brightness or claim the LCD backlight itself is powered off.
- [x] Reflect the actual room DND state in the DND hint: red while active and normal when inactive, including after a physical left/F5 toggle.
- [x] Replace rounded/pill visual hints with downward-pointing triangular markers aligned above the corresponding physical keys; preserve localization and keep them decorative/noninteractive.
- [x] Lower the saver brightness-ramp floor from 10% to 5%, retaining the maintenance start level and 5-point/30-second steps; update deterministic policy tests.
- [x] Run focused web tests (8/8), workspace typecheck and web production build, full Android test/build/lint/check; build and install the APK on `.121:36711`, `.246:44017`, and `R9PT70GX3PA`.
- [ ] On-device visual/manual confirmation of blackout, wake, red DND state, and triangular markers remains pending; no synthetic key presses or screen captures were used.
- Evidence: Debug APK SHA-256 `5dd5e22353d00fc3a86a82aa7eb3384b487729a77f0945b99a857a819ed161a3`; `adb install -r` returned `Success` for all three authorized targets. Focused Vitest passed (8/8), workspace typecheck and web production build passed (existing 888.35 kB chunk warning), Android unit/build/lint/check passed, and `git diff --check` passed. Android documents window brightness `0f` as the lowest app-window request, not a guarantee the physical backlight is powered off.
- Route: delegated direct writer. Mapping trigger: DND state, saver UI/CSS, native blackout/wake, brightness policy and tests span more than four files; CodeGraph-first map completed. Writer trigger: multiple non-trivial files. TDD OFF. Preserve dirty edits; local dev server only, no remote deployment.
- Forecast: approximately 100 authored changed lines; keep the existing commit gate and do not push/open/merge.

### ROOM-SAVER-22 — Keep the configured clock cycle independent of locale

- [x] Pin `formatClock` to `h12` for configured 12-hour time and `h23` for 24-hour time; retain locale-specific day-period text.
- [x] Add regression coverage for a Spanish locale preferring `h11` at noon, English 12-hour labels, and 24-hour midnight rendering.
- [x] Verify focused device-screen tests (62/62) and `git diff --check`.
- Route: delegated direct. CodeGraph-first mapping confirmed the configured preference and device locale reach the same `formatClock` used in the station header and ROOM saver; the bug is that `hour12` allows an h11 locale cycle. Writer trigger: implementation/test changes span two non-trivial files. Effective TDD OFF; focused runner is `corepack pnpm exec vitest run tests/unit/device-screen.test.ts`. No APK build/install or server deployment is needed for this web-only formatting fix.

## Acceptance Criteria

1. With configured Information images, the sequence remains ROOM → Información → Hotel Alert saver; the saver does not interrupt Información and exits on interaction.
2. The bundled offline selector contains every IANA `America/*` identifier and defaults unconfigured settings to `America/Cancun`. All Hotel Alert-rendered dates/times on server/admin and ROOM/AREA clients use the selected zone; UTC instants remain UTC in storage/API transport and host/device OS time-zone settings remain untouched.
3. When the server can reach the geocoder, administrators can search and choose a resolved hotel location; without Internet the location section is unavailable and timezone-only configuration still works.
4. With a selected location and server Internet, the saver displays available forecast temperature, humidity, and weather condition with source attribution; unavailable data is omitted without blocking the app.
5. Weather labels/conditions and saver date follow the language selected independently on each device.
6. During the custom saver, Activity-window brightness starts at the configured maintenance level, decreases by 5 percentage points every 30 seconds to 5%, and restores the existing manual/automatic brightness mode on exit.
7. AREA/setup/maintenance/diagnostics remain unchanged; no claims are made that app brightness or the foreground flag controls Akubela's distinct OS-level saver.
8. Focused tests and applicable server/web/Android checks pass; unrelated staged/unstaged work remains unchanged.
9. Hotel Alert server/runtime contains no FreeKiosk client, key, routes, or screensaver toggles; the in-app ROOM lifecycle remains the screensaver owner and no unused admin beep endpoint is retained.
10. Native-backed ROOM devices issue only one REST heartbeat producer, browser-only clients retain the fallback, and HTTP 429 retries respect a bounded server Retry-After delay.
11. Missing weather remains non-blocking but is diagnosable; configured location forecast data is rendered when provided, and no secret, coordinate, or fabricated value is exposed.
12. The saver omits verbose weather-description/measurement copy; weather values/icons are larger, lower, and separated from clock/date while compact linked source/license attribution remains visible.
13. On the custom ROOM saver, weather container and text/icon are larger and positioned lower without clipping on the target panel.
14. App-window brightness starts at the maintenance-configured level (80% in the reported setup), steps down by 5 percentage points every 30 seconds to the 5% floor, and restores manual/automatic brightness on every exit path.
15. The hardware has two physical buttons (left/right), not six LEDs. Left `KEY_F5` toggles room DND; right `KEY_F6` shows a fully black app surface at minimum window brightness without suspending Android, stopping ROOM presence, or changing global brightness. Touch or right-key input wakes it.
16. Weather is fetched immediately and then refreshed every 60 minutes while the saver is active; polling stops on exit.
17. The saver shows decorative downward triangles aligned above the physical controls; the DND indicator is red only while room DND is active.
18. The configured 12-hour clock always uses 1–12 regardless of locale (including Spanish noon as `12:xx p. m.`); configured 24-hour time always uses 00–23 (including midnight as `00:xx`).

## Progress and Evidence

- [x] CodeGraph-first mapping and implementation of ROOM-SAVER-01 through ROOM-SAVER-18 are recorded in the task sections above. Existing offline timezone selection defaults to `America/Cancun`; server-side location/weather remain optional and localized. The AOSP panel sensor inventory exposed only an accelerometer, so saver weather is forecast data, not a panel measurement.
- [x] Locally verified earlier slices: timezone/geocoding, cached MET forecast and localization, FreeKiosk retirement, single heartbeat ownership/429 handling, weather diagnostics/layout, physical-button routing, and hourly weather polling. Task sections retain their focused test/build evidence.
- [x] Earlier web slices passed focused suites (102/102), workspace typecheck, web build, and `git diff --check`; Vite's existing CJS API deprecation/large-chunk warnings remain.
- [x] Current Debug APK SHA-256 `5dd5e22353d00fc3a86a82aa7eb3384b487729a77f0945b99a857a819ed161a3`; installed successfully on all three authorized devices. Current focused web (8/8), workspace typecheck, web production build, and full Android test/build/lint/check passed.
- [x] Panels use the user's local `corepack pnpm dev`; no remote deployment. Before the latest APK, `.246` reported `request=true,eligible=true`; brightness stepped 0.8→0.75→0.70 every 30 seconds and power remained `Awake`. New 5% floor/blackout visual result still needs on-device confirmation.
- [x] User confirmed both physical buttons respond before this update. ROOM-SAVER-21 now contains the black app overlay, red active DND hint, triangular markers, and 5% floor; visual confirmation of these new states is pending.
- [x] Fixed the reported locale-dependent noon rendering by pinning `h12`/`h23`; added a deterministic Spanish `h11` regression. Focused tests passed (62/62) and `git diff --check` passed.
- [x] Prior thermal comparison found the former `.243` about 10–11°C hotter than `.121`, with sustained CPU only on `.243`; this was correlation, not a proven cause. The former `.243` automatic-time setting also reverted to `0`; the cause remains unknown. See ROOM-SAVER-10/11 for evidence.
- [ ] Work-unit commits remain pending because the chain-strategy question is unanswered; no push, PR, merge, or remote deployment has occurred.

## Next Step

ROOM-SAVER-21 implementation and installation are complete; ROOM-SAVER-22's web formatter fix and checks are complete. The user can confirm the corrected Spanish 12-hour display through the local development server, with no APK rebuild or remote deployment. Visual confirmation of the ROOM-SAVER-21 controls and blackout remains pending. No work-unit commit was made; preserve the existing commit gate and unrelated dirty work.

## Relevant Files

- apps/web/src/features/device/InformationCarousel.tsx — Información idle lifecycle and screensaver phase.
- apps/web/src/features/device/DeviceScreen.tsx — ROOM composition, background, server clock, and per-device locale.
- apps/web/src/features/device/RoomScreensaver.tsx — in-app saver rendering.
- tests/unit/information-carousel.test.ts — idle/cycle/cancellation tests.
- tests/unit/device-screen.test.ts — ROOM composition and configuration tests.
- apps/web/src/styles.css — shared responsive styles; preserve existing edits.
- apps/web/src/i18n.tsx — per-device locale and translated messages.
- apps/web/src/native-bridge.ts — TypeScript WebView bridge contract.
- apps/server/src/domain/hotel-service.ts — settings persistence and device snapshot construction.
- apps/server/src/http/app.ts — admin settings and device routes.
- apps/server/src/db/connection.ts — migration registration and schema version.
- packages/shared/src/domain.ts — global setting keys/defaults/validation.
- packages/shared/src/dto.ts — setting and device configuration contracts.
- apps/web/src/features/admin/SetupPanels.tsx — admin settings controls.
- apps/android-notification-receiver/app/src/main/java/com/hotelalert/notificationreceiver/MainActivity.kt — ROOM Activity focus, keep-awake, and window-brightness policy.
- apps/android-notification-receiver/app/src/main/java/com/hotelalert/notificationreceiver/RoomScreenBrightnessPolicy.kt — current manual/automatic brightness behavior.
- apps/android-notification-receiver/app/src/main/java/com/hotelalert/notificationreceiver/web/NativeWebViewBridge.kt — native bridge implementation.
- apps/android-notification-receiver/app/src/test/java/com/hotelalert/notificationreceiver/RoomScreenBrightnessPolicyTest.kt — brightness policy tests.
