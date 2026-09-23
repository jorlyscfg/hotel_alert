# Android alert surfaces and audible fallback

## Objective

Make new room requests noticeable while the AREA APK is minimized or closed by keeping the reliable heads-up notification, adding a user-controlled Bubble surface, and ensuring an audible alert path when Android/Samsung does not emit the channel sound.

## Problem

The tablet currently receives a valid HIGH-priority heads-up notification, but the operator reported no audible bell. Android does not permit the web UI to force a modal over the launcher, and full-screen intents are restricted on Android 14.

## Authorized scope

- Keep alerts limited to `request.created` while the console is backgrounded.
- Preserve the existing actionable heads-up notification and request transition action.
- Add a Bubble as a secondary, opt-in Android surface; never make it the only alert path.
- Add an audible fallback that runs only for eligible new requests and remains bounded/idempotent.
- Do not register, assign, retire, delete, or mutate stations.

## Constraints

- Android 14/API 34 tablet, target SDK 35.
- Existing notification channel is `hotel-alert-requests-v3` with bundled bell sound.
- Existing foreground receiver service must remain the lifecycle anchor for background delivery.
- User controls notification/channel/bubble settings; the app must degrade gracefully when disabled.

## Resolved implementation route

- **Route:** delegated direct writer after repository mapping and platform verification.
- **Trigger evidence:** implementation spans notification construction, Android background audio, and focused Android tests across multiple non-trivial files.
- **TDD mode:** existing project configuration does not enable a RED/GREEN TDD mode; use ordinary focused unit/build/lint/check verification.
- **Delivery strategy:** ask-on-risk; keep the change as one work unit under the current feature branch budget.

## Tasks

- [x] AWC-ALERT-SURFACES-01 — Add opt-in Bubble metadata/shortcut while preserving heads-up/action behavior.
- [x] AWC-ALERT-SURFACES-02 — Add bounded audible fallback for eligible background `request.created` events.
- [x] AWC-ALERT-SURFACES-03 — Add focused tests and verify/build/install the APK on the authorized tablet without station mutation.

## Acceptance criteria

- A new room request while the app is backgrounded still produces the existing HIGH heads-up notification with room, service, area, and action.
- Android can show the same request as a Bubble when the user enables bubbles; disabling bubbles does not suppress heads-up delivery.
- The audible fallback is invoked only for background `request.created` notifications and does not run for status updates or foreground console events.
- Replayed/duplicate events do not cause unbounded playback loops; notification failure remains non-fatal to realtime processing.
- Android unit tests, assemble, lint, check, and `git diff --check` pass; the rebuilt APK is installed and smoke-verified on the authorized SM-T220.

## Progress

- [x] Implementation complete.

## Verification evidence

- Added `BubbleMetadata`, a long-lived dynamic sharing shortcut, and a resizeable/embedded `RequestBubbleActivity` with room, service, area, and Accept/Start action. Heads-up remains the normal fallback when bubbles are disabled or unsupported.
- Added bounded `MediaPlayer` fallback playback for background `request.created` events only; it respects ringer mode, notification volume, channel importance/sound, coalesces concurrent playback, and releases the player after completion/timeout.
- Android `:app:testDebugUnitTest`, `:app:assembleDebug`, `:app:lintDebug`, and `:app:check` passed after the bubble shortcut/activity and fallback changes.
- APK SHA-256: `080553faa6bc3ef6d951729b5ffc9ba3791282ea300075b581ab25b05dc0333b`.
- Installed with ADB on authorized SM-T220 (`R9PT70GX3PA`) successfully; `hotel-alert-requests-v3` remains HIGH with the bundled sound URI and global bubbles are enabled. No station was registered, assigned, retired, deleted, or otherwise mutated.

## Next step

Commit the completed work unit and keep a live room-to-area request test pending for the operator to verify the actual Samsung heads-up, bubble, and audible behavior.
