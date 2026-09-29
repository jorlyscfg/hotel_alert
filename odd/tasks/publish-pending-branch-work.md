# Publish Pending Hotel Alert Branch Work

## Objective
Create safe Conventional Commits for the user-approved pending repository work and push the existing feature branch to the authorized GitHub repository.

## Problem and Why
The user asked to bring the repository up to date on GitHub after approving the AREA Completed search and sort. The shared branch already contains 56 local commits beyond `master`, while the working tree and real index contain many additional changes across completed and in-progress product work. A direct commit from the current index would remove valid source files, and broad staging would include local caches, data, and generated artifacts.

## Scope
- Publish the current branch’s authorized source code, documentation, tests, and functional assets after classifying them against their task trackers.
- Exclude `.codegraph/`, `apps/android-notification-receiver/.kotlin/`, `artifacts/`, `data/`, the WhatsApp feedback screenshot, and `logo.png` unless a task/source reference justifies it. Include `logo-chico.png` only if the Android launcher source dependency is confirmed.
- Preserve incomplete verification/device/Windows task status; do not represent pending checks as complete.
- Push only the existing branch `jorlys/feat/lan-notification-agent` to `https://github.com/jorlyscfg/hotel_alert.git`. Do not create a PR, merge, or change `master`.

## Constraints and Decisions
- The user explicitly authorized commits and a push to the named GitHub repository using the active GitHub CLI session, and confirmed the scope: source/docs/tests/functional assets; caches, artifacts, and local data excluded.
- `gh auth status --hostname github.com` confirmed active account `jorlyscfg` with HTTPS and `repo` scope. Remote branch listing showed only `master`; its commit was `803e272cec42fc59b863a0a05a0652c65913b76c`, matching local `master`. The feature branch is 56 commits ahead of that base and has no remote branch yet.
- The real index is unsafe as-is: staged changes include 61 paths and 6,368 deletions, including files still present on disk. Never commit that index or use blanket `git add -A`.
- Keep the shared worktree and real index safe; use a temporary Git index initialized from the current `HEAD` for isolated commit creation, then reconcile only committed paths.
- Use Conventional Commit messages; never add Co-Authored-By/AI attribution. Do not modify global Git identity or credential configuration; use only the authorized GitHub CLI session for remote access.
- Existing feature delivery strategy is `feature-branch-chain`; no PR is requested.
- Existing feature trackers report some physical-device, live-DND, and Windows checks pending. These remain pending unless directly verified.

## Tasks and Acceptance Criteria

### RWP-01 — Map worktree changes and exclusions
- [x] Map staged, unstaged, deleted, and untracked changes to existing task trackers and identify likely generated/private data.
- [x] Confirm the target branch, destination, user-approved content scope, and authorized GitHub CLI session.
- Route: delegated direct. Trigger evidence: safe grouping spans more than four feature areas, many task documents, and over one hundred changed paths.

### RWP-02 — Verify publishable worktree state
- [x] Run applicable repository-wide tests/build/typecheck/lint and Android host checks where available; capture failures and unavailable device/Windows checks honestly.
- [x] Confirm the final publish list excludes local data, generated artifacts, caches, and unreferenced images; check whitespace on staged commits.
- Route: direct. Runners: `corepack pnpm test`; `corepack pnpm lint && corepack pnpm typecheck && corepack pnpm build`; `E2E_PORT=43751 corepack pnpm test:e2e`; `source "$HOME/.local/share/hotel-alert-env/android-toolchain.sh" && ./gradlew --offline :app:testDebugUnitTest :app:lintDebug :app:check`.

### RWP-03 — Commit approved changes safely
- [x] Create logically grouped Conventional Commits from approved final on-disk file contents with a temporary index; preserve the actual index until each committed path is reconciled.
- [x] Update the relevant local task trackers with commit identities and leave unverified checklist items open.
- [x] Verify the resulting branch history and ensure no excluded local files or secrets are committed.
- Route: direct. Do not use `git add -A` or commit the current real index.

### RWP-04 — Push and verify the branch
- [ ] Push only `jorlys/feat/lan-notification-agent` to the explicitly authorized GitHub repository using the active GitHub CLI session.
- [ ] Verify the remote branch resolves to the final local `HEAD`; do not create a PR or merge.

