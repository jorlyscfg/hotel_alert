# Admin Queue: Do Not Disturb and Responsible Attribution

## Objective

Extend Admin's live queue with active Do Not Disturb rooms and make the human responsible for each started request required, persisted, and visible throughout its lifecycle.

## Problem and Why

Administrators currently cannot see active room-level Do Not Disturb states in the live queue. Request transitions record the device or administrator actor, but not the human attendant responsible for service, leaving later operational review without that attribution. The Area web console and Android notification quick action have separate start paths, so both must collect the same required name.

## Scope

- Add an Admin queue tab named No molestar / Do Not Disturb after Completed, with the active-room count badge and room activation ages/severity matching the Area console.
- Use only active DND rooms with an active, registered ROOM-assigned device, matching the existing Area eligibility filter.
- Reuse the Area activation-age behavior: dark-gray baseline, yellow at 1 hour, red at 3 hours; preserve the existing 1h/3h thresholds and update displayed ages and tab severity while active.
- Require a non-blank Responsible name before any transition into IN_PROGRESS; the start button stays disabled until valid. Route all Area start paths, including Android notification quick-start, through the same required form rather than bypassing attribution.
- Persist the entered person name atomically with the IN_PROGRESS transition, expose it through request DTO/realtime/history data, and display it wherever the request is shown in Area and Admin. Preserve station/admin actor identity separately.
- Keep historical requests with no recorded attendant as null and show a neutral localized fallback; do not infer a person from a station or actor ID.
- Add database migration, validation, English/Spanish UI copy, and regression tests.
- Log failed HTTP requests in the server terminal as safe structured records keyed by the server request ID; preserve that server request ID across the Android native command bridge and show a short reference with the Area error on the tablet.
- Error diagnostics must never include authorization headers/tokens, request bodies or submitted field values, the Responsible person's name, raw exception messages, or stacks. In addition to method, matched route template, status, error code/class, request ID, and severity, include only allowlisted, sanitized validation paths and issue codes/categories when available.
- No APK installation, device operation, push, PR, merge, or deployment is included unless separately authorized within the remote-operation policy.

## Constraints and Decisions

- Strict TDD applies, based on the user's explicit confirmation for the Admin live-queue work. Use a failing test before each implementation slice, then pass and refactor.
- Test runner: `corepack pnpm exec vitest run`; full unit suite: `corepack pnpm test:unit`.
- Responsible is free-text entered by the operator, trimmed and required; use the existing bounded-name convention (maximum 120 characters) unless code validation reveals a safer existing limit.
- Responsibility is written only when the request starts, in the same persisted transition as status/timestamp. The authenticated device/admin actor remains separate audit metadata.
- Legacy active and completed requests without a recorded name remain unassigned; no backfill.
- For DND severity, honor the user's earlier explicit correction that the initial tier is dark gray, not green. Keep the existing 1-hour yellow and 3-hour red thresholds.
- Preserve all existing staged/unstaged/untracked changes. Never stage broadly or attempt to bypass read-only `.git` metadata.
- Diagnostic logging is structured and privacy-minimized: no request body, auth material, raw exception message, or Responsible PII. Use the server-generated request ID to correlate the terminal log and tablet reference.
- The user has explicitly authorized installing rebuilt APKs with `adb install -r` on the AREA tablet serial `R9PT70GX3PA`, ROOM device `192.168.0.243:44999`, and the new ROOM device `192.168.0.121` for future updates. The user reports the new device already has the latest APK. The user supplied the pairing details; pairing at `192.168.0.121:36989` succeeded, connecting at `192.168.0.121:36259` succeeded, and `adb -s 192.168.0.121:36259 get-state` returned `device`. Do not persist the temporary pairing code; the connection port may change. Do not change device settings or launch the app unless separately requested.
- Selected delivery strategy: `feature-branch-chain`, previously selected by the user. Estimated authored change volume: approximately 900 lines across schema/API, backend persistence, Area/Admin/native start flow, displays, localization, and tests (generated files excluded).

## Authorized Scope

