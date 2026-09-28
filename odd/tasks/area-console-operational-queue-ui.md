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
- Preserve the AREA console's responsive full available width; do not constrain it to a fixed content width.
- Show only two AREA tabs: Pendientes (retaining both Pending and In progress columns) and Completadas (completed-only); expand both tabs and the navbar across the same responsive available width as the board.
- Keep the two AREA tabs square and borderless; substantially reduce vertical gaps above the navbar, before the tabs, and below the device status/information footer.
- Darken the AREA navbar slightly; suppress browser blue tap highlight across app buttons while preserving the app's visible keyboard-focus outline.
- Interpret “less wide” as a slimmer/shorter bar (reduced vertical padding) so it frees screen space for the queue.
- Preserve all unrelated changes in the heavily dirty worktree. This is a web-only change; no APK build or installation is needed.
- Forecast: approximately 300 authored changed lines across ACU-01–ACU-03, generated files excluded; below the delivery slice budget. Delivery strategy: feature-branch-chain (user selected for this feature branch).
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
- The AREA board expands to the available viewport width at wide and narrow screen sizes without a fixed-width layout.
- Only Pendientes and Completadas tabs are visible; Pendientes keeps both operational columns and Completadas stays completed-only.
- Both AREA tabs stretch evenly across available width, and the navbar follows that same responsive width without fixed sizing.
- AREA tabs have no border or rounded corners; AREA-only top, inter-section, and bottom spacing is compact at desktop and mobile widths.
- The AREA navbar background is slightly darker; app buttons do not show the browser's blue touch highlight, and keyboard focus remains visibly indicated.
- Focused unit tests pass; lint/typecheck are run where applicable.

## Tasks
- [x] **ACU-01 — Refine the AREA operational queue and layout** (route: delegated direct; trigger: 3 non-trivial files are involved—`DeviceScreen.tsx`, `styles.css`, and focused unit tests—so the writer trigger applies). Update queue filtering/columns, the completed view and completion drop path, remove the redundant heading, and scope the tab/header styles to AREA. Add/adjust behavior and style tests, then run the focused test command and applicable checks.
- [x] **ACU-02 — Isolate AREA request-column scrolling and preserve responsive width** (route: delegated direct; trigger: CSS layout and unit-style tests are two non-trivial files, so the writer trigger applies). Bound the AREA console to the viewport, let each request-column body scroll independently, and preserve its full responsive width. Add regression assertions proving both AREA-only scroll behavior and width responsiveness without changing ROOM/admin behavior. Reopened after the user reported that the flex containment caused the AREA board to shrink to its content width.
- [x] **ACU-03 — Simplify AREA tabs and align responsive widths** (route: delegated direct; mapping trigger: understanding spans four non-trivial files, so read-only mapping was delegated to `area_tabs_map`; writer trigger: component, styling, and two focused test files, so implementation is delegated). Display only Pendientes and Completadas; keep both operational columns under Pendientes and completed requests only under Completadas. Make both tabs evenly fill the available width and make the AREA navbar match the responsive board width without fixed pixel dimensions. Preserve ROOM/admin behavior and reuse existing localized status labels where possible.
- [x] **ACU-04 — Tighten AREA vertical spacing and touch styling** (route: delegated direct; writer trigger: AREA stylesheet and focused style tests are two non-trivial files). Remove tab borders and rounded corners; substantially reduce AREA-only whitespace above the navbar, between navbar and tabs, and below the device footer; slightly darken the AREA navbar; suppress blue tap highlight across app buttons while preserving keyboard-visible focus. Keep other ROOM/Admin styling unchanged.

