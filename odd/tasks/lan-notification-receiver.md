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
- The repository has no native Windows adapter, Flutter/Cargo project, or PWA push layer. The native Android/Compose receiver is now implemented as a separate adapter over the stable protocol/core.
- Effective TDD: strict, from repository instructions; runner starts with `corepack pnpm test:unit`.
- Delivery strategy: `ask-on-risk`; estimated first feature slice is under the 400 authored-line advisory budget. Chain strategy is not selected.

## Work Units

### T1 — Define and implement the isolated receiver core

- **Route:** single bounded writer; implementation spans a new package/module and tests.
- **Acceptance:** typed event filtering, area targeting, cursor progression, duplicate/out-of-order suppression, reconnect/replay-safe behavior, and a pluggable notification sink are covered by tests; no request mutation occurs.
- **Checks:** focused Vitest tests, root lint, and root typecheck.
- **Rollback boundary:** remove only the new receiver core files and their tests.

### T2 — Wire the LAN Socket.IO receiver runtime

- **Route:** single bounded writer after T1 established a stable contract.
- **Acceptance:** receiver authenticates with its own assigned device token, reconnects, sends heartbeat, requests replay/snapshot as required, and forwards only eligible area events to the core/sink.
- **Checks:** unit tests plus an integration test against the existing realtime server where practical.
- **Rollback boundary:** remove only the receiver runtime wiring and its integration tests; leave existing server/UI behavior intact.

### T3 — Add platform adapter boundary and operator documentation

- **Route:** delegated direct writer only after the platform runtime choice is supported by the available toolchain.
- **Acceptance:** Windows/Android-specific delivery is isolated behind the sink contract, with lifecycle/permission/foreground-process limitations documented. No unsupported native implementation is faked.
- **Checks:** adapter contract tests and documentation readback.
- **Rollback boundary:** remove only adapter/documentation files.

## Progress

- [x] T1 — implemented and corrected; work-unit commit recorded
- [x] T2 — implemented, verified, and committed as `6d015f0` (`feat(notifications): add LAN and Windows receivers`)
- [ ] T3 — in progress; target scope is both Windows and Android

### Verification Evidence

- RED: `corepack pnpm exec vitest run tests/unit/notification-receiver-core.test.ts` failed before implementation because the receiver module did not exist.
- RED (correction): malformed recognized request events advanced the cursor, and queued events bypassed a failed sink delivery.
- GREEN: `corepack pnpm exec vitest run tests/unit/notification-receiver-core.test.ts` passed with 10 tests.
- T1 baseline unit suite: `corepack pnpm test:unit` passed with 35 files and 358 tests.
- Lint: `corepack pnpm lint` passed.
- T1 baseline typecheck: `corepack pnpm typecheck` passed for all 4 configured workspace projects.
- Receiver package build: `corepack pnpm --filter @hotel/notification-receiver build` passed.
- `git diff --check` passed.
- Work-unit commit: `99d97c6` (`feat(notification-receiver): add LAN receiver core`).
- T2 correction RED: the new expired-token `connect_error` regression test failed before adding `TOKEN_ROTATION_EXPIRED` to the authentication-failure set.
- T2 focused runtime tests: `corepack pnpm exec vitest run tests/unit/notification-receiver-runtime.test.ts` passed with 13 tests, including the expired-token reconnect regression.
- Full unit suite: `corepack pnpm test:unit` passed with 36 files and 371 tests after building the core receiver dependency.
- Integration suite: `corepack pnpm test:integration` passed with 4 files and 37 tests.
- Root build: `corepack pnpm build` passed; Vite reported the existing large-chunk warning for the web bundle.
- Root typecheck: `corepack pnpm typecheck` passed for all 5 typed workspace projects, including the new LAN package.
- LAN runtime package build: `corepack pnpm --filter @hotel/notification-receiver-lan build` passed.
- Compiled LAN module smoke load passed without opening a network connection.
- Parent spot-check: `corepack pnpm exec vitest run tests/unit/notification-receiver-runtime.test.ts` passed with 13 tests.
- Native risk assessment: medium, `slice_budget_reached`; receipt-driven development was off at clone scope, so no review transaction was started and ordinary verification remains the delivery evidence.
- T2 runtime and adapter integration were committed through an isolated temporary index as `6d015f0`; no blanket staging was used.
- The pre-existing dirty worktree remains untouched outside this task's files.
- Branch: `jorlys/feat/lan-notification-agent`.
- Worktree was already dirty before this feature; those changes are not evidence for this feature and must remain uncommitted by this task.

## T3 Mapping

