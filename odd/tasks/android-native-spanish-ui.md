# Android native UI in Spanish

## Objective
Ensure every app-owned user-facing string in the native Android experience is Spanish for Spanish-speaking hotel operators.

## Problem and why
The native Android app currently mixes Spanish request notifications with English connection setup, diagnostics, maintenance, status/error feedback, service notifications, and launcher metadata. This makes the operator-facing Android experience inconsistent even though the operators are Spanish-speaking.

## Scope and constraints
- Translate app-owned text shown by native Android screens, dialogs, status/error feedback, notifications, foreground-service notifications, and app/launcher metadata.
- Keep the web platform rendered inside the WebView out of scope; it has its own customer/admin language behavior.
- Keep dynamic room/service/area names and technical identifiers unchanged; those are data, not native labels.
- Android-owned Settings, Home chooser, permission prompts, and other system UI remain controlled by the device's Android language. Translate only Hotel Alert's surrounding copy.
- Use Spanish in the default Android `values/strings.xml`; this ensures the app-owned copy remains Spanish regardless of the device language without adding a language selector.
- Do not change app behavior, Android permissions, service policy, device state, or ADB-install either test device as part of this task.
- Preserve unrelated working tree and shared index changes; do not push or create a pull request.

## Authorized scope
The user's request explicitly authorizes changing the native Android app's user-facing copy to Spanish. No device/remote operation is authorized by this request.

## Task checklist

### ANDR-ES-01 — Translate native Android copy
- [x] Translate Compose setup/recovery, diagnostics, PIN/maintenance, kiosk/launcher, and app-owned status/error copy.
- [x] Translate Android app label, foreground-service metadata, notification channels, service notifications, action labels, and action-failure messages.
- [x] Add focused assertions for Spanish receiver status labels; existing notification-surface assertions preserve dynamic server-provided names.
- [x] Audit app-owned user-visible native strings for leftover English; product names, acronyms, IDs/URLs, dynamic server data, internal logs/identifiers, and Android-owned system UI are excluded.
- [x] Run Android unit tests, assemble, lint, `check`, and whitespace validation; record actual results.
- [ ] Commit only the task's source/test/documentation hunks in a work-unit commit; leave the shared Git index untouched.

## Acceptance criteria
- All app-authored static text visible on native Android screens and in Hotel Alert notifications/system notifications is Spanish.
- The client/admin platform UI inside the WebView is unchanged.
- Dynamic room/service/area names, URLs, IDs, enum/protocol values, and product name are preserved.
- Existing notification/action behavior and maintenance/kiosk behavior remain unchanged.
- Android test/build/lint/check and scoped whitespace checks pass.

## Applicable checks
- TDD: OFF, inherited from current Android feature tracker.
- Runner: `cd apps/android-notification-receiver && source /home/jorlys/.local/share/hotel-alert-env/android-toolchain.sh && ./gradlew :app:testDebugUnitTest :app:assembleDebug :app:lintDebug :app:check`
- `git diff --check` and a scoped scan of native app UI/resource strings.
- RDD: explicitly disabled by clone-local configuration (`gentle-ai review mode status`); no RDD review will be initiated. Delivery is disabled/unmanaged.

## Route and trigger evidence
- Route: delegated direct.
- Mapping trigger: the copy spans 4+ native files. `/root/room_maint_surface_map` completed a read-only CodeGraph-first map before implementation.
- Writer trigger: comprehensive coverage crosses multiple non-trivial Compose, Activity, notification, resource, and manifest files; implementation is delegated to one bounded writer.
- Forecast: approximately 250 authored changed lines, excluding generated files.
- Delivery strategy: `ask-on-risk` (default); expected to remain under the delivery budget.

## Progress and verification evidence
- Exploration: CodeGraph mapped native screens, notifications, call sites, and the WebView boundary. `strings.xml` and the manifest were inspected; Android system-owned dialogs/settings are not app-localized.
- Implementation: completed. Setup/recovery, diagnostics state labels, PIN/maintenance, kiosk controls, notification/service copy, app label, and foreground-service metadata are Spanish. No behavior changes were made.
- Verification: `:app:testDebugUnitTest`, `:app:assembleDebug`, `:app:lintDebug`, and `:app:check` passed (78 tasks: 39 executed, 39 up-to-date); `git diff --check` and a scoped trailing-whitespace/native-copy audit passed. No ADB/device operation was performed.
- Work-unit commit: pending isolated-index commit; the shared Git index is unchanged.
- Next step: create the work-unit commit with only ANDR-ES-01 hunks, then record its identity here.

## Relevant files
- `apps/android-notification-receiver/app/src/main/java/com/hotelalert/notificationreceiver/ui/RoomMaintenanceScreens.kt` — native maintenance/PIN screen.
- `apps/android-notification-receiver/app/src/main/java/com/hotelalert/notificationreceiver/ui/ServerOriginSetupScreen.kt` — native server setup and reconnection UI.
- `apps/android-notification-receiver/app/src/main/java/com/hotelalert/notificationreceiver/ui/ReceiverScreen.kt` — native receiver diagnostics surface.
- `apps/android-notification-receiver/app/src/main/java/com/hotelalert/notificationreceiver/MainActivity.kt` — native status and maintenance feedback.
- `apps/android-notification-receiver/app/src/main/res/values/strings.xml` — app label, notification, and service copy.
- `apps/android-notification-receiver/app/src/main/AndroidManifest.xml` — launcher label and foreground-service disclosure metadata.
- `apps/android-notification-receiver/app/src/main/java/com/hotelalert/notificationreceiver/notification/NotificationMapper.kt` — Spanish notification labels with dynamic server-provided values.
- `apps/android-notification-receiver/app/src/test/java/com/hotelalert/notificationreceiver/NotificationSurfacesTest.kt` — notification mapping assertions.
