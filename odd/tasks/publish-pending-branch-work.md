# Publish Pending Hotel Alert Branch Work

> **Active follow-up (2026-10-06):** RWP-05 through RWP-09 tracks the newly authorized publication of the current pending source work and migration to `dev`. RWP-01 through RWP-04 below records the completed 2026-09-28 push-only cycle; its historical scope and remote SHA are not current status.

## Current Follow-up — Publish Current Work and Migrate to `dev`

### Objective
Publish the current, user-authorized code, tests, and project documentation to the public GitHub repository and move the local development branch to a new remote `dev` branch, while keeping hotel runtime data and local/generated material private.

### Problem and Why
The user requested that the pending work be uploaded to GitHub and the repository moved to `dev`. The configured repository is public, the current local branch has 18 commits beyond its remote feature branch, and the real index mixes staged and unstaged versions. The local tree also contains an operational SQLite database, uploaded hotel media, screenshots, caches, and artifacts. A broad stage/push could expose hotel data or publish stale staged versions.

### Authorized Scope and Acceptance Criteria
- Include current intended source, tests, deployment docs, and relevant ODD task documents, including the migration that seeds the default administrator.
- Exclude `data/` (live SQLite/WAL/SHM and uploaded variants), `image-info/`, unreferenced root media, WhatsApp/device screenshots, `artifacts/`, `.codegraph/`, Android `.kotlin/`, caches, logs, and secrets from the public repository.
- Do not include a binary/local SQLite database. Fresh deployments create the database and apply migrations; migration 019 seeds `admin/admin` only for an empty admin table, stores a scrypt hash, and enforces first-login password replacement. Docker persists the runtime database in the `hotel-data` volume.
- Create `dev` from the validated full source history because `origin/dev` does not currently exist. Preserve `jorlys/feat/lan-notification-agent`; do not delete it or change GitHub's default branch (`master`) without a separate request.
- Push the resulting `dev` branch to `origin` and verify its remote SHA equals the intended local commit. Do not create a PR or merge into `master` as part of this direct branch migration.
- Preserve incomplete device, live-server, Windows, and other per-feature checks; do not mark them passed without evidence.

### Constraints and Decisions
- User authorized use of the GitHub CLI session for GitHub publication/migration and confirmed the sanitized scope above.
- `origin` is `https://github.com/jorlyscfg/hotel_alert.git`; the repository is public. Remote default is `master`; remote `dev` is absent. The current local feature branch is 18 commits ahead of `origin/jorlys/feat/lan-notification-agent`.
- The real index contains mixed staged/unstaged paths (including `MM` entries) and is not a safe snapshot. Use an isolated temporary Git index based on `HEAD` for commits from the reviewed on-disk versions; never use `git add -A` or commit the existing index wholesale.
- Use Conventional Commit messages; do not add Co-Authored-By/AI attribution or modify global Git/credential configuration.
- TDD is not applicable to this publication/migration work unit: it packages existing behavior rather than implementing a new behavior. The user previously selected TDD for feature implementation; run functional checks below against the current intended source.
- Receipt-driven development is off (`clone_local` decision); do not start review ceremonies. No PR is requested, so the previously selected `stacked-to-main` strategy for the admin-password feature is not applied to this direct branch migration.
- Delivery strategy: `exception-ok` — this task is a direct, user-authorized migration to `dev`, not PR delivery; group changes into work-unit commits and publish one `dev` branch without opening a PR.
- The reviewed temporary-index manifest contains 90 intended text source/test/documentation paths and totals 7,764 authored changed lines (+6,455/-1,309). Generated and local data/media files are excluded from this count.

### Tasks and Acceptance Criteria — Current Follow-up

#### RWP-05 — Finalize the safe publication manifest
- [x] Inventory staged, unstaged, deleted, and untracked changes and map coherent source work streams to their task trackers.
- [x] Confirm that the local SQLite database is runtime state, not a deployment seed; verify migration-based `admin/admin` bootstrap and the explicit exclusion of local media/artifacts/caches.
- [x] Produce and review the exact publishable file manifest; scan included changes for secrets and verify no excluded paths are staged.
- Route: delegated direct for inventory. Trigger evidence: understanding spans over four files and multiple independent product areas; delegated read-only inventory completed.
- Evidence: `/tmp/hotel-alert-publish-manifest.txt` contains 90 paths and exactly matches the isolated candidate index `/tmp/hotel-alert-rwp05-index-1089730`; the candidate index has 7,764 authored changed lines. Both candidate and real-index path audits found no excluded DB, media, screenshot, artifact, cache, or local-data paths. Candidate `git diff --cached --check` passed. A custom regex scan reviewed added lines and identified only synthetic test fixtures; no dedicated secret-scanning tool (`gitleaks`, `trufflehog`, or `detect-secrets`) is installed, so this is not a comprehensive scanner result.

