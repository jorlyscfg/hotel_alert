# Default Admin and Mandatory First-Login Password Change

## Objective
Seed a usable `admin` / `admin` account when an installation has no administrators, require the operator to change that password before entering the Admin view, and provide a web flow for later password changes.

## Problem
The server already exposes a self-service password-change endpoint and revokes existing sessions after a successful change, but the web UI does not call it. A new installation also does not provision a default administrator, and there is no persisted first-login password-change state or server-side restriction for such a session.

## Why
The user wants operators to be able to access a new installation with known initial credentials, then set a private password before hotel use. The user clarified that only authorized operators have access during installation/configuration.

## Authorized Scope and Constraints
- Add default credentials `admin` / `admin` only if the database has no administrator; preserve all existing admin accounts and hashes.
- Require the initial password change before the Admin view and enforce it on server routes, not only in the browser.
- Add a normal web password-change flow for an authenticated administrator.
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
- Forecast: approximately 600 authored changed lines, including tests and documentation; generated files excluded. Update with observed work-unit commit totals.
- Delivery strategy: `ask-on-risk`; user selected `stacked-to-main` on 2026-10-05 for this feature's commit/PR slicing. This does not authorize a push, PR creation, merge, branch creation, or branch switch; the user previously authorized staying on `jorlys/feat/lan-notification-agent` until implementation and pending branch work are complete.
- Work-unit commits are limited to this feature's changes; record each commit identity and review assessment here.

## Tasks
- [ ] **ADM-PW-01 — Persist first-login state and seed the initial administrator.** Add an upgrade-safe migration and bootstrap behavior that adds a forced-change flag and creates the `admin` account with a stored password hash for `admin` only when no admins exist. Verify fresh/empty, existing-admin, and repeated migration behavior. Route: delegated.
- [ ] **ADM-PW-02 — Enforce forced password change in server authentication.** Return the pending-change state from login and `/auth/admin/me`; allow only the password-change and logout/session bootstrap operations while pending; deny ordinary admin HTTP/realtime access; clear the flag atomically with the password update and retain existing session revocation/audit behavior. Add service/API regressions. Route: delegated.
- [ ] **ADM-PW-03 — Add mandatory and regular password-change web flows.** After first login or session restoration, show the password form without loading the admin snapshot until the server confirms the password is changed. Provide a normal self-service entry for later changes, preserve CSRF/idempotency behavior, handle forced reauthentication after session revocation, and localize all copy. Add UI/startup/localization regressions. Route: delegated.
- [ ] **ADM-PW-04 — Document bootstrap behavior and complete verification.** Update operator-facing docs with the default login, mandatory change, and installation-only access assumption; run applicable full checks and record results. Route: delegated for any multi-file implementation, otherwise inline for doc/check coordination.

## Acceptance Criteria
- An empty installation database receives exactly one active `admin` account whose password verifier accepts `admin`, with first-login change required.
- Existing non-empty admin tables are not reset, overwritten, or supplemented with a default account; migration is safe to rerun.
- The authenticated pending-change account cannot access admin data or privileged operations through HTTP or realtime until the password is changed.
- The pending state survives browser reload/session restoration; the web app does not fetch the admin snapshot or render the Admin view while change is required.
- A successful change clears the persisted requirement, hashes the new password using the existing password-hash implementation, revokes sessions, and requires a fresh login.
- An authenticated administrator can later change their password from the web UI using the existing endpoint and security headers.
- English and Spanish UI strings, validation, and error handling are covered; tests and docs accompany the behavior.
- No unrelated worktree changes are staged, committed, reverted, or overwritten.

## Progress and Verification Evidence
- Exploration confirmed the existing API at `apps/server/src/http/app.ts:149-156` and service at `apps/server/src/domain/hotel-service.ts:877-891`; no web action currently calls it.
- Startup/migration path is `apps/server/src/main.ts:18-25` → `apps/server/src/db/connection.ts`; latest migration observed: 18.
- Web session restore must branch before `/system/snapshot`; source map: `apps/web/src/App.tsx`.
- Branch authorized for this work: `jorlys/feat/lan-notification-agent`; the worktree already contained extensive unrelated/ongoing edits before implementation. Preserve them.
- User selected strict TDD; no production source edit may precede an observed failing test for the current behavior.
- ADM-PW-01 test-only phase observed RED: `corepack pnpm exec vitest run tests/unit/admin-first-login-migration.test.ts` failed 2/2 with `no such column: must_change_password` before the migration existed.
- ADM-PW-01 implementation now adds migration 19 (`must_change_password`, default-admin seed only for an empty admins table) and registers it after versions 15–18; focused tests pass 2/2, server typecheck passes, and `git diff --check` passes. Existing admins retain their credentials and receive the non-forced default flag; the migration is safe to replay.
- User resolved the delivery-chain strategy as `stacked-to-main`; ADM-PW-01 can now close with a scoped work-unit commit. No push, PR, merge, or branch switch has been made.
- Receipt-driven development mode check reported `off (decided by clone_local)`; ADM-PW-01 review outcome is `disabled/unmanaged`.

## Next Step
Close ADM-PW-01 with a scoped work-unit commit on the current feature branch, record its review assessment, then continue to ADM-PW-02.

## Relevant Files
- `apps/server/src/db/connection.ts` — migration registry and transaction runner.
- `apps/server/src/domain/hotel-service.ts` — admin bootstrap, login, password update, and session invalidation.
- `apps/server/src/http/app.ts` — auth middleware, login/me/password routes, realtime/HTTP access wiring.
- `apps/server/src/security/principal.ts` — authenticated admin principal.
- `packages/shared/src/dto.ts`, `packages/shared/src/validation.ts`, `packages/shared/src/errors.ts` — API contracts and validation/error codes.
- `apps/web/src/App.tsx` — admin login and session restoration.
- `apps/web/src/features/admin/AdminScreen.tsx`, `apps/web/src/features/admin/SetupPanels.tsx` — admin UI.
- `apps/web/src/i18n.tsx` — English/Spanish messages.
- `tests/unit`, `tests/integration` — migration, auth, startup, and web coverage.
