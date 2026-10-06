# Admin Live Queue Lifecycle and Delay Alerts

## Objective

Make the Admin live queue operationally focused, expose request lifecycle durations, and provide configurable stage-delay alerts.

## Problem and Why

The Admin live queue currently includes an all-status view and does not make elapsed time at each request stage clear enough for administrators to identify service delays. The request DTO already persists the timestamps needed to reconstruct the lifecycle. Administrators need three focused views and visible, configurable delay indicators.

## Scope

- Replace the queue filters with exactly three tabs: Pending, In progress, and Completed.
- In Completed, show the available lifecycle segments and durations from request creation through completion, using persisted timestamps. Support the current direct PENDING-to-IN_PROGRESS path and legacy ACCEPTED transitions without adding duplicate duration fields.
- In Pending and In progress, show live elapsed time for the current stage and a visual delay indicator driven by configurable thresholds.
- Show completed and active elapsed durations in a compact days/hours/minutes format, including only applicable non-zero units; keep the localized “ago” marker for active stages.
- Add administrator-editable minute thresholds with defaults of 3 minutes for Pending and 15 minutes for In progress.
- Persist both settings for existing installations through database migration v15, inserting defaults without overwriting existing values.
- Keep labels and UI copy localized in English and Spanish.
- Keep the queue's existing request-fetch limit unchanged; do not add audio warnings, device/APK changes, deployment, or remote operations.

## Constraints and Decisions

- Strict TDD is enabled for this feature by explicit user confirmation. Write a failing Vitest test before each implementation slice, then reach green before refactoring.
- Exact focused runner: `corepack pnpm exec vitest run`; focused existing suites include `tests/unit/admin-screen.test.ts` and `tests/unit/admin-localization.test.ts`. Add the affected settings and migration test paths as they are established.
- Pending warning default: 3 minutes. In-progress warning default: 15 minutes. Both must be editable in Admin Configuration and persist across restarts.
- Store thresholds as whole minutes; validate within 1–1440 minutes.
- Settings are stored in `system_settings`; migration v15 must use insert-if-missing behavior because settings updates only modify existing rows.
- Current request flow can transition directly from PENDING to IN_PROGRESS. Pending duration ends at `acceptedAt` when present, otherwise `inProgressAt`; processing duration starts at `inProgressAt` or the available accepted-time fallback.
- The Admin snapshot currently returns at most 100 recent requests overall. This task does not change that limit.
- Preserve all pre-existing staged, unstaged, and untracked workspace state. Never stage unrelated changes broadly.
- Receipt-driven development is disabled by clone-local preference; do not start a review or assessment.
- No push, pull request, deployment, APK build, or device update is authorized by this request.
- Selected delivery strategy: `feature-branch-chain`, previously chosen by the user for this project. Forecast: approximately 600 authored changed lines across settings, migration, queue UI, localization, and tests (generated files excluded), so preserve task commit boundaries on the existing feature branch. Do not create a PR or push.

## Authorized Scope

Local code, tests, migration, and this task document in the existing repository. Do not modify unrelated dirty files or interact with remote systems/devices.

## Acceptance Criteria

1. The Admin live queue displays only Pending, In progress, and Completed tabs; the former all-status tab is absent.
2. Completed requests display the full available lifecycle with elapsed durations between recorded stages and the total elapsed time, formatted with applicable day/hour/minute units.
3. Pending and in-progress requests display an updating stage-age indicator in the same compact format, plus a visual overdue state when the configured threshold is reached.
4. The defaults are 3 and 15 minutes; an administrator can change both in Configuration, and the values survive a restart and are used by the queue.
5. Migration v15 seeds missing setting rows without resetting previously configured values.
6. English and Spanish labels/copy are covered by tests, and existing unrelated queue/admin behavior remains intact.

## Tasks

## Route and Trigger Evidence

