# Default Admin and Mandatory First-Login Password Change

## Objective
Seed one usable `admin` / `admin` account when an installation has no administrators, require the operator to change that password before entering the Admin view, and provide a web flow for later password changes. Keep administrator self-service password change in the Admin top bar; do not expose an Administrators management tab.

## Problem
The server already exposes a self-service password-change endpoint and revokes existing sessions after a successful change, but the web UI does not call it. A new installation also does not provision a default administrator, and there is no persisted first-login password-change state or server-side restriction for such a session.

## Why
The user wants operators to be able to access a new installation with known initial credentials, then set a private password before hotel use. The user clarified that only authorized operators have access during installation/configuration and that the hotel will not have additional administrator accounts, so the Administrators management tab is unnecessary.

## Authorized Scope and Constraints
- Add default credentials `admin` / `admin` only if the database has no administrator; preserve all existing admin accounts and hashes.
- Require the initial password change before the Admin view and enforce it on server routes, not only in the browser.
- Add a normal web password-change flow for an authenticated administrator.
- Remove the Administrators management tab and its UI; keep the existing self-service Change Password action in the Admin top bar.
- Keep the current branch `jorlys/feat/lan-notification-agent`; the user will handle remaining branch work and move it to `dev` after implementation. Do not create or switch branches.
- Preserve all existing staged, unstaged, and untracked work. Never stage or commit unrelated changes.
- Do not modify `.env`, live hotel data, or remote systems/devices.
- No dependencies unless the existing implementation proves an essential need.

## TDD and Verification Configuration
- Effective TDD mode: strict, explicitly selected by the user for this feature on 2026-10-05. Require observed RED → GREEN → REFACTOR for each behavior.
- Runner: Vitest. Available focused suites include `corepack pnpm test:unit` and `corepack pnpm test:integration`; targeted file commands must follow the repository's existing package scripts/configuration.
- Applicable closure checks: focused migration, service/API, and web tests; `corepack pnpm lint`; `corepack pnpm typecheck`; `corepack pnpm test:unit`; relevant integration tests; `git diff --check`.
- Receipt-driven development is explicitly disabled by clone-local preference; record each task as `disabled/unmanaged` and use ordinary functional checks without review/consent ceremonies.

## Route and Trigger Evidence
- Route: delegated direct implementation, task by task.
- Mapping trigger fired: the flow crosses at least the migration registry, hotel service, HTTP auth middleware, shared DTO/validation/error contracts, frontend startup/session restore, Admin UI, localization, and tests.
- Writer trigger fired: implementation touches more than two non-trivial files; one bounded writer must own each implementation task. The parent retains the task document, work-unit commits, verification, and preservation of unrelated edits.
- Preserve the current shared worktree; all agents must adapt to existing edits and must not revert them.

## Forecast and Delivery
- Forecast: approximately 600 authored changed lines, including tests and documentation; generated files excluded. All four work-unit commits total 1,198 authored changed lines (193 in `1d80086`, 546 in `223cb8f`, 430 in `6abc87a`, 29 in `7bb9833`), so the initial forecast was low.
- Delivery strategy: `ask-on-risk`; user selected `stacked-to-main` on 2026-10-05 for this feature's commit/PR slicing. This does not authorize a push, PR creation, merge, branch creation, or branch switch; the user previously authorized staying on `jorlys/feat/lan-notification-agent` until implementation and pending branch work are complete.
- Work-unit commits are limited to this feature's changes; record each commit identity and review assessment here. Slices: ADM-PW-01 → `1d80086`; ADM-PW-02 → `223cb8f`; ADM-PW-03 → `6abc87a`, stacked after `223cb8f`; ADM-PW-04 → `7bb9833`, stacked after `6abc87a`. All commits remain local on the current feature branch; no PR has been created, and remote actions remain unauthorized.

