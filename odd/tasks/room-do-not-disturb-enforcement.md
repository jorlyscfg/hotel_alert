# Room Do Not Disturb Enforcement

## Objective
Enforce room-level Do Not Disturb for customer service requests and keep area-console Do Not Disturb indicators consistent with registered ROOM-station assignments.

## Problem and Why
The room DND flag is persisted and exposed, but a client can still submit service requests while it is enabled. The area snapshot also includes active DND rooms without checking for a currently registered ROOM station, and a room can retain DND after its station is moved or removed.

## Authorized Scope
- Disable room service actions while DND is enabled and reject new requests for a DND room on the server.
- Show active DND rooms in area consoles only when a non-retired, active ROOM station remains assigned to that room.
- Clear the former room's DND state when its station is reassigned, deactivated, or retired; publish the room update so clients refresh the indicator.
- Refresh native AREA station snapshots on `room.updated`, so DND changes reach the area console without requiring a restart.
- Keep service and area controls visibly disabled during DND while allowing taps to open an explanatory modal; preserve server-side request rejection.
- Add/update focused tests with the behavior. No Android notification-policy, schema, or unrelated UI changes.

## Constraints
- Preserve all pre-existing working-tree and index changes. The current branch is `jorlys/feat/lan-notification-agent`, and the worktree already contains extensive unrelated changes, including edits to some target files. Do not stage, revert, or commit unrelated hunks/files.
- User explicitly selected strict TDD: observe focused tests fail before production edits, then pass, then refactor.
- Web test runner: `corepack pnpm exec vitest run <focused test files>`; full unit suite: `corepack pnpm test:unit`. Android DND-03 runner: from `apps/android-notification-receiver`, `./gradlew :app:testDebugUnitTest --tests com.hotelalert.notificationreceiver.AndroidLanReceiverTest`; it currently cannot start because Java/JAVA_HOME is unavailable.
- Project artifact language is English; user-facing copy must remain localized through existing English/Spanish i18n conventions.
- DND-01 and DND-02 are complete; this tracker and its Engram mirror are being extended for the newly authorized DND-03 and DND-04 follow-up fixes.

## Route and Delivery
- **Task DND-01 route:** delegated direct. Mapping trigger: the request spans UI, server, and tests (4+ files); a read-only explorer already mapped the feature and CodeGraph verified the request flow. Writer trigger: at least two non-trivial files.
- **Task DND-02 route:** delegated direct. Mapping trigger: assignment lifecycle and area snapshot span the service, event behavior, and tests (4+ files). Writer trigger: service and regression-test files.
- **Task DND-03 route:** delegated direct. Mapping trigger: native AREA refresh spans Android event handling, the WebView snapshot bridge, backend snapshots, and tests (4+ files). Writer trigger: receiver implementation and its regression tests.
- **Task DND-04 route:** delegated direct. Mapping trigger: room controls, modal behavior, localized copy, styles, and UI tests span 4+ files. Writer trigger: component, localization/styles, and interaction tests.
- **TDD:** strict, explicitly confirmed by the user for this correction; runner is Vitest through Corepack pnpm.
- **Forecast:** approximately 390 authored changed lines across this feature after DND-03 and DND-04, excluding generated files; expected to remain just under the ~400-line delivery budget. Reassess before each work-unit commit.
- **Delivery strategy:** `ask-on-risk` (default).
- **Receipt-driven development:** disabled by clone-local setting; report `disabled/unmanaged` and do not start reviews.

## Acceptance Criteria
- A room with DND enabled cannot start a new request from the client UI, and the server rejects a direct request attempt.
- Turning DND off restores the normal service-request flow.
- Area snapshots list only active DND rooms assigned to active, non-retired ROOM stations.
- Moving, deactivating, or retiring the ROOM station clears DND on the room it leaves and emits the room-state update; the room no longer appears in the area DND list.
- A native AREA station refreshes its snapshot after `room.updated`, and displays the active DND room without restarting.
- During DND, room service/area controls have a disabled visual and accessible state but still respond to taps by showing a localized explanation modal; no request dialog or request is opened.
- Existing unrelated worktree/index content remains untouched.

