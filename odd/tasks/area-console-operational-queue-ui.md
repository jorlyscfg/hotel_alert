# AREA Console Operational Queue UI

## Objective
Make the AREA console prioritize operational requests and use its screen space more efficiently.

## Problem and Why
The current AREA board renders a completed column alongside active work, its “live queue” heading takes vertical space, filter pills use a dark active background, and the AREA header scrolls away. Operators need pending/in-progress work visible first while completed requests remain available in their own filter.

Follow-up: the AREA page currently allows the overall screen to scroll as request lists grow. The operator needs each status column to own its vertical scroll area independently, leaving the header, filters, and sibling columns stationary.

## Scope and Constraints
- Keep only PENDING and IN_PROGRESS columns in the operational views; show COMPLETED requests only when the Completed filter is selected.
- Keep a usable path to complete requests by drag-and-drop.
- Restyle the AREA filters with clear contrast and no black fill; remove the redundant live-queue heading.
- Make the AREA top bar sticky and more compact without changing the ROOM top bar.
- Constrain scrolling to each AREA request-column body independently; keep the overall AREA console viewport stationary and do not alter ROOM/admin scrolling.
- Interpret “less wide” as a slimmer/shorter bar (reduced vertical padding) so it frees screen space for the queue.
- Preserve all unrelated changes in the heavily dirty worktree. This is a web-only change; no APK build or installation is needed.
- Forecast: approximately 120 authored changed lines, generated files excluded; below the delivery slice budget. Delivery strategy: feature-branch-chain (user selected for this feature branch).
- Effective TDD: strict TDD, based on the explicit user-approved TDD workflow in the active runtime session. Runner: `corepack pnpm exec vitest run tests/unit/device-screen.test.ts tests/unit/ui-styles.test.ts`.

## Authorized Scope
The user explicitly authorized these AREA console UI corrections. Do not expand into unrelated device, server, or admin-console behavior.

## Acceptance Criteria
- Default/active request views exclude completed requests and show only Pending and In progress columns.
- Selecting Completed shows completed requests; they do not appear in the active queue.
- Operators can still drag an in-progress request to completion.
- The redundant live-queue heading is removed, leaving more room for filters and requests.
- AREA filter buttons have a light, polished active state with readable contrast.
- The AREA top bar remains visible while scrolling and is compact; ROOM styling remains unchanged.
- Long request lists scroll inside their own column without moving the AREA page, filter tabs, navbar, or neighboring columns.
- Focused unit tests pass; lint/typecheck are run where applicable.

## Tasks
- [x] **ACU-01 — Refine the AREA operational queue and layout** (route: delegated direct; trigger: 3 non-trivial files are involved—`DeviceScreen.tsx`, `styles.css`, and focused unit tests—so the writer trigger applies). Update queue filtering/columns, the completed view and completion drop path, remove the redundant heading, and scope the tab/header styles to AREA. Add/adjust behavior and style tests, then run the focused test command and applicable checks.
- [x] **ACU-02 — Isolate AREA request-column scrolling** (route: delegated direct; trigger: CSS layout and unit-style tests are two non-trivial files, so the writer trigger applies). Bound the AREA console to the viewport, let each request-column body scroll independently, and add regression assertions proving the AREA-only scroll contract without changing ROOM/admin behavior.

## Progress and Evidence
- Exploration: CodeGraph mapped `AreaDisplay`, `filterAreaRequests`, and the AREA header. Narrow stylesheet/test inspection confirmed current dark pill styling, three desktop queue columns, and a relative AREA top bar.
- Mirror status: synchronized with the Engram topic `odd/area-console-operational-queue-ui/tasks` after ACU-02; both copies contain the latest completion evidence.
- Strict TDD: RED observed before implementation (4 expected failing assertions); GREEN observed afterward (117/117 focused tests).
- Focused ESLint passed for `DeviceScreen.tsx`, `device-screen.test.ts`, and `ui-styles.test.ts`; `git diff --check` passed; web build passed (Vite reported its existing >500 kB chunk warning).
- Typecheck was run and remains blocked by two errors in unrelated existing work in `DeviceScreen.tsx`: line 878 has an exact-optional `onDoNotDisturbTap` mismatch; line 929 references missing `CompactRoom` import. Neither is part of ACU-01.
- Work-unit commit: `0d3180c2dbb4e45a3578ca58b1a0c21f6c9a172d` (`feat(area): streamline operational queue`).
- Receipt-driven review outcome: `disabled/unmanaged` (clone-local preference is off); ordinary verification completed without a review ceremony.
- ACU-02 exploration: CodeGraph confirmed AREA renders a two-column `.queue-board` with independent `.queue-column__body` elements. The stylesheet is not indexed by CodeGraph, so targeted reads found that the AREA frame only has `min-height`, the device content flows naturally, and queue bodies have no overflow constraint; long lists therefore expand the page instead of scrolling independently.
- ACU-02 TDD mode: strict TDD remains enabled from the explicit user-approved workflow; runner: `corepack pnpm exec vitest run tests/unit/ui-styles.test.ts`.
- ACU-02 RED/GREEN: the new viewport/column-scroll contract test first failed (67 tests, 1 expected failure); after the AREA-only flex/overflow rules, focused tests passed (67/67).
- ACU-02 writer checks: focused ESLint passed for `tests/unit/ui-styles.test.ts`; `git diff --check -- apps/web/src/styles.css tests/unit/ui-styles.test.ts` passed. ESLint reports CSS ignored because this repo has no CSS lint configuration.
- ACU-02 parent verification: both focused suites passed (118/118 total), ESLint passed, and `corepack pnpm --filter @hotel/web build` passed with the existing >500 kB chunk warning. The web typecheck still fails on the same unrelated preexisting DND optional-callback and missing `CompactRoom` errors in `DeviceScreen.tsx`.
- ACU-02 integration/commit: scoped `git diff --check` passed. Isolated work-unit commit: `bc238c1` (`fix(area): isolate request column scrolling`); staged only `styles.css` and `ui-styles.test.ts` through a temporary index, preserving the unrelated main index/worktree changes. Receipt-driven review outcome: `disabled/unmanaged`.
- Cumulative forecast: approximately 200 authored lines across ACU-01 and ACU-02, still below the ~400-line delivery slice budget; preserve the feature-branch-chain strategy.

## Next Step
ACU-01 and ACU-02 are implemented, verified, and committed. No remaining work is in scope.

## Relevant Files
- `apps/web/src/features/device/DeviceScreen.tsx` — AREA filters, request columns, section heading, and shared top-bar markup.
- `apps/web/src/styles.css` — AREA layout, filter, and top-bar styles.
- `tests/unit/device-screen.test.ts` — AREA filter/render/drag-drop behavior tests.
- `tests/unit/ui-styles.test.ts` — responsive queue layout and styling tests.