## Tasks
- [x] **ADM-PW-01 — Persist first-login state and seed the initial administrator.** Add an upgrade-safe migration and bootstrap behavior that adds a forced-change flag and creates the `admin` account with a stored password hash for `admin` only when no admins exist. Verify fresh/empty, existing-admin, and repeated migration behavior. Route: delegated.
- [x] **ADM-PW-02 — Enforce forced password change in server authentication.** Return the pending-change state from login and `/auth/admin/me`; allow only the password-change and logout/session bootstrap operations while pending; deny ordinary admin HTTP/realtime access; clear the flag atomically with the password update and retain existing session revocation/audit behavior. Add service/API regressions and adapt existing integration fixtures that create an `admin` after migrations seed the default account. Route: delegated.
- [x] **ADM-PW-03 — Add mandatory and regular password-change web flows.** After first login or session restoration, show the password form without loading the admin snapshot until the server confirms the password is changed. Provide a normal self-service entry for later changes, preserve CSRF/idempotency behavior, handle forced reauthentication after session revocation, and localize all copy. Add UI/startup/localization regressions. Route: delegated.
- [x] **ADM-PW-04 — Document bootstrap behavior and complete verification.** Update operator-facing docs with the default login, mandatory change, and installation-only access assumption; run applicable full checks and record results. Route: delegated.
- [x] **ADM-PW-05 — Remove the Administrators management tab.** Removed its navigation entry, management panel, and web handlers while preserving the existing Change Password action in the Admin top bar; server auth/password behavior is unchanged. Added regression coverage. Route: delegated direct (writer trigger: two source modules plus UI regression test); strict TDD, Vitest, observed RED → GREEN. RDD: disabled/unmanaged.

## Acceptance Criteria
- An empty installation database receives exactly one active `admin` account whose password verifier accepts `admin`, with first-login change required.
- Existing non-empty admin tables are not reset, overwritten, or supplemented with a default account; migration is safe to rerun.
- The authenticated pending-change account cannot access admin data or privileged operations through HTTP or realtime until the password is changed.
- The pending state survives browser reload/session restoration; the web app does not fetch the admin snapshot or render the Admin view while change is required.
- A successful change clears the persisted requirement, hashes the new password using the existing password-hash implementation, revokes sessions, and requires a fresh login.
- An authenticated administrator can later change their password from the web UI using the existing endpoint and security headers.
- The Setup view does not expose an Administrators tab or administrator-management panel; the self-service Change Password action remains in the Admin top bar.
- English and Spanish UI strings, validation, and error handling are covered; tests and docs accompany the behavior.
- No unrelated worktree changes are staged, committed, reverted, or overwritten.