- **ALQ-01 — delegated direct**. Mapping trigger: this work spans shared setting contracts, server migration/registration, Admin settings UI, localization, and migration/unit tests (4+ files). Writer trigger: implementation changes multiple non-trivial files. A read-only CodeGraph mapping was completed before the writer began.
- **ALQ-02 — delegated direct**. Mapping trigger already satisfied by the Admin queue lifecycle mapping; writer trigger applied because queue behavior, tests, localization, and styles span multiple non-trivial files. Narrow follow-up writers corrected the legacy ACCEPTED lifecycle label and now normalize elapsed-time formatting after user clarification.

### ALQ-01 — Add persistent configurable delay thresholds

- [x] Add failing tests for the two shared setting defaults, validation bounds, existing-database migration seeding, preservation of pre-existing values, and Configuration labels. RED: `corepack pnpm exec vitest run tests/unit/shared-domain.test.ts tests/unit/admin-queue-delay-threshold-migration.test.ts tests/unit/admin-localization.test.ts` — 4 failed / 31 passed; failures confirmed missing setting keys/defaults, migration v15, seeding/preservation, and translation.
- [x] Add shared setting keys/defaults/bounds and migration v15 registration plus insert-if-missing seed behavior.
- [x] Expose both numeric settings in Admin Configuration with English and Spanish labels.
- [x] Run focused tests, relevant typecheck/build checks, and refactor while green. GREEN: focused Vitest suites — 5 files / 63 tests passed. `corepack pnpm run typecheck`, shared/server/web builds, and directed ESLint passed. Vite emitted only the existing non-blocking bundle-size warning.
- [ ] Commit this work unit on the existing feature branch and record its commit ID and verification evidence here. Attempted using a temporary index, but Git could not write to `.git` because repository metadata is read-only in this runtime; no commit was created. Older migration/service expectations were subsequently updated to include migration v15 and both new default settings.

### ALQ-02 — Focus Admin queue tabs, lifecycle, and active-stage alerts

- [x] Add failing tests for the three-tab contract, direct/legacy lifecycle duration calculations, configured stage-alert thresholds, and live age refresh. Initial RED: Admin screen suite — 5 failed / 26 passed. Follow-up RED: the legacy ACCEPTED interval rendered indistinguishably from In progress; the new regression test failed before the localized fix.
- [x] Implement the three tabs and completed lifecycle detail using existing request timestamps. Completed requests show pending, optional accepted, and in-progress durations plus total elapsed time; ACCEPTED is labeled “Accepted”/“Aceptada” only in the lifecycle.
- [x] Show live pending/in-progress stage ages and visible threshold-based delay states using persisted settings. The visible age refreshes every 15 seconds; no sound behavior was added.
- [x] Run focused tests, relevant typecheck/build checks, and refactor while green. GREEN: `corepack pnpm exec vitest run tests/unit/admin-screen.test.ts tests/unit/admin-localization.test.ts` — 2 files / 58 tests passed after the lifecycle label fix.
- [ ] Commit this work unit on the existing feature branch and record its commit ID and verification evidence here.

#### ALQ-02-FMT — Format elapsed times as days, hours, and minutes

- [x] Add failing tests for durations crossing day/hour boundaries, omission of zero-value units, and localized “ago” wording for active-stage ages. RED: `corepack pnpm exec vitest run tests/unit/admin-screen.test.ts` — 10 expected failures exposed missing just-now/minute/day formatting and active-age day units.
- [x] Use one compact elapsed-duration formatter for completed lifecycle segments and active-stage ages, preserving localized “just now”/“ahora” behavior for durations under one minute.
- [x] Run focused Admin timing/localization tests, full unit suite, typecheck, applicable builds/lint, and `git diff --check`; GREEN: focused Admin + localization suites — 2 files / 66 tests passed; `corepack pnpm test:unit` — 49 files / 534 tests passed; workspace typecheck, server build, web build, directed ESLint, and `git diff --check` passed. Vite emitted the existing non-blocking >500 kB chunk warning.
- [ ] Commit ALQ-02-FMT as an isolated work unit and record its commit ID; blocked by read-only `.git` metadata, with no workaround attempted.

