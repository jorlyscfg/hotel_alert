# Room Do Not Disturb Enforcement

## Objective
Enforce room-level Do Not Disturb for customer service requests and keep area-console Do Not Disturb indicators consistent with registered ROOM-station assignments.

## Problem and Why
The room DND flag is persisted and exposed, but a client can still submit service requests while it is enabled. The area snapshot also includes active DND rooms without checking for a currently registered ROOM station, and a room can retain DND after its station is moved or removed.

## Authorized Scope
- Disable room service actions while DND is enabled and reject new requests for a DND room on the server.
- Show active DND rooms in area consoles only when a non-retired, active ROOM station remains assigned to that room.
- Clear the former room's DND state when its station is reassigned, deactivated, or retired; publish the room update so clients refresh the indicator.
- Add/update focused tests with the behavior. No Android notification-policy, schema, or unrelated UI changes.

## Constraints
- Preserve all pre-existing working-tree and index changes. The current branch is `jorlys/feat/lan-notification-agent`, and the worktree already contains extensive unrelated changes, including edits to some target files. Do not stage, revert, or commit unrelated hunks/files.
- User explicitly selected strict TDD: observe focused tests fail before production edits, then pass, then refactor.
- Exact test runner: `corepack pnpm exec vitest run <focused test files>`; full unit suite: `corepack pnpm test:unit`.
- Project artifact language is English; user-facing copy must remain localized through existing English/Spanish i18n conventions.
- Engram mirror is pending because the user asked to prioritize these corrections before returning to Engram. Do not claim it is saved.

## Route and Delivery
- **Task DND-01 route:** delegated direct. Mapping trigger: the request spans UI, server, and tests (4+ files); a read-only explorer already mapped the feature and CodeGraph verified the request flow. Writer trigger: at least two non-trivial files.
- **Task DND-02 route:** delegated direct. Mapping trigger: assignment lifecycle and area snapshot span the service, event behavior, and tests (4+ files). Writer trigger: service and regression-test files.
- **TDD:** strict, explicitly confirmed by the user for this correction; runner is Vitest through Corepack pnpm.
- **Forecast:** approximately 250 authored changed lines, excluding generated files; expected under the ~400-line delivery budget.
- **Delivery strategy:** `ask-on-risk` (default).
- **Receipt-driven development:** disabled by clone-local setting; report `disabled/unmanaged` and do not start reviews.

## Acceptance Criteria
- A room with DND enabled cannot start a new request from the client UI, and the server rejects a direct request attempt.
- Turning DND off restores the normal service-request flow.
- Area snapshots list only active DND rooms assigned to active, non-retired ROOM stations.
- Moving, deactivating, or retiring the ROOM station clears DND on the room it leaves and emits the room-state update; the room no longer appears in the area DND list.
- Existing unrelated worktree/index content remains untouched.

## Tasks
- [x] **DND-01 — Enforce DND for service requests.** Added a UI regression proving DND disables service/area choices and restores them when cleared, and a domain regression proving new requests are rejected while idempotent successful replays remain valid. Observed RED (both new tests failed; 80 existing focused tests passed), then GREEN/refactor (focused suite: 2 files / 82 tests; TypeScript `corepack pnpm exec tsc --noEmit --pretty false` passed). Commit evidence: pending.
- [ ] **DND-02 — Scope and clear active DND rooms.** Add failing tests, observe RED, restrict the area snapshot's active-DND query to active/non-retired ROOM assignments, clear and publish the old room's DND state on reassignment/deactivation/retirement, then verify GREEN and refactor. Focused files: `apps/server/src/domain/hotel-service.ts` and focused server tests. Commit evidence: pending.

## Progress and Verification
- Exploration confirmed the room DND UI, request submission path, server `createRequest`, area snapshot DND list, and device assignment/retirement paths.
- Existing working-tree changes are present in the target files; implementation must preserve them and commits must include only this feature's hunks plus its tracker.
- DND-01 RED/GREEN evidence: observed and passed as recorded above.
- DND-01 functional/type checks: passed (82 focused tests; `tsc --noEmit`).
- Work-unit commits and review status: pending; RDD is disabled/unmanaged.

## Next Step
Commit DND-01 with only its isolated hunks, then delegate DND-02 under strict TDD to scope area-console DND indicators and clear stale room state on station lifecycle changes.

## Relevant Files
- `apps/web/src/features/device/DeviceScreen.tsx` — ROOM service actions and DND control.
- `apps/server/src/domain/hotel-service.ts` — request creation, area snapshot DND list, and device assignment lifecycle.
- `tests/unit/device-screen.test.ts` — ROOM client interaction regression tests.
- `tests/unit/hotel-service.test.ts` — server/domain behavior tests.