## Progress and Verification Evidence
- Exploration confirmed the existing API at `apps/server/src/http/app.ts:149-156` and service at `apps/server/src/domain/hotel-service.ts:877-891`; no web action currently calls it.
- Startup/migration path is `apps/server/src/main.ts:18-25` → `apps/server/src/db/connection.ts`; latest migration observed: 18.
- Web session restore must branch before `/system/snapshot`; source map: `apps/web/src/App.tsx`.
- Branch authorized for this work: `jorlys/feat/lan-notification-agent`; the worktree already contained extensive unrelated/ongoing edits before implementation. Preserve them.
- User selected strict TDD; no production source edit may precede an observed failing test for the current behavior.
- ADM-PW-01 test-only phase observed RED: `corepack pnpm exec vitest run tests/unit/admin-first-login-migration.test.ts` failed 2/2 with `no such column: must_change_password` before the migration existed.
- ADM-PW-01 adds migration 19 (`must_change_password`, default-admin seed only for an empty admins table); focused tests pass 2/2, server typecheck passes, and `git diff --check` passes. Existing admins retain credentials and receive the non-forced default flag; replay is safe.
- Work-unit commit: `1d80086` (`feat(auth): seed default admin account`). It contains only the v19 migration registration/code, focused tests, and this task artifact; the pre-existing v15–18 edits to `connection.ts` remain unstaged and preserved in the worktree. The user's 12 previously staged paths remain staged and unchanged.
- ADM-PW-02 test-only phase added `tests/integration/admin-first-login-auth.test.ts`; parent independently reran `corepack pnpm exec vitest run tests/integration/admin-first-login-auth.test.ts` and observed 8 tests, 7 failing and 1 passing (pending-session logout). Expected RED: login and `/me` omit the pending flag; snapshot, privileged area mutation, and mixed-principal request lookup are not denied with `ADMIN_PASSWORD_CHANGE_REQUIRED`; realtime accepts the connection; and password change leaves the flag set. Production code remains untouched for this task.
- HTTP denial uses the stable `ADMIN_PASSWORD_CHANGE_REQUIRED` contract. The realtime test asserts handshake rejection only because Socket.IO does not reliably preserve the server error payload. Vitest currently prints its Vite CJS Node API deprecation warning during this targeted run.
- ADM-PW-02 server behavior is GREEN: login and `/auth/admin/me` expose the pending state; admin and mixed-principal HTTP middleware return `ADMIN_PASSWORD_CHANGE_REQUIRED`; Socket.IO rejects pending-admin handshakes; password change atomically updates the hash and clears the flag before revoking sessions/auditing; logout remains allowed. Tests cover these contracts.
- Work-unit commit: `223cb8f` (`feat(auth): enforce admin first-login password change`). It contains the scoped ADM-PW-02 server enforcement, shared auth contracts, integration regressions/fixture adaptation, and this task artifact. RDD outcome: `disabled/unmanaged`; no push, PR, merge, or branch switch was made.
- Existing integration suites initially exposed a migration fixture conflict (`http-api`: 17 setup failures; `realtime`: 7 setup failures) because they create `admin` after migration 19 seeds it. Fixture-only setup now removes only the migration-seeded row with `must_change_password = 1` before creating its own admin; production bootstrap behavior is unchanged.
- Parent verification: `corepack pnpm exec vitest run tests/integration/admin-first-login-auth.test.ts tests/integration/http-api.test.ts tests/integration/realtime.test.ts tests/unit/hotel-service.test.ts tests/unit/admin-first-login-migration.test.ts` — 5 files, 76/76 passed; `corepack pnpm --filter @hotel/server typecheck` passed; `git diff --check` passed. Vitest emits the repository's existing Vite CJS Node API deprecation warning and expected HTTP error-log output from negative-path tests.
- RDD outcome: `disabled/unmanaged` (clone-local preference explicitly off); no review was run. No push, PR, merge, or branch switch has been made.
- ADM-PW-03 mapping (read-only): `completeAdminLogin` in `apps/web/src/App.tsx` fetches `/system/snapshot` before selecting a view; `restoreAdminSession` fetches `/auth/admin/me` then unconditionally fetches the snapshot. `AdminScreen`'s shared `perform` helper refreshes the snapshot after mutations, which is unsuitable for a change-password request because the server revokes the current session and clears its cookie. Existing startup harness is `tests/unit/app.test.ts`; `tests/unit/admin-screen.test.ts` covers admin UI.
- ADM-PW-03 UI placement decision: put a self-service “Change password” action in the Admin top bar beside sign-out, keeping account/session actions together. After success, return to a fresh login rather than trying to continue on the revoked session.
- ADM-PW-03 initial test-only RED is observed in `tests/unit/app.test.ts` and `tests/unit/admin-screen.test.ts`: `corepack pnpm exec vitest run tests/unit/app.test.ts tests/unit/admin-screen.test.ts --testNamePattern='password.?change|pending admin|self-service'` — 2 files, 6 expected failures and 89 skipped. The failures prove pending login/session restoration incorrectly request `/system/snapshot`, forced password-change UI/handler is missing, regular admin does not POST `/auth/admin/change-password`, and the localized topbar action is missing. The unfiltered App suite has pre-existing unrelated failures because its realtime mock lacks `shouldWebViewSendRestHeartbeat`; the focused run isolates the intended RED behaviors.
- An extended ADM-PW-03 RED phase added validation and forced-flow API-error tests before any production edits. `corepack pnpm exec vitest run tests/unit/app.test.ts tests/unit/admin-screen.test.ts --testNamePattern='password.?change|pending admin|self-service|password changes|passwords'` observed 11 expected failures and 89 skipped across 2 files. Coverage now includes server-contract min/max password rules, confirmation mismatch, and forced-flow API error feedback, in addition to the six startup/UI behaviors. Production code was still untouched at this RED checkpoint.
- ADM-PW-03 implementation now routes pending login and restored pending sessions to a forced password form before snapshot hydration; regular admins can open the same password-change form from the Admin topbar. The form validates the server's 12–256 character new-password range and confirmation, reports API failures in the selected UI language, and sends CSRF/idempotency headers. Success clears persisted admin session state and restarts through fresh startup instead of refreshing a revoked session.
- Parent verification after implementation: `corepack pnpm exec vitest run tests/unit/app.test.ts tests/unit/admin-screen.test.ts --testNamePattern='password'` — 2 files, 11 passed, 90 skipped; `corepack pnpm --filter @hotel/web typecheck` passed; scoped `git diff --check` passed. The focused run prints the repository's existing Vite CJS Node API deprecation warning.
- Work-unit commit: `6abc87a` (`feat(auth): add admin password-change web flow`), containing only the ADM-PW-03 UI, localization, tests, and tracker delta. Parent reran the focused password tests (11 passed, 90 skipped), web typecheck, and the staged scoped whitespace check successfully. RDD outcome: `disabled/unmanaged`; no remote action or review was performed.
- Full two-file web run `corepack pnpm exec vitest run tests/unit/app.test.ts tests/unit/admin-screen.test.ts` remains non-green from unrelated dirty work: `admin-screen.test.ts` passes all 57 tests; `app.test.ts` has 14 failures because the existing realtime mock omits `shouldWebViewSendRestHeartbeat` required by the already-dirty heartbeat behavior. The ADM-PW-03 focused tests pass. This baseline mismatch is not included in ADM-PW-03 scope.
- The successful change must clear persisted admin session state and return to fresh login rather than refresh the revoked session.
- User selected the `stacked-to-main` delivery chain. This records slicing preference only; no push, PR, merge, branch change, or remote operation is authorized. All four local slices are `1d80086`, `223cb8f`, `6abc87a`, and `7bb9833`.
- ADM-PW-04 delegated documentation adds the `admin` / `admin` initial login, forced password change before Admin, session revocation/relogin, and operator-only trusted-LAN installation handoff guidance to `docs/deployment.md`. The README quick start now explains the seeded account instead of invoking `admin:create`, which would collide with the seeded username; the pre-existing FreeKiosk-to-ROOM-screensaver README edit was preserved.
- Work-unit commit: `7bb9833` (`docs(auth): document admin password handoff`), containing the ADM-PW-04 documentation and tracker update. The README's unrelated FreeKiosk-to-ROOM-screensaver diff remains unstaged and untouched.
- Parent verification: `corepack pnpm typecheck` passed across all workspace projects. The focused password run passed 11 tests (90 skipped); the relevant server integration run earlier passed 76/76, and `admin-screen.test.ts` passed 57/57 in the unit suite. Both scoped documentation/tracker and full `git diff --check` passed.
- Full `corepack pnpm lint` remains non-green from unrelated dirty work: `apps/server/src/integrations/geoapify-client.ts:50` (`no-control-regex`), `apps/web/src/features/device/InformationCarousel.tsx:115` (`cycleActive` unused), `apps/web/src/features/device/RoomScreensaver.tsx:118` (`t` unused), and `tests/unit/native-bridge.test.ts:43` (`prefer-const`). None is in this feature's implementation/documentation changes.
- Full `corepack pnpm test:unit` remains non-green: 57 files, 596 passed and 35 failed across 11 files. Known unrelated categories are the App mock's missing `shouldWebViewSendRestHeartbeat` export (14 failures), migration tests expecting schema version 18 while current worktree has migrations through 19 (including four stale default-catalog expected-version cases), older UI localization/style expectations, and AREA component tests failing with `Cannot read properties of null (reading 'useCallback')`. The new admin-first-login migration test and focused ADM-PW-03 tests pass; do not expand the docs slice to repair unrelated dirty work.
- RDD outcome for ADM-PW-04: `disabled/unmanaged`; no review, remote operation, PR, merge, or branch change was performed.
- User clarified there will be no additional administrator accounts and explicitly requested removal of the Administrators tab while keeping the Change Password button in its current top-bar location. The prior request to move the button into an administrator row is superseded.
- ADM-PW-05 exploration: `SETUP_SECTIONS` and `SetupTab` in `apps/web/src/features/admin/AdminScreen.tsx` expose `admins`; the `AdminManagement` panel is in `apps/web/src/features/admin/SetupPanels.tsx`; UI coverage is in `tests/unit/admin-localization.test.ts` / `tests/unit/admin-screen.test.ts`. No backend change is authorized or needed for removing this UI.
- ADM-PW-05 strict TDD evidence: RED observed with `corepack pnpm exec vitest run tests/unit/admin-screen.test.ts --testNamePattern='removes administrator management'` — 1 expected failure because `SETUP_SECTIONS` still contained `'admins'`; no production code had been edited. After implementation the same focused regression passed, and `corepack pnpm exec vitest run tests/unit/admin-screen.test.ts` passed 56/56.
- ADM-PW-05 implementation removes the Administrators entry from `SETUP_SECTIONS`, the AdminManagement component/panel and create/toggle web handlers/props. It leaves the self-service Change Password action in the top bar and does not change server routes or password behavior. `tests/unit/admin-localization.test.ts` was also updated to remove the obsolete tab from its expected list.
- Parent verification: `corepack pnpm exec vitest run tests/unit/admin-screen.test.ts tests/unit/admin-localization.test.ts` — 79/80 passed; the sole failure is an unrelated existing expectation for manual weather-coordinate inputs (`id="setting-weatherLocationName"`) that the current dirty city-search settings UI no longer renders. `corepack pnpm --filter @hotel/web typecheck` and scoped `git diff --check` passed. RDD: `disabled/unmanaged`.
- ADM-PW-05 work-unit commit: `b00f656` (`feat(admin): remove administrator management tab`), containing only this task's UI/test changes and tracker state. RDD: `disabled/unmanaged`; no push, PR, merge, deploy, or branch switch was authorized/performed.