#### RWP-06 — Verify the publishable source state
- [ ] Run `corepack pnpm test`.
- [ ] Run `corepack pnpm lint && corepack pnpm typecheck && corepack pnpm build`.
- [ ] Run `E2E_PORT=43751 corepack pnpm test:e2e`.
- [ ] Run Android host checks when the documented local toolchain is available: `source "$HOME/.local/share/hotel-alert-env/android-toolchain.sh" && ./gradlew --offline :app:testDebugUnitTest :app:lintDebug :app:check`.
- [ ] Record failed, unavailable, or pending checks honestly; retain physical-device and Windows checks as pending unless verified.
- Route: direct verification. TDD mode: not applicable to publication; these are functional checks of existing code.

#### RWP-07 — Create safe Conventional Commits
- [ ] Create logical work-unit commits from the reviewed on-disk source/docs/tests/task-document contents using a temporary index based on current `HEAD`.
- [ ] Keep local DB/uploads/screenshots/artifacts/caches/secrets out; preserve the real index and all unrelated local files.
- [ ] Verify each commit with `git diff --check`, secret scan, path audit, and review of the resulting history; record identities here.
- Route: direct publication orchestration; the current operation packages existing changes and does not author feature behavior.

#### RWP-08 — Migrate and publish `dev`
- [ ] Create local `dev` at the validated post-commit `HEAD` (remote `dev` is absent); preserve the existing feature branch and remote `master` default.
- [ ] Push only `dev` to the authorized `origin` and verify the remote `dev` SHA equals the local `dev` `HEAD`.
- [ ] Confirm no PR, merge to `master`, default-branch change, or deletion of the feature branch occurred.
- Route: direct remote operation, authorized by the user's request to migrate to `dev`.

#### RWP-09 — Record and verify final migration evidence
- [ ] Record final commit IDs, test outcomes, excluded-path audit, local branch, remote `dev` SHA, and remaining pending checks.
- [ ] Commit the final tracker evidence with a Conventional Commit and push it to `dev`; re-verify the final remote SHA.
- Route: direct documentation/evidence update.

### Current Progress and Evidence
- `gh auth status --hostname github.com` succeeded after explicit user authorization; account is `jorlyscfg` with HTTPS Git operations and `repo` scope. No credential values are recorded.
- Local branch: `jorlys/feat/lan-notification-agent`; `HEAD` is `6985c03210dce7cdfd26aef7a8946e9a19579aff`. Worktree: 77 tracked paths changed (+4,623/-1,421 in unstaged diff), 12 staged paths overlapping with unstaged work, 2 deletions, and 33 untracked entries.
- Remote `origin` heads observed: `master` at `803e272cec42fc59b863a0a05a0652c65913b76c`, feature branch at `de127e6d9b5cc9821359e916d8d2def89a3e3a6a`; no `dev` branch. Feature branch is 18 commits ahead of its remote-tracking ref.
- Read-only inventory found untracked local DB/images/uploads/screenshots/cache/artifacts alongside valid source and test files. The candidate path audit and limited regex scan are complete; see RWP-05 evidence and its scanner limitation above.
- Database verification: `apps/server/src/db/connection.ts` creates the configured database and applies registered migrations; `apps/server/src/db/migrations/019_admin_first_login_password.ts` seeds the hashed default account conditionally; deployment docs and Docker config persist runtime state in a named volume. No Docker run or migration execution was performed during this investigation.
- Existing related trackers: `odd/tasks/android-room-kiosk-presence.md`, `odd/tasks/android-room-boot-visible-launch.md`, `odd/tasks/room-custom-screensaver.md`, `odd/tasks/admin-live-queue-timing.md`, and `odd/tasks/admin-queue-dnd-responsible.md`. Their open verification items remain open.
- No repository file edits, staging, commits, local branch switch, push, merge, or default-branch change has occurred in this follow-up.

### Next Step — Current Follow-up
Run the specified functional checks against the reviewed manifest, then create safe work-unit commits.

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
- [x] Push only `jorlys/feat/lan-notification-agent` to the explicitly authorized GitHub repository using the active GitHub CLI session.
- [x] Verify the remote branch resolves to the published local `HEAD`; do not create a PR or merge.