Local source, migration, tests, and this ODD task document in the current repository. Android source may be changed to route its quick-start action to the required form. APK installation is authorized for the three named devices; `192.168.0.121` is now paired and reachable via the user-authorized ADB session.

## Acceptance Criteria

1. Admin queue tabs appear in order: Pending, In progress, Completed, No molestar / Do Not Disturb.
2. The DND tab shows a count badge only when active eligible rooms exist, and its count/color, cards, activation age, and age-severity tiers match the Area console.
3. DND changes update the Admin snapshot in real time; the room list excludes rooms without a currently active registered ROOM station.
4. Starting a request from any Area or Android quick-start path requires a trimmed non-empty Responsible value; the start action remains disabled until supplied.
5. The responsible name is persisted atomically with the IN_PROGRESS transition and returned to Admin/Area views and request history/realtime consumers. Existing actor IDs continue to identify the authenticated device/admin.
6. New responsible names appear in all request cards/rows/details; old requests with no recorded name display a localized neutral fallback.
7. Migration, validation, DND eligibility/timing, server persistence/realtime, start-path bypass prevention, display, and English/Spanish copy have regression coverage; relevant tests/typechecks/builds pass.
8. Failed API requests produce a structured terminal log containing the server request ID, HTTP method, matched route template, status, error code/class, and severity, without credentials or request payload; the tablet's Area error presents a safe reference that matches the server log.
9. Validation failures include enough allowlisted field-path and issue-code/category context to identify the rejected input, without logging values, credentials, raw exception messages, stacks, or Responsible PII.

## Tasks

## Route and Trigger Evidence

- **ARD-01 — delegated direct**. CodeGraph-first mapping completed in `admin_queue_dnd_owner_map`. Mapping trigger: DND activation flows through snapshot, realtime, DTO, and two console views (4+ files). Writer trigger: Admin snapshot, reusable timing presentation, UI, styles, localization, and tests span multiple non-trivial files.
- **ARD-02 — delegated direct**. CodeGraph-first mapping completed. Mapping trigger: responsible attribution crosses schema/migration, shared DTO/validation, service/API/idempotency/history/realtime, Area UI, Android quick action, Admin, and tests (4+ files). Writer trigger: persistence and required capture each touch multiple non-trivial files; implement as separate bounded work units.
- **ARD-03 — delegated direct**. Mapping trigger: responsible attribution and Android quick-start routing span Area UI, Android activity/WebView/notification commands, Admin/history views, localization, and tests (4+ files). Writer trigger: implementation and behavior tests touch multiple non-trivial files.
- **ARD-04 — delegated direct investigation; implementation not selected yet**. Mapping trigger: the two new live-runtime failures span persisted DND/request state, realtime publication and subscription, snapshot endpoints, and Area/Admin clients (4+ files). Choose the implementation route only after the runtime failure is reproduced; a multi-file fix requires a delegated writer.
- **ARD-05A — delegated direct**. Add privacy-minimized terminal logging for HTTP errors and focused server tests. Mapping trigger: Express error middleware, request context/route metadata, and server tests cross multiple files; writer trigger: logging behavior plus tests touch non-trivial files.
- **ARD-05B — delegated direct**. Carry the server request ID through Android HTTP parsing, native command result/status, WebView bridge, and Area UI error reference with regression tests. Mapping trigger: this protocol crosses Kotlin network/protocol/bridge and TypeScript bridge/API/screen/tests (4+ files); writer trigger: Android and web behavior/tests require multiple files.
- **ARD-05B APK build/install completion — direct (resume)**. Bounded verification and deployment step with no source edits; ran the existing Android unit-test/build tasks and installed only to the two previously authorized ADB targets. No mapping or writer trigger applied.
- **ARD-05C — delegated direct**. Enrich validation-error logs with allowlisted field paths and issue codes/categories, never submitted values. Writer trigger: logger and privacy tests span two non-trivial files; CodeGraph mapping confirmed `createHttpErrorHandler` is covered by `tests/unit/http-error-logging.test.ts`.

### ARD-01 — Add live DND rooms to Admin queue