## Verification

- TDD: strict; source: explicit user confirmation for this feature.
- Test runner: Vitest via `corepack pnpm exec vitest run`.
- Focused verification: `corepack pnpm exec vitest run tests/unit/admin-screen.test.ts tests/unit/admin-localization.test.ts tests/unit/shared-domain.test.ts tests/unit/admin-queue-delay-threshold-migration.test.ts tests/unit/request-history-retention-migration.test.ts tests/unit/default-catalog-migration.test.ts tests/unit/hotel-service.test.ts` — 7 files / 113 tests passed before the final ACCEPTED-label regression was added; final Admin suites passed 58 tests.
- Full verification after ALQ-02-FMT: `corepack pnpm test:unit` — 49 files / 534 tests passed; `corepack pnpm run typecheck`, `corepack pnpm --filter @hotel/server build`, `corepack pnpm --filter @hotel/web build`, directed ESLint on the changed Admin files/tests, and `git diff --check` passed. Vite emitted its existing non-blocking CJS API deprecation and >500 kB bundle warnings.
- Check for accidental changes to the user's pre-existing staged/unstaged state before and after each work unit. Record exact commands and outcomes below.

## Progress and Evidence

- [x] CodeGraph-first mapping confirmed Admin queue, request timestamps, settings persistence, migration entry point, and AREA's pending-only 3-minute warning.
- [x] User confirmed 3-minute Pending and 15-minute In progress defaults, both editable in Configuration.
- [x] User confirmed strict TDD for this feature.
- [ ] ALQ-01 isolated work-unit commit and commit evidence (pending writable `.git` metadata; HEAD and the existing staged paths remain unchanged).
- [x] User explicitly authorized proceeding with ALQ-02 while ALQ-01's commit is still pending; this changes task sequencing only, not the commit requirement or filesystem restriction.
- [x] ALQ-02-FMT — compact days/hours/minutes output implemented and reverified; active elapsed ages retain localized “ago” phrasing.
- [ ] ALQ-02 isolated work-unit commit (pending writable `.git` metadata; do not bypass the runtime restriction).
- [ ] ALQ-02-FMT isolated work-unit commit (pending writable `.git` metadata; do not bypass the runtime restriction).

## Next Step

Implementation and verification are complete through ALQ-02-FMT. ALQ-01, ALQ-02, and ALQ-02-FMT work-unit commits remain pending because `.git` metadata is read-only; do not bypass that restriction. Once Git metadata is writable, create isolated commits while preserving the user's pre-existing staged paths, then record their IDs here.

## Relevant Files

- `apps/web/src/features/admin/AdminScreen.tsx` — Admin queue, lifecycle labels, and settings update flow.
- `apps/web/src/features/admin/admin-request-timing.ts` — lifecycle duration reconstruction, stage-age thresholds, and three tab contract.
- `apps/web/src/styles.css` — Admin queue lifecycle and overdue presentation.
- `apps/web/src/features/admin/SetupPanels.tsx` — generic numeric settings UI and labels.
- `packages/shared/src/domain.ts` — shared setting keys, defaults, and validation bounds.
- `apps/server/src/db/connection.ts` — migration registration.
- `apps/server/src/db/migrations/015_admin_queue_delay_thresholds.ts` — migration seeding the two settings without overwriting configured values.
- `apps/server/src/domain/hotel-service.ts` — settings persistence and request snapshot.
- `packages/shared/src/dto.ts` — request lifecycle timestamps.
- `apps/web/src/i18n.tsx` — English and Spanish translations.
- `tests/unit/admin-screen.test.ts`, `tests/unit/admin-localization.test.ts`, `tests/unit/admin-queue-delay-threshold-migration.test.ts`, `tests/unit/default-catalog-migration.test.ts`, `tests/unit/hotel-service.test.ts`, `tests/unit/shared-domain.test.ts` — feature and migration regressions.