## Progress and Evidence
- Read-only delegated inventory found the real index contains stale staged deletions while restored/revised files exist in the working tree; current index contents are not the intended final tree.
- Read-only inventory identified exclusions: `.codegraph/` (large SQLite index/WAL), `.kotlin/`, `artifacts/`, local `data/` (SQLite/WAL/SHM and uploaded files), the user screenshot, and unreferenced `logo.png`.
- Functional assets `hotel_alert_dnd_active.wav` and `hotel_alert_dnd_inactive.wav` are application resources. `logo-chico.png` is documented as the launcher icon source; verify its direct reference before including.
- Current source/work streams include AREA completed search and elapsed request history, DND, Android ROOM/WebView, LAN receiver, catalog/information, and deployment/configuration. Existing per-feature trackers and verification state remain authoritative; several host/device checks remain pending.
- `corepack pnpm test` passed: 48 unit files / 511 tests and 4 integration files / 38 tests. The initial integration DND assertion expected an accepted service request while DND was on, contradicting the implemented 409 `RESOURCE_CONFLICT` contract; corrected the assertion to verify rejection and retry after disabling DND, then reran the full suite successfully.
- `corepack pnpm lint`, `corepack pnpm typecheck`, and `corepack pnpm build` passed. Lint initially found an unused `t` binding in `App.tsx`; removed only that binding after confirming the locale-only component did not use it.
- `E2E_PORT=43751 corepack pnpm test:e2e` passed all 9 tests. The initial run exposed stale selectors expecting a login heading absent from the current compact form; switched to the accessible username field and reran. The unique port and temporary database avoid touching any existing app/server data.
- Android host verification passed offline: `:app:testDebugUnitTest`, `:app:lintDebug`, and `:app:check` (`BUILD SUCCESSFUL`, 59 actionable tasks). No Windows host, physical-device, live-server, or database-migration checks were run as part of repository publication; existing feature trackers retain those pending statuses.
- The temporary-index candidate excluded `.codegraph/`, Android `.kotlin/`, `artifacts/`, `data/`, the WhatsApp screenshot, and unreferenced `logo.png`; it includes task-referenced `logo-chico.png` and DND audio resources. Credential-like added-line scans returned no matches. The current branch range contains 130 files, 14,748 insertions, and 972 deletions; aggregate `git diff --check` passed.
- Created five Conventional Commits from isolated temporary-index slices: `f0ead2f` (server/shared request and information workflows), `dd10aaa` (web AREA/device/admin workflows), `04826ab` (Android room/notification behavior and functional audio/logo assets), `6d015f0` (LAN and Windows notification receivers), and `1d13d28` (Docker deployment config). The related task trackers and full verification record were committed as `a4a8685` (`docs: record verified feature work and publication plan`). Each staged slice passed `git diff --cached --check` before commit.
- Reconciled the real index only for committed paths, then restored 25 staged deletions whose on-disk files were byte-identical to `HEAD`. Twelve pre-existing mixed staged/unstaged paths remain untouched because their indexed versions diverge from on-disk files; these paths were not part of the publication commits. Excluded local caches/data/screenshots also remain in the worktree and are not committed.
- Verified the aggregate diff from the initial branch tip has no excluded paths; the pre-existing 56-commit feature-branch history remains intact. This tracker evidence follow-up is `8e648e0` (`docs: record publication verification evidence`).
- The authorized push created `jorlys/feat/lan-notification-agent` on `https://github.com/jorlyscfg/hotel_alert.git`. `git ls-remote` returned `ba9d350544dec80dd57fc3194412ce8f2f44c0a7`, identical to local `HEAD` at that push. Git used the active `gh auth git-credential` helper for this command only; no global credential configuration was changed. No pull request or merge was created.

## Next Step
The branch push and remote-SHA verification are complete. This final tracker status update is also part of the authorized branch publication; no PR or merge is requested.

## Relevant Files
- `odd/tasks/area-completed-search-sort.md` — Completed-tab search/sort task; work-unit commit `dd10aaa`.
- `odd/tasks/request-stage-timing-audit.md` — AREA request age/history retention work; work-unit commits `f0ead2f`, `dd10aaa`, and `04826ab`.
- `odd/tasks/room-do-not-disturb-enforcement.md` — DND requirements, implementations, and outstanding checks.
- `odd/tasks/area-console-operational-queue-ui.md` — AREA operational console tasks ACU-06/07 recorded in `f0ead2f` and `dd10aaa`.
- `odd/tasks/lan-notification-receiver.md` — LAN receiver T2 recorded in `6d015f0`; platform-specific verification remains pending.
- `odd/tasks/android-webview-console.md` — Android WebView console work and remaining physical checks.
- `odd/tasks/android-room-kiosk-presence.md` — ROOM kiosk/presence work and remaining checks.
