# AREA Completed Requests Search and Sorting

## Objective
Let AREA operators find and reorder completed service requests without affecting the operational Pending/In Progress queues.

## Problem and Why
The Completed tab currently shows all completed request cards in oldest-created-first order and has no way to search. Operators need to locate completed requests by multiple details and choose a useful ordering without switching to the Admin queue.

## Scope
- Add a multi-term search control visible only on the AREA Completed tab.
- Match each query term case-insensitively as a substring against searchable request fields; all terms must match somewhere, including across fields. Search room code/name, service code/name, responsible area code/name, and request ID.
- Add an accessible “Order by” control visible only on Completed. Default to completion time, newest first; offer completion time oldest first, room ascending (numeric-aware), and service A–Z.
- Use `completedAt` as the completion-time key, falling back to `createdAt` for legacy/missing values.
- Localize every label, option, and empty-search-results message in English and Spanish. Keep control layout usable on narrow screens and preserve keyboard focus treatment.
- Keep filtering/sorting client-side using the existing AREA snapshot; no API, schema, request mutation, or other tab behavior changes.
- Add behavior and style regression tests.

## Constraints and Decisions
- User requested multi-term search and an “Order by” control. Recommendation selected: newest completion first by default, with oldest completion, room, and service alternatives.
- Search is conjunctive across terms, case-insensitive, and partial-substring based for forgiving request lookup; terms may match different searchable fields.
- `RequestDTO` already includes room/service/area metadata plus `completedAt`; no server changes should be necessary.
- Preserve existing staged and unstaged changes in the shared worktree. Do not stage broadly or commit unrelated hunks.
- TDD: strict, from active project/session policy. Focused runner: `corepack pnpm exec vitest run tests/unit/device-screen.test.ts tests/unit/ui-styles.test.ts`.
- RDD: disabled by clone-local setting (`gentle-ai review mode status`, checked 2026-09-29); do not start review.
- No remote/device/APK/database operations are in scope.

## Delivery
- Strategy: `feature-branch-chain` (user-selected for this project).
- Current branch: `jorlys/feat/lan-notification-agent`.
- Forecast: approximately 180 authored changed lines, excluding generated files.
- The implementation shares whole-file edits with other authorized AREA/device improvements; the completed-search slice was committed together with those related web workflows after repository-wide verification.

## Tasks and Acceptance Criteria

### ACS-01 — Search and order completed AREA requests
- [x] Add RED tests proving multi-term search requires every term but permits terms across room/service/area fields; match is case-insensitive and partial; empty query preserves all completed requests.
- [x] Add RED tests for newest/oldest completion sorting, numeric-aware room order, service A–Z, stable behavior for missing `completedAt`, and default newest-first.
- [x] Implement completed-only local search and sorting without changing Pending, In Progress, or Do Not Disturb contents/order.
- [x] Add localized, labeled controls and no-results feedback; verify responsive styles and visible keyboard focus.
- [x] Verify focused tests, `corepack pnpm typecheck`, and targeted `git diff --check`. Record RED/GREEN evidence and any unavailable checks.
- Route: delegated direct. Trigger evidence: structural mapping spans `DeviceScreen.tsx`, shared search conventions, i18n, styles, and unit tests; implementation touches multiple non-trivial files.
- Focused runner: `corepack pnpm exec vitest run tests/unit/device-screen.test.ts tests/unit/ui-styles.test.ts`.
- Work-unit commit: `dd10aaa` (`feat(web): improve area and device workflows`); it includes this search/sort behavior with related changes in the shared screen, localization, and style files.
- Progress: implemented, tested, and committed 2026-09-29.

## Progress and Evidence
- CodeGraph mapped the AREA rendering path: `AreaDisplay` chooses a single completed column and currently sorts requests by ascending `createdAt`; `RequestDTO` already exposes completion timestamps and room/service/area search values.
- Existing request-history search uses multi-term AND substring matching; existing catalog filtering is stricter exact-token behavior. This feature follows the request-search substring convention.
- The shared worktree already has staged and unstaged edits to the target screen, i18n, styles, and tests; preserve unrelated changes.
- TDD is strict. Complete a failing behavior test before implementation, then rerun focused checks.
- RED: the new search/sort tests failed because `filterAndSortCompletedAreaRequests` did not exist (2 failures); the style regression failed because the completed toolbar rules did not exist (1 failure).
- GREEN: `corepack pnpm exec vitest run tests/unit/device-screen.test.ts tests/unit/ui-styles.test.ts` passed (2 files, 130 tests); `corepack pnpm typecheck` passed; targeted unstaged and staged `git diff --check` passed.
- Behavior: completed-only multi-term search uses case-insensitive partial matching across request ID and room/service/area code and names (including available localized variants); default/newest and oldest completion orders use `completedAt` then `createdAt` fallback, with numeric-aware room and localized service-name ordering.
- UI: native `<details>/<summary>` disclosure with radio options was selected instead of a custom ARIA menu to retain built-in keyboard interaction; search and sort controls are mounted only on Completed, with localized English/Spanish labels and live no-results feedback. Responsive layout stacks on narrow screens and has an explicit focus-visible outline.
- Repository-wide verification also passed: all 9 E2E smoke tests; workspace lint, typecheck, build, unit/integration suites; focused AREA suite remained 130/130. No device visual QA or APK update was in scope.

## Next Step
No further source work remains. Commit `dd10aaa` records the verified implementation; no device visual QA or APK update was requested.

## Relevant Files
- `apps/web/src/features/device/DeviceScreen.tsx` — AREA completed tab, card rendering, and request filtering.
- `apps/web/src/features/admin/admin-search.ts` — existing multi-term search conventions for reusable reference.
- `apps/web/src/i18n.tsx` — English/Spanish device labels.
- `apps/web/src/styles.css` — AREA filter row, completed board, and card controls.
- `tests/unit/device-screen.test.ts` — AREA request rendering and helper tests.
- `tests/unit/ui-styles.test.ts` — style/layout regression checks.