## Progress and Evidence
- Exploration: CodeGraph mapped `AreaDisplay`, `filterAreaRequests`, and the AREA header. Narrow stylesheet/test inspection confirmed current dark pill styling, three desktop queue columns, and a relative AREA top bar.
- ACU-01 mirror and test evidence: intent was saved before source implementation; strict TDD RED had four expected assertion failures and GREEN passed (117/117 focused tests).
- ACU-01 checks: focused ESLint passed for `DeviceScreen.tsx`, `device-screen.test.ts`, and `ui-styles.test.ts`; `git diff --check` passed; web build passed (Vite reported its existing >500 kB chunk warning).
- Typecheck was run and remains blocked by two errors in unrelated existing work in `DeviceScreen.tsx`: line 878 has an exact-optional `onDoNotDisturbTap` mismatch; line 929 references missing `CompactRoom` import. Neither is part of ACU-01.
- Work-unit commit: `0d3180c2dbb4e45a3578ca58b1a0c21f6c9a172d` (`feat(area): streamline operational queue`).
- Receipt-driven review outcome: `disabled/unmanaged` (clone-local preference is off); ordinary verification completed without a review ceremony.
- ACU-02 exploration: CodeGraph confirmed AREA renders a two-column `.queue-board` with independent `.queue-column__body` elements. The stylesheet is not indexed by CodeGraph, so targeted reads found that the AREA frame only has `min-height`, the device content flows naturally, and queue bodies have no overflow constraint; long lists therefore expand the page instead of scrolling independently.
- ACU-02 TDD mode: strict TDD remains enabled from the explicit user-approved workflow; runner: `corepack pnpm exec vitest run tests/unit/ui-styles.test.ts`.
- ACU-02 RED/GREEN: the new viewport/column-scroll contract test first failed (67 tests, 1 expected failure); after the AREA-only flex/overflow rules, focused tests passed (67/67).
- ACU-02 writer checks: focused ESLint passed for `tests/unit/ui-styles.test.ts`; `git diff --check -- apps/web/src/styles.css tests/unit/ui-styles.test.ts` passed. ESLint reports CSS ignored because this repo has no CSS lint configuration.
- ACU-02 parent verification: both focused suites passed (118/118 total), ESLint passed, and `corepack pnpm --filter @hotel/web build` passed with the existing >500 kB chunk warning. The web typecheck still fails on the same unrelated preexisting DND optional-callback and missing `CompactRoom` errors in `DeviceScreen.tsx`.
- ACU-02 integration/commit: scoped `git diff --check` passed. Isolated work-unit commit: `bc238c1` (`fix(area): isolate request column scrolling`); staged only `styles.css` and `ui-styles.test.ts` through a temporary index, preserving the unrelated main index/worktree changes. Receipt-driven review outcome: `disabled/unmanaged`.
- ACU-02 responsive-width follow-up: the screenshot showed the AREA board narrower than the available viewport. Root cause: after `.app-frame--device:not(.app-frame--room)` became a flex container, `.device-content` retained horizontal auto margins without an explicit width and shrink-wrapped. Added `min-width: 0` and responsive `width: 100%` to the AREA-only content rule; ROOM/admin remain unchanged. Strict TDD RED was observed (67 tests, 1 expected failure) before CSS; GREEN passed (67/67). Parent reran the UI style suite (67/67), ESLint passed (CSS is ignored because no CSS lint config exists), scoped `git diff --check` passed, and web build passed with the existing >500 kB chunk warning. Isolated work-unit commit: `3892903` (`fix(area): restore responsive console width`), with only `styles.css` and `ui-styles.test.ts` staged via a temporary index, preserving unrelated staged/unstaged work. Receipt-driven review remains `disabled/unmanaged`.
- ACU-03 exploration: CodeGraph confirmed the current `ALL` tab already filters to all non-completed requests and renders both Pending and In progress columns; `COMPLETED` is already completed-only. Existing `request.status.new` is localized as “Pendientes” in Spanish, so no new translation key is currently needed. Tabs are rendered from `AREA_FILTERS`; the AREA topbar has no explicit responsive width and the shared filter row is flex/wrap. A read-only delegated mapping covered component, labels, tests, and CSS.
- ACU-03 implementation: visible tabs are now only Pendientes (`ALL`, preserving both Pending and In progress columns) and Completadas (`COMPLETED` only); the existing localized Pending status label is reused. AREA navbar width is explicitly responsive (`width: 100%`, `min-width: 0`), while the two tab buttons share available row width equally without fixed dimensions. Strict TDD RED was observed (2 expected failures); GREEN passed (119/119 focused tests). Focused ESLint, scoped `git diff --check`, and `corepack pnpm --filter @hotel/web build` passed; Vite emitted the existing >500 kB chunk warning. The web typecheck remains affected by two unrelated existing `DeviceScreen.tsx` errors: optional `onDoNotDisturbTap` mismatch and missing `CompactRoom` import.
- ACU-03 work-unit commit: `edf9fe4` (`fix(area): simplify responsive status tabs`), isolated to `DeviceScreen.tsx`, `styles.css`, and their two focused test files using a temporary Git index. Receipt-driven review outcome: `disabled/unmanaged`.
- Mirror status: final ACU-03 implementation and verification report is synchronized to Engram topic `odd/area-console-operational-queue-ui/tasks` (observation #1638).
- ACU-04 exploration: AREA vertical whitespace comes from the shared app-frame top/bottom padding plus AREA device-content top/bottom padding; the mobile rules also reset those values. Generic app buttons inherit browser tap highlight while the app's keyboard `:focus-visible` outline is amber; remove only tap highlight app-wide and preserve focus styling. Keep all spacing/background/tab overrides scoped to AREA.
- ACU-04 TDD mode: strict TDD; runner: `corepack pnpm exec vitest run tests/unit/ui-styles.test.ts`.
- ACU-04 implementation: AREA tabs are borderless/square; AREA top and bottom padding are 4px and navbar-to-tabs/content gap is 4px, including mobile; navbar background is slightly darker. Removed WebKit tap highlight globally from buttons while retaining the amber keyboard `:focus-visible` outline. Strict TDD RED observed (2 expected failures), then GREEN passed (68/68). Focused ESLint and scoped `git diff --check` passed; production web build passed with existing Vite CJS API deprecation and >500 kB bundle warnings. No typecheck was run because changes are CSS-only.
- ACU-04 work-unit commit: `4799602` (`fix(area): compact console chrome and touch feedback`), isolated to `styles.css` and `ui-styles.test.ts` using a temporary Git index. Receipt-driven review outcome: `disabled/unmanaged`.
- Mirror status: ACU-04 completion report is synchronized to Engram topic `odd/area-console-operational-queue-ui/tasks` (observation #1638).
- Cumulative forecast: approximately 340 authored lines across ACU-01–ACU-04, generated files excluded, still below the ~400-line delivery slice budget; preserve the feature-branch-chain strategy.

## Next Step
ACU-01 through ACU-04 are implemented, verified, and committed. No remaining in-scope work.

## Relevant Files
- `apps/web/src/features/device/DeviceScreen.tsx` — AREA filters, request columns, section heading, and shared top-bar markup.
- `apps/web/src/styles.css` — AREA layout, filter, and top-bar styles.
- `tests/unit/device-screen.test.ts` — AREA filter/render/drag-drop behavior tests.
- `tests/unit/ui-styles.test.ts` — responsive queue layout and styling tests.
