# ODD Task: Restore the Android AREA console after APK updates

## Objective

Keep a previously paired AREA tablet in its AREA console after an in-place APK update or Android process recreation, then refresh its state from the server without asking the operator to log in or pair it again.

## Problem and Why

The Android pairing already stores the device assignment and bearer token in app-private storage, but the WebView's AREA snapshot is currently only held in process memory. After an APK update recreates the process, the WebView can start without that snapshot and fall back to bootstrap. The foreground receiver service is also only started by pairing, so startup depends on Android's sticky-service recovery behavior.

## Authorized Scope

- Android native receiver snapshot persistence, app startup/service lifecycle, and focused Android tests.
- Local APK build/install/smoke verification on the already authorized SM-T220, without changing station registration or assignment.
- Preserve all unrelated dirty worktree changes; stage and commit only files owned by this feature.

## Constraints and Decisions

- Restore AREA only from the native device pairing; do not persist or restore Admin WebView session/CSRF credentials.
- Keep the device bearer token in its existing Keystore-backed store.
- Persist only the last validated AREA snapshot in app-private internal storage; Android manifest already disables backup. Bind cached data to the current device ID, replace it after server refresh, and clear it on missing/revoked assignment.
- The cached view is a last-known state until foreground receiver revalidation completes. Uninstall or Android Clear Data intentionally removes the app-private pairing and cannot preserve the session.
- Preserve explicit receiver Stop behavior; reopening the app must not silently undo a deliberate Stop.
- Do not mutate remote server state or register, assign, retire, or delete stations.
- **Effective TDD:** off; the latest Android task record says project configuration does not enable RED/GREEN TDD. Use ordinary focused functional checks.
- **Runner:** `apps/android-notification-receiver/gradlew` with `:app:testDebugUnitTest`, `:app:assembleDebug`, `:app:lintDebug`, and `:app:check`.
- **Receipt-driven review:** disabled/unmanaged (`gentle-ai review mode status`, deciding source `clone_local`).
- **Route:** delegated direct writer for both tasks. Trigger evidence: the fix spans at least four lifecycle/storage/test files; implementation touches multiple non-trivial Android files.
- **Delivery strategy:** `ask-on-risk`; AASP-01 measured 372 authored changed lines (+367/-5, including the initial task document). Per the user's instruction to continue, use `feature-branch-chain` on the existing branch `jorlys/feat/lan-notification-agent`; do not create a branch or push/open a PR.

## Tasks

### AASP-01 — Persist and validate the last-known AREA snapshot

- Store the last validated AREA snapshot in app-private storage associated with its device ID.
- Restore it synchronously for the native WebView bridge after process recreation; never restore data for a different/missing device assignment.
- Replace the cache after a fresh server snapshot and clear it with device invalidation/assignment cleanup.
- Add focused tests for round-trip restoration, mismatched device IDs, malformed/inactive/non-AREA snapshots, and clear behavior.
- **Route:** delegated direct writer.
- **Checks:** Android unit tests, then Android host checks if the work unit affects app wiring.
- **Progress:** implementation and Android verification passed; work-unit commit recorded.
- **Commit:** `1603664` (`feat(android): persist validated area snapshots`).

### AASP-02 — Resume the configured receiver without undoing explicit Stop

- Persist whether the native receiver is intended to run; pairing/start enables it and the existing explicit Stop disables it.
- On `MainActivity` startup, resume only when the run intent, native assignment configuration, and protected device token are present; server snapshot validation remains authoritative for an active AREA assignment.
- Migrate a missing run-intent key from legacy installs to enabled only when native assignment configuration and the Keystore-backed token exist. Do not require a snapshot cache for this first fetch; explicit stored `false` always remains stopped.
- Keep the immediate cached AREA view while the service fetches the authoritative server snapshot; if server auth or assignment validation invalidates the station, clear the pairing/cache/run intent and allow the existing bootstrap/login flow.
- Treat `FORBIDDEN_ASSIGNMENT` as assignment invalidation and clear pairing/cache/run intent; do not infer revocation from `DEVICE_ID_MISMATCH` alone.
- Add focused tests for legacy migration, explicit Stop, missing configuration/token, forbidden-assignment cleanup, and non-invalidation of device-ID mismatch.
- Build, lint, run `check`, and `git diff --check`; the parent performs the authorized tablet smoke verification without station mutation.
- **Route:** delegated direct writer.
- **Checks:** Android unit tests, assemble, lint, check, `git diff --check`, and on-device smoke verification.
- **Progress:** initial implementation and host checks passed; parent reports the SM-T220 upgrade/restart smoke restored the AREA console and foreground receiver. Follow-up now keeps `DEVICE_ID_MISMATCH` from triggering assignment cleanup, and host checks passed; post-fix tablet recheck is pending.
- **Commits:** initial implementation `624fd11` (`fix(android): resume paired area receiver`); assignment-invalidation follow-up `420956d` (`fix(android): invalidate forbidden area assignment`).