- [x] Add failing Admin snapshot/tab tests for eligibility, count, activation age, severity boundaries, and live refresh (RED observed before source edits).
- [x] Expose the existing active-device-filtered DND room list in the Admin snapshot and add the DND tab/cards using the Area timing tiers and dark-gray baseline.
- [x] Verify realtime room updates and localization. CodeGraph confirmed `room.updated` is a reactive realtime event that schedules snapshot refresh; `listActiveDoNotDisturbRooms()` applies the registered active ROOM-station filter.
- [x] Focused tests passed: `corepack pnpm exec vitest run tests/unit/hotel-service.test.ts tests/unit/admin-screen.test.ts tests/unit/area-dnd-tab.test.ts` (81 tests).
- [x] Full unit suite passed: `corepack pnpm test:unit` (49 files, 535 tests); the ARD-01 implementation worker also observed workspace typecheck, web/server builds, directed ESLint, and `git diff --check` passing (existing bundle-size warning only).
- [ ] Create isolated work-unit commit and record its ID when Git metadata is writable.

### ARD-02 — Persist Responsible at the start transition

- [x] Add failing migration, validation, and service/API tests for trimmed required responsible names and atomic start-transition persistence; RED was observed for absent schema/version and missing domain enforcement.
- [x] Add nullable request/history storage and DTO support plus a strict start schema; include the normalized value in start idempotency and history/audit/realtime payloads without replacing authenticated actor identity. Legacy rows remain NULL.
- [x] Focused GREEN passed: `corepack pnpm exec vitest run tests/unit/responsible-name-migration.test.ts tests/unit/validation.test.ts tests/unit/hotel-service.test.ts` (42 tests); full unit suite passed (50 files, 538 tests). Worker also verified workspace typecheck, server/web builds, directed ESLint, and `git diff --check`.
- [ ] HTTP/API and realtime integration assertions remain pending: test startup fails before assertions because this sandbox denies loopback binds (`listen EPERM`).
- [ ] Create isolated work-unit commit and record its ID when Git metadata is writable.

### ARD-03 — Require and show Responsible across operator/admin flows

- [x] Add failing UI tests for the disabled-until-valid Area start modal, all start entry points, and the Android notification quick-start route (RED observed before source edits).
- [x] Funnel Area and Android start actions through the required responsible-name form; the submit button stays disabled for blank/whitespace-only input, and the server/native start command also rejects a missing value.
- [x] Show the responsible name (or localized unassigned fallback) in Area/Admin request cards, lists, and history; request lifecycle rows retain the attribution alongside the request.
- [x] Focused tests passed (64 tests); parent full unit suite passed: `corepack pnpm test:unit` (50 files, 543 tests). Worker also verified `pnpm typecheck`, web build, `pnpm lint`, and `git diff --check`.
- [ ] Follow-up required: user reports that in the running system neither active DND appears in Admin's live queue nor the entered Responsible appears on the Area/Admin request after start. Re-open live end-to-end verification; the prior unit suite does not validate the actual deployed socket/server/APK combination.
- [ ] HTTP/API and realtime integration assertions remain pending: test startup fails before assertions because this sandbox denies loopback binds (`listen EPERM`).
- [ ] Android Gradle unit tests remain pending. Located and sourced `~/.local/share/hotel-alert-env/android-toolchain.sh`; it supplies JDK 17 and Android SDK API 35. Gradle 8.9 fails before compilation because this execution sandbox denies socket creation (`java.net.SocketException: Operation not permitted`). Several supported `--no-daemon`/JVM-option alignment attempts still forked a single-use daemon; local Gradle 8.9 lock code also creates a UDP socket. No supported socket-free invocation was identified.
- [ ] Create isolated work-unit commit and record its ID when Git metadata is writable.

### ARD-05 — Make request failures diagnosable from server and tablet

