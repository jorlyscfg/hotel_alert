# ODD Task: LAN Notification Receiver

## Objective

Add an isolated LAN/VPN notification receiver for room-service requests. The receiver must consume the existing durable Socket.IO event stream and present delivery through platform adapters without changing the current web/kiosk request workflow.

## Problem and Why

Area staff need immediate request notifications on Windows devices and non-dedicated Android tablets. The current web UI is tied to the browser lifecycle and is not a safe place to add background behavior. A separate receiver keeps notification delivery additive, read-only, and independently recoverable.

## Authorized Scope

- Add new notification-receiver/core code, focused tests, and narrowly relevant documentation/configuration.
- Reuse the existing `DurableRealtimeEvent` envelope, Socket.IO authentication, area assignment, replay, and snapshot mechanisms.
- Keep the receiver read-only with respect to requests; it must not accept, transition, acknowledge, or mutate hotel state.
- Preserve all pre-existing worktree changes listed below; do not reformat, revert, or include them in work-unit commits.

## Constraints and Decisions

- Transport: LAN/VPN only; no cloud push service.
- Existing ROOM/AREA web UI, queue/modal behavior, and acceptance flow remain unchanged.
- A LAN receiver can only deliver while its process/OS background service is alive; it cannot wake a fully terminated process.
- The repository currently has no native Windows/Android receiver, Flutter/Cargo project, PWA push layer, or platform notification adapter. Platform-specific shells are separate work after the protocol/core is stable.
- Effective TDD: strict, from repository instructions; runner starts with `corepack pnpm test:unit`.
- Delivery strategy: `ask-on-risk`; estimated first feature slice is under the 400 authored-line advisory budget. Chain strategy is not selected.

## Work Units

### T1 — Define and implement the isolated receiver core

- **Route:** single bounded writer; implementation spans a new package/module and tests.
- **Acceptance:** typed event filtering, area targeting, cursor progression, duplicate/out-of-order suppression, reconnect/replay-safe behavior, and a pluggable notification sink are covered by tests; no request mutation occurs.
- **Checks:** focused Vitest tests, root lint, and root typecheck.
- **Rollback boundary:** remove only the new receiver core files and their tests.

### T2 — Wire the LAN Socket.IO receiver runtime

- **Route:** delegated direct writer if T1 establishes a stable contract.
- **Acceptance:** receiver authenticates with its own assigned device token, reconnects, sends heartbeat, requests replay/snapshot as required, and forwards only eligible area events to the core/sink.
- **Checks:** unit tests plus an integration test against the existing realtime server where practical.
- **Rollback boundary:** remove only the receiver runtime wiring and its integration tests; leave existing server/UI behavior intact.

### T3 — Add platform adapter boundary and operator documentation

- **Route:** delegated direct writer only after the platform runtime choice is supported by the available toolchain.
- **Acceptance:** Windows/Android-specific delivery is isolated behind the sink contract, with lifecycle/permission/foreground-process limitations documented. No unsupported native implementation is faked.
- **Checks:** adapter contract tests and documentation readback.
- **Rollback boundary:** remove only adapter/documentation files.

## Progress

- [x] T1 — implemented and corrected; pending work-unit commit
- [ ] T2 — not started
- [ ] T3 — not started

### Verification Evidence

- RED: `corepack pnpm exec vitest run tests/unit/notification-receiver-core.test.ts` failed before implementation because the receiver module did not exist.
- RED (correction): malformed recognized request events advanced the cursor, and queued events bypassed a failed sink delivery.
- GREEN: `corepack pnpm exec vitest run tests/unit/notification-receiver-core.test.ts` passed with 10 tests.
- Full unit suite: `corepack pnpm test:unit` passed with 35 files and 358 tests.
- Lint: `corepack pnpm lint` passed.
- Typecheck: `corepack pnpm typecheck` passed for all 4 configured workspace projects.
- Receiver package build: `corepack pnpm --filter @hotel/notification-receiver build` passed.
- `git diff --check` passed.
- No commit or staging was performed; the pre-existing dirty worktree remains untouched outside this task's files.
- Branch: `jorlys/feat/lan-notification-agent`.
- Worktree was already dirty before this feature; those changes are not evidence for this feature and must remain uncommitted by this task.

## Pre-existing Worktree State

The branch was created from the already-dirty default branch. Existing modifications include `README.md`, server config/database/domain/http/realtime files, web files, shared files, deployment docs, Playwright configuration, and many existing tests. Existing untracked paths include `.codegraph/`, Docker files, `data/`, server migrations/information/integration files, web information/admin files, and related tests. Confirm the exact baseline with `git status --short` before each commit and stage only files belonging to this task.

## Next Step

Parent stages and commits only the T1 work unit. T2 can then wire the LAN Socket.IO runtime against the stable core contract.