## Tasks
- [x] **DND-01 — Enforce DND for service requests.** Added a UI regression proving DND disables service/area choices and restores them when cleared, and a domain regression proving new requests are rejected while idempotent successful replays remain valid. Observed RED (both new tests failed; 80 existing focused tests passed), then GREEN/refactor (focused suite: 2 files / 82 tests; TypeScript `corepack pnpm exec tsc --noEmit --pretty false` passed). Work-unit commit: `ded3f4e` (`fix(dnd): enforce room do-not-disturb requests`).
- [x] **DND-02 — Scope and clear active DND rooms.** Added regressions for active ROOM-station filtering and stale DND cleanup on reassignment, deactivation, and retirement, including `room.updated` payloads. RED exposed both the leaking AREA list and uncleared room state. Focused GREEN: `corepack pnpm exec vitest run tests/unit/hotel-service.test.ts tests/unit/room-do-not-disturb.test.ts` passed (2 files / 36 tests); the complete DND focus suite passed (3 files / 84 tests). `corepack pnpm exec tsc --noEmit --pretty false`, `git diff --check`, and `corepack pnpm test:unit` (43 files / 468 tests) passed. Work-unit commit: `7bdf20c` (`fix(dnd): scope area alerts to assigned rooms`).
- [ ] **DND-03 — Refresh native AREA DND rooms.** Verified root cause: native AREA mode disables the web realtime subscription, while Android `AndroidLanReceiver.processEvent` acknowledges `room.updated` without refreshing its authoritative device snapshot; only config and request events trigger snapshot resync. Add a regression proving a DND room update refreshes the snapshot delivered through the WebView bridge, then fix and verify.
- [x] **DND-04 — Explain blocked service taps.** Added coverage for the accessible disabled markup, routing blocked service/area taps to the DND explanation rather than the request flow, and English/Spanish modal copy. Observed RED before production edits (3 new focused tests failed; 47 passed), then GREEN/refactor (focused checks: 3 files / 125 tests; `corepack pnpm exec tsc --noEmit --pretty false` passed). Full unit suite passed: 43 files / 470 tests. Work-unit commit: pending.

## Progress and Verification
- Exploration confirmed the room DND UI, request submission path, server `createRequest`, area snapshot DND list, and device assignment/retirement paths.
- Existing working-tree changes are present in the target files; implementation must preserve them and commits must include only this feature's hunks plus its tracker.
- DND-01 RED/GREEN evidence: observed and passed as recorded above.
- DND-01 functional/type checks: passed (82 focused tests; `tsc --noEmit`).
- DND-01 work-unit commit: `ded3f4e` (`fix(dnd): enforce room do-not-disturb requests`).
- DND-02 work-unit commit: `7bdf20c` (`fix(dnd): scope area alerts to assigned rooms`). Review status: disabled/unmanaged (RDD off by clone-local setting).
- DND-03 regression is drafted in `AndroidLanReceiverTest.kt`, but no RED result was observed: the Gradle wrapper exited before tests because `JAVA_HOME` is unset and no `java` executable is on `PATH`. No production code was changed; strict TDD remains pending until a local JDK is available.
- DND-04 RED/GREEN evidence: `corepack pnpm exec vitest run tests/unit/device-screen.test.ts` first failed 3 new regressions (47 passed) before source changes; then the device, i18n, and style focus passed (3 files / 125 tests). `corepack pnpm exec tsc --noEmit --pretty false`, `git diff --check`, and full `corepack pnpm test:unit` (43 files / 470 tests) passed. The DOM-less unit suite verifies the click-handler shared by service/area controls and localized modal markup.

## Next Step
Finish DND-03 with observed RED/GREEN once a local JDK is available, then verify both work units and update the Engram mirror before closing the feature. DND-04 is implemented and verified; its work-unit commit identity still needs to be recorded.

## Relevant Files
- `apps/web/src/features/device/DeviceScreen.tsx` — ROOM service actions and DND control.
- `apps/server/src/domain/hotel-service.ts` — request creation, area snapshot DND list, and device assignment lifecycle.
- `tests/unit/device-screen.test.ts` — ROOM client interaction regression tests.
- `tests/unit/hotel-service.test.ts` — server/domain behavior tests.
- `apps/android-notification-receiver/app/src/main/java/com/hotelalert/notificationreceiver/receiver/AndroidLanReceiver.kt` — native AREA snapshot resynchronization after durable room updates.
- `tests/unit/device-screen.test.ts` — ROOM service-control interaction and DND explanation modal coverage.