- [x] ARD-05A: Added a failing test first (RED observed), then structured safe metadata for handled client and server errors using the server request ID; no tokens, request bodies, raw messages, stacks, or Responsible names are logged.
- [x] ARD-05A: `corepack pnpm exec vitest run tests/unit/http-error-logging.test.ts` passed (2 tests); server typecheck, directed ESLint, and `git diff --check` passed. HTTP integration remains blocked before assertions by sandbox `listen EPERM` (18 setup failures).
- [ ] ARD-05A: Create isolated work-unit commit when `.git` is writable; do not bypass read-only metadata.
- [x] ARD-05C: Added a failing redaction/validation-context test first (RED observed), then extended terminal records with bounded validation issue count, omitted count, allowlisted field paths, normalized issue codes, and categories. Unknown field names/values are not echoed; the HTTP response shape is unchanged.
- [x] ARD-05C follow-up: Added allowlisted diagnostics for Zod body issues and known 422 `AppError` paths: invalid `requestId` parameter, missing/invalid `Idempotency-Key`, and the domain Responsible-name guard. Logs contain only normalized paths/codes/categories and bounded counts, never field values, raw messages, headers, or attached error details.
- [x] ARD-05C verification: Focused logger suite passed (7 tests); server typecheck/build, directed ESLint, and `git diff --check` passed. The HTTP response shape remains unchanged.
- [ ] ARD-05C: Create isolated work-unit commit when `.git` is writable; do not bypass read-only metadata.
- [x] ARD-05B: Added failing native/web tests first (RED observed), then preserved validated `serverRequestId` through Android HTTP parsing, command result/status, WebView bridge, and the TypeScript error; localized the short safe reference in the Area message.
- [x] ARD-05B TypeScript verification: focused Vitest passed (83 tests in worker run; parent rerun passed 85 tests across 4 files), web typecheck, focused ESLint, and `git diff --check` passed.
- [x] ARD-05B Android unit tests/build and APK packaging: sourced `~/.local/share/hotel-alert-env/android-toolchain.sh` (JDK 17.0.20, Android SDK API 35) and ran `./gradlew --no-daemon testDebugUnitTest assembleDebug`; `BUILD SUCCESSFUL` in 34 seconds. The earlier socket-denial did not recur in this execution context. Kotlin emitted existing deprecation warnings for WebView file-URL access flags; no build errors.
- [x] ARD-05B APK installed with `adb install -r` on the authorized AREA tablet `R9PT70GX3PA` and ROOM device `192.168.0.243:44999`; both commands returned `Success`. The app was not launched and device settings were not changed.
- [x] APK artifact: `apps/android-notification-receiver/app/build/outputs/apk/debug/app-debug.apk`, 9,586,746 bytes, SHA-256 `2d3e0e7a3bbc4e49705b9f005310230a13aac4f6b0dd3ac60bb87987179be5f0`.
- [ ] Create isolated work-unit commits for ARD-05A and ARD-05B when `.git` is writable; do not bypass read-only metadata.

## Verification

- TDD: strict; source: explicit user confirmation for the related Admin live-queue corrections.
- Focused Vitest runner: `corepack pnpm exec vitest run` with the affected Admin, Area DND, service, migration, API, realtime, and notification-action tests.
- Full functional suite: `corepack pnpm test:unit`; include integration tests if request transition/realtime protocol changes require them.
- Run workspace typecheck and applicable web/server/Android source builds, directed ESLint, and `git diff --check` per task.
- Receipt-driven development is disabled by the existing clone-local preference; do not start review/assessment.
- Check existing mixed staged/unstaged/untracked state before and after each work unit; do not stage or revert unrelated paths.

## Progress and Evidence