- Mapping route: delegated direct exploration because the platform decision spans more than four files and two platform ecosystems.
- No native Windows adapter exists; the repository has no Electron, WinRT, .NET, tray, installer, or service surface.
- A native Android/Compose adapter now exists under `apps/android-notification-receiver`, including Gradle/Kotlin, manifest, foreground-service, notification, secure-storage, and cursor boundaries.
- The existing platform seam is `NotificationSink` plus `DurableCursorStore`; Android now provides concrete notification and cursor implementations behind those interfaces.
- The Android target is now implemented as a native Jetpack Compose application with explicit lifecycle, notification, and secure-storage boundaries.
- Smallest coherent breakdown: boundary/operator documentation, the Android Compose adapter, then a Windows adapter after choosing its runtime/distribution model.
- Android unit/build/lint/check verification is available through the local toolchain; device/emulator verification remains pending. Windows verification remains unavailable on Linux.

### T3 Work Units

- [x] T3-DOC — document the shared adapter contract, Node.js Windows service target, native Android Compose target, deployment boundaries, secure storage responsibilities, and current verification limits. **Route:** delegated direct writer.
- [~] T3-W — implement the portable Windows Node.js service boundary and host-side contract tests. **Route:** delegated direct writer; lifecycle/config/cursor behavior is host-verified, while Windows service, credential-store, ACL, installer, boot, and toast verification remain blocked on Linux.
- [~] T3-A — implement and harden the native Android Compose adapter now that the JDK and Android SDK toolchains are available. **Route:** delegated direct writer; the Gradle wrapper and Android project exist, host-side checks pass, and device/emulator verification remains pending.

#### T3-A review corrections

- [x] T3-A1 — preserve failed sink/cursor deliveries for retry instead of losing the child coroutine and leaving the core blocked.
- [x] T3-A2 — preserve HTTP authentication error codes from snapshot responses so `401`/`403` reach the existing `AUTH_FAILED` path.
- [x] T3-A3 — make cleartext LAN connectivity explicit for the supported `http://` deployment origin under target SDK 35.
- [x] T3-A4 — handle `device.token.rotation.required` without advancing the cursor or treating the event as delivered.
- **Route:** one delegated direct writer; strict TDD with focused regression tests before production changes.
- **Acceptance:** each finding has a failing regression test followed by a minimal implementation; all Android host-side tests, debug assembly, lint, check, and diff checks pass.
- **Current status:** all four corrections are implemented and host-verified; physical/emulated Android validation remains pending.

#### T3-W verification

- **Route:** delegated direct writer followed by a fresh independent read-only verifier; strict TDD was used for the lifecycle, configuration, and token-rotation corrections.
- **RED:** `corepack pnpm exec vitest run tests/unit/windows-notification-receiver.test.ts` failed with 3 regressions before the lifecycle/configuration fixes: repeated starts created a second runtime, stopping during credential loading still created a runtime, and unsafe configuration values were accepted.
- **GREEN:** the same focused test command passed with 11 tests after the minimal fixes.
- **Checks:** the Windows package build and typecheck, targeted ESLint, `corepack pnpm test:unit`, `corepack pnpm typecheck`, `corepack pnpm build`, and `git diff --check` passed after the fixes; the full unit suite now passes with 37 files and 383 tests.
- **Token rotation correction:** the shared Node runtime now matches Android by handling synchronized `device.token.rotation.required` as `TOKEN_ROTATION_REQUIRED` before core processing; it stops reconnects without cursor advancement or `client.event.received` acknowledgement, while pre-synchronization events remain buffered.
- **Token rotation RED/GREEN:** the focused regression first failed because the event was consumed as an unsupported durable event; it now passes with the runtime suite.
- **Root lint limitation:** the current `corepack pnpm lint` still fails only in generated Android `report.js` files because `window` is undefined; no audited T3-W file is implicated.
- **Current status:** T3-W and the shared Node token-rotation correction are host-verified partial; no Windows OS behavior is claimed as verified on Linux.

### T3 Toolchain Evidence

