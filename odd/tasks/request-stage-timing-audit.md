# Request Stage Timing and AREA Elapsed Clock

## Objective
Keep the AREA request-card “Lleva” value correct after closing and reopening the app, and retain request lifecycle timing/history for one year for administrator audit and later analysis.

## Problem and Why
An Android AREA console can reopen from an old native snapshot. `App.initialize` reads that cached snapshot, `MainActivity` asks the already-running receiver to start, and `AndroidLanReceiver.start()` currently returns early when `startRequested` is already true. No fresh `/device/session` snapshot is fetched. `useServerClock` then re-anchors from the old `snapshot.serverTime` and counts only from the current WebView mount, so a request created near that old snapshot can display “ahora” after reopening. The persisted DB `createdAt` is not overwritten.

Request rows already persist `created_at`, `accepted_at`, `in_progress_at`, and `completed_at`; `request_status_history` stores status transitions and actor/timestamp data. The history cleanup setting currently defaults to 30 days. The user selected 365 days. The current AREA “Aceptar” action transitions directly from PENDING to IN_PROGRESS, so `in_progress_at` is the start/acceptance reference for that flow; elapsed stage durations should be derived from existing timestamps/history, not duplicated.

## Scope
- Refresh the authoritative AREA device snapshot when the existing native receiver is asked to resume, without creating a second socket or altering persisted request timestamps.
- Keep elapsed display advancing from `createdAt` when the app must show an offline/stale cached snapshot; use client wall time only as a fallback while disconnected, and server time when synchronized.
- Set request-history retention to 365 days for new databases and migrate the existing setting to 365 days once. Preserve the existing configurable policy afterward.
- Align the local ignored `.env` override with the user-selected 365-day retention so the configured local runtime does not remain at 30 days.
- Add focused regression and migration/retention tests, plus update this document and its Engram mirror after each task.
- Do not deploy or mutate a live/remote database, access devices, build/install an APK, or perform other remote operations in this task.

## Constraints and Decisions
- Request lifecycle timestamp columns and transition history already exist; do not add duplicate duration columns.
- Current request flow records the PENDING → IN_PROGRESS transition as the acceptance/start point; completed processing duration derives from `completed_at - in_progress_at`.
- Retention choice: 365 days, explicitly selected by the user.
- Worktree is heavily dirty, including staged and unstaged user changes. Preserve all pre-existing changes and isolate any commits to this feature's own hunks/files; never stage broadly.
- TDD: strict. Source: active project/session task policy. Test runners: focused Vitest and Android Gradle unit tests listed below.
- Receipt-driven development: disabled by clone-local setting (`gentle-ai review mode status`, checked 2026-09-29); report `disabled/unmanaged`, do not start review.
- Authorized scope is local implementation and verification only; remote/device/database actions remain unauthorized.

## Delivery
- Strategy: `feature-branch-chain` (previously selected by the user for this project).
- Current branch is already a feature branch: `jorlys/feat/lan-notification-agent`.
- Forecast: approximately 250 authored changed lines total, generated files excluded.
- Slice boundaries: Task RTT-01 and Task RTT-02 are independent work units; record commit identities after safe isolated commits. Do not include unrelated staged/unstaged changes.

## Tasks and Acceptance Criteria

### RTT-01 — Preserve request age across AREA app reopen
- [x] Add a failing regression test for a repeated receiver start/reopen while the receiver is already running; verify it fetches a fresh authoritative snapshot and publishes the updated server time without replacing the socket. RED observed against the old early-return (`15 tests completed, 1 failed` at this regression); GREEN observed with the fix.
- [x] Add a failing UI test for a stale/offline snapshot remounted after a long closed interval; verify `Lleva` continues from the persisted request `createdAt` instead of resetting to “ahora”. Keep server time authoritative while online; use local wall time only while stale/offline. RED observed (`offline` rendered “just now” from stale `serverTime`); GREEN observed after the clock fallback change.
- [x] Implement the smallest fix, preserving cached DB `createdAt` and status timestamps. A synchronized repeated native start now refreshes through the existing socket synchronization path; offline/stale UI clocks advance from local wall time while online clocks remain anchored to server time.
- [x] Verify focused Android and web tests, `git diff --check`, and applicable typecheck/build checks. Android `AndroidLanReceiverTest` passed (15 tests), Vitest passed 70/70, root `pnpm typecheck` passed, and `git diff --check` passed for the four owned paths. The user-local Android toolchain loader was sourced before Gradle.
- Route: delegated direct. Trigger evidence: mapping spans 4+ files and implementation changes multiple non-trivial Android/web files.
- Focused runners:
  - `(cd apps/android-notification-receiver && ./gradlew :app:testDebugUnitTest --tests com.hotelalert.notificationreceiver.AndroidLanReceiverTest)`
  - Load the local Android Java/SDK environment first: `source "$HOME/.local/share/hotel-alert-env/android-toolchain.sh"`.
  - `corepack pnpm exec vitest run tests/unit/device-screen.test.ts tests/unit/app-model.test.ts`
- Work-unit commits: `dd10aaa` (`feat(web): improve area and device workflows`) for the stale/offline elapsed display, and `04826ab` (`feat(android): improve room and notification behavior`) for receiver refresh-on-resume.
- Progress: complete; focused Android/web tests, workspace typecheck, and targeted diff-check passed.