- [x] User authorized both feature additions.
- [x] User confirmed Android notification quick-start must also require the Responsible field; starting remains unavailable until the field is filled.
- [x] CodeGraph-first mapping completed; confirmed DND timestamps and AREA eligibility filter already exist, and Admin snapshot currently lacks the DND list.
- [x] Confirmed Android notification action is a separate direct IN_PROGRESS path and must be routed through the required form.
- [x] ARD-01 implementation and verification; source/test/checks complete, commit pending because `.git` metadata is read-only.
- [x] ARD-02 implementation and local verification; HTTP/realtime integration tests and commit remain pending due sandbox limitations.
- [x] ARD-03 implementation and local verification; HTTP/realtime integration tests, Android Gradle tests, and commit remain pending due environment/runtime limitations.
- [ ] ARD-04: reproduce both user-reported failures against the exact running server/client build; add behavior-level event-to-snapshot-to-render regression coverage; implement only the confirmed fault; verify the running configuration when explicitly authorized.
- [x] ARD-05A: Server error logging implementation and local focused verification complete; commit pending because `.git` is read-only. No remote server/device accessed.
- [x] ARD-05B: Native-to-tablet request ID propagation and localized reference implemented; TypeScript checks passed. Android `testDebugUnitTest` and `assembleDebug` now pass, and the fresh APK was installed successfully on both authorized devices. No source was edited in this packaging/install resume.
- [x] User added ROOM device `192.168.0.121` to future APK update scope and reported the latest APK is already installed there. Paired with user-supplied temporary details and verified ADB state `device` at `192.168.0.121:36259`; the pairing code is intentionally not retained.
- [x] ARD-05C: User authorized richer terminal diagnostics after the first 422 log; implemented safe diagnostic fields for all known request-start 422 sources with TDD. Raw request/error data remains excluded.
- [ ] ARD-05: Android Gradle tests/build, APK packaging, and authorized two-device install are complete. Remaining: create the isolated ARD-05 work-unit commits when Git metadata permits; use the installed APK and safe server request reference to continue ARD-04 runtime diagnosis. Route for implementation: delegated direct; build/install resume: direct; triggers are recorded above.
- [ ] All work-unit commits (pending writable `.git` metadata; do not bypass runtime restrictions).

## Next Step

Include paired ROOM device `192.168.0.121` in future authorized APK installs; its last verified ADB connection was `192.168.0.121:36259` (port may change). The user reports the latest APK is already installed there. Continue ARD-04 by reproducing the live DND/Responsible failures and correlating the safe tablet request reference with `validation.issues`. Do not access/update the server or other devices without separate authorization. HTTP integration and work-unit commits remain pending under existing sandbox/Git constraints.

## Relevant Files

- `apps/server/src/domain/hotel-service.ts` — Admin snapshot, DND active-room eligibility, request transition/storage/mapping.
- `apps/server/src/http/app.ts`, `apps/server/src/main.ts` — HTTP error handling and server runtime; add privacy-minimized diagnostic logging.
- `tests/unit/http-error-logging.test.ts` — terminal error-log shape, validation context, and redaction coverage.
- `apps/android-notification-receiver/app/src/main/java/com/hotelalert/notificationreceiver/network/HttpDeviceRequestCommandClient.kt`, `protocol/NativeRequestCommands.kt`, `web/NativeWebViewBridge.kt` — preserve server error request ID across native command status.
- `apps/server/src/db/connection.ts` and `apps/server/src/db/migrations/` — migration registration and schema evolution.
- `packages/shared/src/dto.ts`, `packages/shared/src/validation.ts` — request and admin snapshot contracts/validation.
- `apps/web/src/features/device/DeviceScreen.tsx` — Area start modal, request cards, and DND tab/timing behavior.
- `apps/web/src/features/admin/AdminScreen.tsx` — Admin live queue tab, request display, and history.
- `apps/web/src/features/admin/admin-request-timing.ts` — Admin elapsed-age formatting.
- `apps/web/src/app-model.ts`, `apps/web/src/native-bridge.ts` — web DTO validation and native command bridge.
- `apps/web/src/api.ts`, `apps/web/src/features/device/DeviceScreen.tsx` — map native error code and display the server request reference safely.
- `apps/android-notification-receiver/app/src/main/java/com/hotelalert/notificationreceiver/` — Android notification action and WebView behavior.
- `apps/web/src/i18n.tsx`, `apps/web/src/styles.css` — localized labels and DND/responsible presentation.
- `tests/unit/area-dnd-tab.test.ts`, `tests/unit/admin-screen.test.ts`, `tests/unit/hotel-service.test.ts`, `tests/integration/http-api.test.ts`, `tests/integration/realtime.test.ts` — focused regressions and protocols.