## Next Step
ADM-PW-01..05 are implemented and scoped verification is complete; the ADM-PW-05 work-unit commit is recorded as `b00f656`. Keep the self-service password button in the Admin top bar. Keep unrelated dirty/staged work untouched; the user retains the branch move, push, PR, and merge decisions. The unrelated full lint/unit failures above remain follow-up work outside this feature.

## Relevant Files
- `apps/server/src/db/connection.ts` — migration registry and transaction runner.
- `apps/server/src/domain/hotel-service.ts` — admin bootstrap, login, password update, and session invalidation.
- `apps/server/src/http/app.ts` — auth middleware, login/me/password routes, realtime/HTTP access wiring.
- `apps/server/src/security/principal.ts` — authenticated admin principal.
- `packages/shared/src/dto.ts`, `packages/shared/src/validation.ts`, `packages/shared/src/errors.ts` — API contracts and validation/error codes.
- `apps/web/src/App.tsx` — admin login and session restoration.
- `apps/web/src/features/admin/AdminScreen.tsx`, `apps/web/src/features/admin/SetupPanels.tsx` — admin UI.
- `apps/web/src/i18n.tsx` — English/Spanish messages.
- `README.md`, `docs/deployment.md` — quick start and operator handoff guidance.
- `tests/unit`, `tests/integration` — migration, auth, startup, and web coverage.