## Acceptance Criteria

- After an in-place APK update or Activity/process recreation, an assigned AREA tablet opens its previous AREA console without Admin login or re-pairing.
- The previous validated snapshot is available immediately; current state is refreshed by the native foreground receiver.
- Snapshot data for another device is never exposed, and revocation/assignment removal clears the durable cache and returns the app to bootstrap.
- Admin WebView credentials and CSRF tokens are not added to localStorage, SharedPreferences, files, or the native snapshot cache.
- Explicit Stop remains effective after reopening the app.
- APK uninstall/Clear Data is documented as a true session reset, not claimed to be recoverable.

## Verification Evidence

- AASP-01 implementation and focused unit tests are present in the working tree; the snapshot cache uses an app-private `AtomicFile`, binds the envelope to the current device ID, and validates cached payloads with `DeviceSnapshotParser` before exposing them.
- `source /home/jorlys/.local/share/hotel-alert-env/android-toolchain.sh && ./gradlew :app:testDebugUnitTest` from `apps/android-notification-receiver` passes (`BUILD SUCCESSFUL`, 24 actionable tasks; 5 executed). The first invocation without the toolchain environment failed before compilation; after sourcing the existing local toolchain the test task passed.
- `source /home/jorlys/.local/share/hotel-alert-env/android-toolchain.sh && ./gradlew :app:check` passes (`BUILD SUCCESSFUL`, 59 actionable tasks; 12 executed), including debug/release unit-test and lint tasks.
- `git diff --check` passes for tracked AASP-01 changes; the new test file has no trailing whitespace.
- APK build/install is not part of AASP-01; AASP-02 carries the end-to-end host/device checks.

### AASP-02 verification

- `source /home/jorlys/.local/share/hotel-alert-env/android-toolchain.sh && ./gradlew :app:testDebugUnitTest :app:assembleDebug :app:lintDebug :app:check` from `apps/android-notification-receiver` succeeds (`BUILD SUCCESSFUL`, 78 actionable tasks; 16 executed). The focused AASP-02 unit tests had also passed in the prior test invocation; this combined run confirmed all requested Gradle targets remain green.
- The legacy migration test explicitly verifies config + Keystore token are sufficient when the run-intent and snapshot cache are both absent; startup can proceed to fetch the server-authoritative AREA snapshot. Explicit `false` remains stopped.
- After the invalidation follow-up, the same Gradle command passes again (`BUILD SUCCESSFUL`, 78 actionable tasks; 20 executed), including the new `DEVICE_ID_MISMATCH` non-invalidation test and the existing `FORBIDDEN_ASSIGNMENT` cleanup test.
- Parent reports the authorized SM-T220 in-place update/restart restored the AREA console and foreground receiver without changing station assignment. That smoke predates the follow-up below; parent must reinstall and repeat it after the invalidation fix.
- Follow-up closes the review gap: `FORBIDDEN_ASSIGNMENT` still invokes pairing/cache/run-intent cleanup, while `DEVICE_ID_MISMATCH` remains an auth failure without automatic assignment invalidation. Focused tests cover both code paths.
- `git diff --check` and `git diff --cached --check` pass for the AASP-02 source, tests, and task tracker paths.

## Next Step

Parent to reinstall and repeat the authorized tablet smoke without changing station assignment.