### RTT-02 — Retain request timing/history for 365 days
- [x] Add failing tests for the 365-day default and migration of existing databases to the user-selected 365-day setting. RED: three default/migration assertions failed against 30-day behavior; after isolation from the local environment override, the purge-boundary regression also confirmed the 30-day effective policy.
- [x] Verify the existing purge uses the updated setting and keeps history at the exact retention boundary while purging rows one millisecond older.
- [x] Update the shared default, runtime config fallback and `.env.example`, fresh-database default, and versioned migration 14 for existing databases; preserve administrator configurability after migration.
- [x] Verify focused tests, `git diff --check`, and applicable typecheck/build checks. The expanded focused suite passed 60/60, root `corepack pnpm typecheck` passed, and targeted diff checks passed.
- Route: delegated direct. Trigger evidence: implementation spans shared settings, runtime config/template, DB migration registration and module, plus multiple server tests.
- Focused runners:
  - `corepack pnpm exec vitest run tests/unit/shared-domain.test.ts tests/unit/hotel-service.test.ts tests/unit/request-history-retention-migration.test.ts tests/unit/default-catalog-migration.test.ts tests/unit/config.test.ts`
- Work-unit commit: `f0ead2f` (`feat(server): extend request and information workflows`) for 365-day defaults, migration 14, runtime configuration, and retention tests.
- Progress: complete; migration and purge boundary behavior verified. The local ignored `.env` override was changed from 30 to 365 days to match the user's explicit policy; `.env.example` and runtime fallback also default to 365. Admin configuration remains available after the one-time migration.

## Progress and Evidence
- Exploration verified lifecycle timestamps and history exist in the DB and DTO; the request age bug is caused by stale snapshot clock re-anchoring on Android AREA reopen, not by a `createdAt` rewrite.
- `request_status_history` retention uses `requests.historyRetentionDays`; the prior default was 30 days, now changed to the selected 365 days, within the supported 7–3650 day range.
- RTT-02 RED observed before production edits: shared default and runtime config were 30 instead of 365; the version-14 migration did not update the existing persisted value; and purge removed both the exact-cutoff history and older history under the current 30-day setting.
- `.env` and tracked `.env.example` both explicitly set `REQUEST_HISTORY_RETENTION_DAYS=30`, causing tests that loaded local configuration to use 30 even after the source fallback changed. Updated `.env.example` and the active local `.env` to 365, matching the user's one-year requirement; tests remain deterministic by stubbing environment/configuring the purge-policy fixture explicitly.
- RTT-02 GREEN: focused Vitest suite passed 60/60 across shared-domain, hotel-service, new version-14 migration, default-catalog migration-version, and config tests; the parent reran all five suites after aligning `.env` and observed 60/60. `corepack pnpm typecheck` passed for all workspace projects. Targeted `git diff --check` passed for changed tracked paths and both new files.
- The 365-day retention policy prevents future premature purging; migration cannot recover history rows already deleted under the former 30-day policy.
- The request-age and retention changes are included in isolated work-unit commits from the authorized final on-disk tree; unrelated staged state was not used.
- RTT-01: Android `AndroidLanReceiverTest` passed 15 tests after the new repeated-start regression was observed failing under the original early return. `corepack pnpm exec vitest run tests/unit/device-screen.test.ts tests/unit/app-model.test.ts` passed 70/70 after first observing the stale-offline clock regression fail. `corepack pnpm typecheck` and targeted `git diff --check` passed. Gradle used the existing user-local Android toolchain loader. No APK build, install, remote operation, or DB mutation was performed.
- Repository-wide verification passed after commit: unit 511/511, integration 38/38, lint, typecheck, build, E2E 9/9, Android host tests/lint/check, and scoped whitespace checks.

## Next Step
Implementation and verification are complete. Commits `f0ead2f`, `dd10aaa`, and `04826ab` record the server, web, and Android slices. No live database migration or deployment was performed; historical rows purged before the one-year migration remain unrecoverable.

## Relevant Files
- `apps/web/src/App.tsx` — native AREA snapshot hydration on app initialization.
- `apps/web/src/features/device/DeviceScreen.tsx` — AREA elapsed formatting and server clock.
- `apps/android-notification-receiver/app/src/main/java/com/hotelalert/notificationreceiver/MainActivity.kt` — resumes the native receiver on app reopen.
- `apps/android-notification-receiver/app/src/main/java/com/hotelalert/notificationreceiver/receiver/AndroidLanReceiver.kt` — native snapshot fetch and start/synchronization lifecycle.
- `apps/server/src/domain/hotel-service.ts` — persists request stage timestamps and purges request history.
- `apps/server/src/db/connection.ts` — database defaults and migration registry.
- `apps/server/src/config/env.ts` — request-history retention environment fallback.
- `apps/server/src/db/migrations/014_request_history_retention.ts` — applies the one-time 365-day database setting.
- `.env.example` — documented environment default for new local/server configurations.
- `tests/unit/request-history-retention-migration.test.ts` — fresh default, existing-database migration, and post-migration admin edit coverage.
- `tests/unit/hotel-service.test.ts` — one-year purge boundary coverage.
- `packages/shared/src/domain.ts` — shared setting defaults and validation bounds.