- Node.js `v24.13.1`, Corepack `0.34.6`, and `corepack pnpm 9.15.5` are available; standalone `pnpm` remains intentionally off PATH.
- JDK/Javac `17.0.20` are installed under `/home/jorlys/.local/jdks/openjdk-17`; source `/home/jorlys/.local/share/hotel-alert-env/android-toolchain.sh` to configure the current shell.
- Android command-line tools `12.0`, platform-tools/`adb` `37.0.1`, Android platform `android-35`, and build-tools `35.0.1` are installed under `/home/jorlys/.local/android-sdk`.
- `corepack pnpm install --frozen-lockfile --offline --ignore-scripts` passed; package and lockfile contents were unchanged and the worktree was preserved.
- Gradle is intentionally not installed system-wide; the distro candidate `4.4.1` is unsuitable for modern Android. The Android project uses its checked-in Gradle wrapper.
- `corepack pnpm --filter @hotel/notification-receiver-lan build` passed.
- `corepack pnpm test:unit` passed with 37 files and 383 tests after the T3-W adapter and shared token-rotation corrections.
- `corepack pnpm test:integration` passed with 4 files and 37 tests.
- Earlier host baseline: `corepack pnpm typecheck` and `corepack pnpm lint` passed before the generated Android report files existed; the current lint limitation is recorded below.
- Current root lint is blocked only by generated Android `report.js` files under `apps/android-notification-receiver/app/build/reports/`; targeted T3-W ESLint passed.
- Android project created at `apps/android-notification-receiver` with a Gradle wrapper and native Compose app.
- Android RED: `AndroidLanReceiverTest.failedStartupCanBeRetriedAfterTransientError` failed before the retry-state fix because a failed startup permanently left `startRequested` set.
- Android GREEN: `rtk gradlew :app:testDebugUnitTest --tests 'com.hotelalert.notificationreceiver.AndroidLanReceiverTest.failedStartupCanBeRetriedAfterTransientError' --console=plain` passed; `BUILD SUCCESSFUL in 5s`, 24 actionable tasks (5 executed, 19 up-to-date).
- Android unit suite: `rtk gradlew test --console=plain` passed; `BUILD SUCCESSFUL in 5s`, 49 actionable tasks (6 executed, 43 up-to-date).
- Android build/lint/check: `rtk gradlew assembleDebug lintDebug check --console=plain` passed; `BUILD SUCCESSFUL in 11s`, 78 actionable tasks (10 executed, 68 up-to-date).
- Android startup retry correction resets transient startup state and detaches/disconnects a partially created socket before reporting `ERROR`.
- T3-A correction RED/GREEN: delegated writer reported failing regressions before implementation and passing regressions after implementing event requeue, snapshot auth-code propagation, explicit cleartext policy, and token-rotation handling.
- T3-A focused parent spot-check: `rtk gradlew :app:testDebugUnitTest --tests 'com.hotelalert.notificationreceiver.AndroidLanReceiverTest.failedEventIsRequeuedBeforeLaterEventsCanBeDelivered' --tests 'com.hotelalert.notificationreceiver.AndroidLanReceiverTest.snapshotAuthenticationFailureUsesTheAuthFailedState' --tests 'com.hotelalert.notificationreceiver.AndroidLanReceiverTest.tokenRotationRequiredStopsWithoutAdvancingOrAcknowledgingTheEvent' --tests 'com.hotelalert.notificationreceiver.HttpDeviceSnapshotClientTest.preservesTheStructuredCodeFromAnUnauthorizedSnapshotResponse' --console=plain` passed; `BUILD SUCCESSFUL`.
- Fresh parent host verification after T3-A corrections: `rtk gradlew test assembleDebug lintDebug check --console=plain` passed; `BUILD SUCCESSFUL`, 78 actionable tasks (1 executed, 77 up-to-date).
- Fresh parent `git diff --check` passed after T3-A corrections.
- Android generated `.gradle/` and `build/` directories are ignored by the repository root `.gitignore`; source/configuration files remain visible for review.
- No Android device/emulator is available, so notification rendering, foreground-service behavior, permission flow, and background lifecycle remain unverified on-device.
- No Windows runtime or OS-notification verification is available in the current Linux environment; the T3-W adapter is host-verified partial only.
- The shared Node LAN runtime now classifies synchronized `device.token.rotation.required` as `TOKEN_ROTATION_REQUIRED` without cursor advancement or acknowledgement; the regression is host-verified.
- T3-DOC documentation readback passed; the current `git diff --check` is clean after the Android retry correction, scoped ignore-rule update, and T3-A review corrections.

## Pre-existing Worktree State

The branch was created from the already-dirty default branch. Existing modifications include `README.md`, server config/database/domain/http/realtime files, web files, shared files, deployment docs, Playwright configuration, and many existing tests. Existing untracked paths include `.codegraph/`, Docker files, `data/`, server migrations/information/integration files, web information/admin files, and related tests. Confirm the exact baseline with `git status --short` before each commit and stage only files belonging to this task.

## Next Step

T1 work-unit commit `99d97c6` and T2 work-unit commit `6d015f0` are recorded. T3-DOC is complete; T3-A and T3-W have host-verified implementations in `04826ab` and `6d015f0`, respectively. Repository unit tests/typecheck/build and Android host checks passed. Windows OS/service/credential-store behavior and physical Android notification behavior remain unverified in this Linux session; keep T3 partial until those checks are performed.