## Progress and Evidence
- Read-only delegated inventory found the real index contains stale staged deletions while restored/revised files exist in the working tree; current index contents are not the intended final tree.
- Read-only inventory identified exclusions: `.codegraph/` (large SQLite index/WAL), `.kotlin/`, `artifacts/`, local `data/` (SQLite/WAL/SHM and uploaded files), the user screenshot, and unreferenced `logo.png`.
- Functional assets `hotel_alert_dnd_active.wav` and `hotel_alert_dnd_inactive.wav` are application resources. `logo-chico.png` is documented as the launcher icon source; verify its direct reference before including.
- Current source/work streams include AREA completed search and elapsed request history, DND, Android ROOM/WebView, LAN receiver, catalog/information, and deployment/configuration. Existing per-feature trackers and verification state remain authoritative; several host/device checks remain pending.
- `corepack pnpm test` passed: 48 unit files / 511 tests and 4 integration files / 38 tests. The initial integration DND assertion expected an accepted service request while DND was on, contradicting the implemented 409 `RESOURCE_CONFLICT` contract; corrected the assertion to verify rejection and retry after disabling DND, then reran the full suite successfully.
- `corepack pnpm lint`, `corepack pnpm typecheck`, and `corepack pnpm build` passed. Lint initially found an unused `t` binding in `App.tsx`; removed only that binding after confirming the locale-only component did not use it.
- `E2E_PORT=43751 corepack pnpm test:e2e` passed all 9 tests. The initial run exposed stale selectors expecting a login heading absent from the current compact form; switched to the accessible username field and reran. The unique port and temporary database avoid touching any existing app/server data.
- Android host verification passed offline: `:app:testDebugUnitTest`, `:app:lintDebug`, and `:app:check` (`BUILD SUCCESSFUL`, 59 actionable tasks). No Windows host, physical-device, live-server, or database-migration checks were run as part of repository publication; existing feature trackers retain those pending statuses.
- The temporary-index candidate excluded `.codegraph/`, Android `.kotlin/`, `artifacts/`, `data/`, the WhatsApp screenshot, and unreferenced `logo.png`; it includes task-referenced `logo-chico.png` and DND audio resources. Credential-like added-line scans returned no matches. The final six-commit range contains 130 files, 14,748 insertions, and 972 deletions; aggregate `git diff --check` passed.
- Created five Conventional Commits from isolated temporary-index slices: `f0ead2f` (server/shared request and information workflows), `dd10aaa` (web AREA/device/admin workflows), `04826ab` (Android room/notification behavior and functional audio/logo assets), `6d015f0` (LAN and Windows notification receivers), and `1d13d28` (Docker deployment config). The related task trackers and full verification record were committed as `a4a8685` (`docs: record verified feature work and publication plan`). Each staged slice passed `git diff --cached --check` before commit.
- Reconciled the real index only for committed paths, then restored 25 staged deletions whose on-disk files were byte-identical to `HEAD`. Thirteen pre-existing mixed staged/unstaged paths remain untouched because their indexed versions diverge from on-disk files; these paths were not part of the publication commits. Excluded local caches/data/screenshots also remain in the worktree and are not committed.
- Verified the aggregate `initial HEAD..HEAD` diff has no excluded paths and the branch is 62 commits ahead of `master` (56 pre-existing plus 6 publication commits).

## Next Step
Push only `jorlys/feat/lan-notification-agent` to the authorized GitHub repository, verify the remote SHA, then record the outcome in this tracker.

## Relevant Files
- `odd/tasks/area-completed-search-sort.md` — Completed-tab search/sort task; work-unit commit `dd10aaa`.
- `odd/tasks/request-stage-timing-audit.md` — AREA request age/history retention work; work-unit commits `f0ead2f`, `dd10aaa`, and `04826ab`.
- `odd/tasks/room-do-not-disturb-enforcement.md` — DND requirements, implementations, and outstanding checks.
- `odd/tasks/area-console-operational-queue-ui.md` — AREA operational console tasks ACU-06/07 recorded in `f0ead2f` and `dd10aaa`.
- `odd/tasks/lan-notification-receiver.md` — LAN receiver T2 recorded in `6d015f0`; platform-specific verification remains pending.
- `odd/tasks/android-webview-console.md` — Android WebView console work and remaining physical checks.
- `odd/tasks/android-room-kiosk-presence.md` — ROOM kiosk/presence work and remaining checks.
