# ODD Task: Android WebView Console Pairing

## Objective

Turn the existing Android diagnostic receiver into one operator-facing APK that:

- asks for the LAN/VPN server origin on first launch;
- hosts the existing hotel web console in a restricted WebView;
- lets an administrator pair the installation to an AREA from the existing web console; and
- keeps notification delivery in the native foreground service when the WebView/activity is closed.

## Problem and Why

The current Android setup requires manually entering a device ID and token. The web application already has bootstrap, administrator login, device provisioning, and AREA screens, but it owns a separate browser token and realtime connection. Running both browser and native clients would duplicate delivery and create token-rotation races.

## Authorized Scope

- Android application UI, WebView bridge, native pairing/runtime ownership, lifecycle handling, and focused Android tests.
- Minimal shared/web/server changes required to support the selected native-owned pairing contract.
- Relevant user-facing setup copy and documentation.
- No changes to the existing request mutation workflow, Windows adapter, unrelated dirty worktree files, remote systems, or deployment infrastructure.

## Constraints and Decisions

- One APK only; no second kiosk or notifier APK.
- The native Android service is the sole owner of AREA device credentials and realtime so background staff notifications remain available; a ROOM display uses the existing browser device session because its interactive commands and authenticated media are web-owned and no native ROOM command façade exists.
- The WebView is a restricted console and must not keep an independent device Socket.IO client.
- Tokens must remain in Android Keystore-backed storage; never place them in URLs or unrestricted JavaScript bridges.
- The native service is independent of `MainActivity`/WebView lifecycle and remains foreground with its required notification.
- LAN/VPN transport remains the supported deployment boundary.
- When a native bridge is present, the admin view retains browser admin realtime and status updates; only the browser device view remains native-realtime-only.
- Strict TDD is active; runner starts with `rtk gradlew test` for Android and `corepack pnpm test:unit` for web/server changes.
- Delivery strategy remains `ask-on-risk`; no chain strategy selected.

## Work Units

### AWC-1 — Define and test the native WebView boundary

- **Route:** single bounded writer; implementation is limited to the Android shell, bridge boundary, and focused Android tests for AWC-1.
- **Acceptance:** first launch collects and persists a validated server origin; the WebView is loaded only from that origin; navigation, JavaScript bridge, and external intents are restricted; closing the activity does not stop the native service.
- **Checks:** focused Android unit tests, Android build/lint/check, and web typecheck/lint where touched.
- **Rollback boundary:** remove only the new Android shell/bridge and associated web boundary code.

### AWC-2 — Pair the installation through the existing administrator flow

- **Route:** delegated direct writer after AWC-1 establishes the boundary.
- **Acceptance:** the existing administrator can identify and assign the installation to an AREA; the native side receives the resulting device identity/token through the restricted bridge/protocol, persists the token in Keystore, and starts/restarts the foreground receiver without browser-owned device credentials.
- **Checks:** RED/GREEN tests for pairing success, invalid/expired pairing, wrong assignment mode, token rotation, and retry after transient failure; server/web integration tests where the contract changes.
- **Rollback boundary:** remove only pairing contract, bridge integration, and focused tests.

### AWC-3 — Deliver the native-owned snapshot/state to the console

- **Route:** delegated direct writer after the pairing contract is proven.
- **Acceptance:** the AREA WebView renders the native receiver's current snapshot/state without opening a second device realtime connection; foreground notifications continue while the activity is absent; explicit Stop remains the only normal UI stop path.
- **Checks:** focused state/bridge tests, Android host checks, web tests, and a documented on-device matrix for Home, Back, Recents dismissal, screen-off, reboot, force-stop, and battery restrictions.
- **Rollback boundary:** remove only native-to-WebView state delivery and its tests.

### AWC-2/AWC-3 hardening — Failure rollback and native diagnostics boundary

- **Route:** direct inline follow-up after verification exposed edge cases in the completed pairing and snapshot flows.
- **Acceptance:** a failed receiver restart restores the previous native pairing and does not publish the new snapshot; a null receiver snapshot clears stale WebView state; service/notification intents reach the native diagnostics screen with an explicit Stop action; native AREA request controls remain visibly read-only when browser device commands are unsupported.
- **Checks:** focused Android pairing, snapshot, and diagnostics tests; focused web App/DeviceScreen tests; full Android host checks; web unit tests, typecheck, lint, and diff checks.
- **Rollback boundary:** remove only the hardening changes and their focused tests.

### AWC-WEBVIEW-MODAL — Restore Android WebView modal viewport

- **Route:** delegated direct writer; the fix spans the shared web modal styles and regression coverage.
- **Acceptance:** shared web modals retain a usable viewport and scroll surface inside the Android WebView while preserving desktop behavior; a regression test proves the constrained viewport layout.
- **Checks:** RED/GREEN focused modal regression, full web unit suite, workspace typecheck, lint, and diff checks; Android host checks only if the touched contract requires them.
- **Rollback boundary:** remove only the shared modal viewport change and its regression test.

### AWC-WEBVIEW-MODAL-STACK — Keep web modals above the admin navbar

- **Route:** delegated direct writer; the fix changes the shared stacking contract and regression coverage.
- **Acceptance:** modal scrims render above the sticky admin navbar; the station-registration form fits the measured `1006 x 529` WebView viewport without internal scrolling; legitimately long modal content retains bounded vertical overflow.
- **Checks:** strict RED/GREEN stacking regression, focused modal/style tests, browser layout check when supported, real-device screenshot and computed-style verification, and diff checks.
- **Rollback boundary:** remove only the stacking-context correction and its focused regression.

### AWC-DEVICE-REPROVISION — Resolve retired installation registration conflicts

- **Route:** delegated direct after the existing bootstrap/retirement identity contract is mapped.
- **Acceptance:** a stale retired browser installation is given a fresh installation identity and can be registered again without reactivating or mutating the retired device row; active installation conflicts and active ROOM uniqueness remain rejected with actionable errors; AREA login handoff must not discard the authenticated flow while the native snapshot is being established.
- **Checks:** strict RED/GREEN service/API tests for retired installation conflicts and active conflicts, focused App recovery/handoff tests for ROOM and AREA, web typecheck/lint, full unit suite, and real-device registration verification.
- **Rollback boundary:** remove only retired-installation bootstrap handling, conflict details/copy, and focused tests.

### AWC-AREA-ASSIGNMENT-NATIVE-POLL — Keep native AREA assignment visible before pairing

- **Route:** delegated direct writer; the fix is limited to the App native snapshot polling guard and its focused regression.
- **Acceptance:** while the operator is selecting an AREA or ROOM target after admin login, an unpaired native bridge must not replace the assignment picker with the bootstrap login; after successful AREA pairing, the native snapshot handoff still transitions to the AREA view.
- **Checks:** strict RED/GREEN App regression, focused web unit suite, workspace typecheck/lint, and LAN WebView smoke verification without registering a device by the agent.
- **Rollback boundary:** remove only the assignment-view polling guard and its regression test.

### AWC-AREA-ASSIGNMENT-STARTUP-RETRY — Cancel stale startup recovery after role login

- **Route:** delegated direct writer; the fix is limited to the login handoff's startup-retry cancellation and focused App regression.
- **Acceptance:** after an administrator selects AREA or ROOM at login, a retry timer scheduled before authentication must not restore the persisted Admin session or replace the target picker with the Admin view; ADMIN login continues to open administration normally.
- **Checks:** strict RED/GREEN App regression, focused/full web unit suite, workspace typecheck/lint, and LAN WebView smoke verification without registering a device by the agent.
- **Rollback boundary:** remove only the stale startup-retry cancellation and its regression test.

### AWC-AREA-ASSIGNMENT-TARGET-RECOVERY — Hydrate target lists when the full snapshot is incomplete

- **Route:** delegated direct; the fix spans the post-login snapshot handoff, target-list hydration, and focused assignment regression coverage.
- **Acceptance:** AREA login must show active areas on the APK WebView even if the initial admin snapshot omits the target collection; ROOM must retain its existing filtering. A failed fallback must leave an actionable empty/error state instead of an unexplained wait. ADMIN login remains unchanged.
- **Checks:** strict RED/GREEN regression for incomplete snapshot hydration, focused/full web unit suite, workspace typecheck/lint, production build, and LAN WebView endpoint verification without registering a device.
- **Rollback boundary:** remove only the assignment target hydration fallback and its regression coverage.

### AWC-ROOM-SESSION-OWNERSHIP — Route room screens to the browser device session

- **Route:** delegated direct writer because mode-aware ownership changes the Admin handoff, App startup/realtime selection, and focused web tests.
- **Acceptance:** an active ROOM device provisioned for this installation stores and restores the existing browser device session, renders the interactive room screen, and owns exactly one browser realtime connection; AREA provisioning continues through the native bridge and background receiver unchanged.
- **Checks:** strict RED/GREEN App/Admin regressions for ROOM and AREA handoff, focused web suites, full web unit/typecheck/lint where available, and real-device ROOM pairing verification on the authorized SM-T220.
- **Rollback boundary:** remove only assignment-mode propagation and mode-aware device-session ownership behavior.

### AWC-MODAL-SELECT-LAYER — Keep modal form selectors above the modal card

- **Route:** delegated direct writer because the fix spans the shared Admin selector wrapper and focused modal/UI regression coverage.
- **Acceptance:** selectors rendered inside any Admin modal open their option list above the modal card, keep a usable bounded menu height in Android WebView, and remain pointer-selectable; selectors outside modals retain their current stacking behavior.
- **Checks:** strict RED/GREEN selector regression, focused TouchSelect/Admin tests, web typecheck/lint, and real-tablet modal interaction verification.
- **Rollback boundary:** remove only the modal selector-layer prop/style change and its focused tests.

### AWC-LOGIN-ROLE-ONBOARDING — Assign the station from the login flow

- **Route:** delegated direct writer; the change spans the shared login form, App view state, automatic bootstrap handoff, responsive onboarding UI, translations, and focused tests.
- **Acceptance:** the login form lets the operator choose `HABITACION`, `AREA`, or `ADMIN`; `ADMIN` opens the existing administration view; `HABITACION` shows only active rooms without an active ROOM device and provisions the selected room immediately; `AREA` shows active areas and provisions the selected area immediately; successful provisioning transitions to the existing ROOM or AREA view; the existing Admin “Registrar estación” form remains available as a fallback; failed/conflicting provisioning leaves the operator in the target picker with an actionable error.
- **Checks:** RED/GREEN login-role, target filtering, bootstrap payload, and handoff tests; full web unit suite, typecheck, focused lint, and diff checks; real-tablet/browser smoke verification without registering a device unless the operator explicitly performs it.
- **Rollback boundary:** remove only the login role picker, target onboarding view, and automatic bootstrap handoff; preserve the existing Admin registration fallback and existing native AREA / browser ROOM ownership rules.

### AWC-LOGIN-VIEWPORT-COMPACT — Fit the login form to kiosk and tablet viewports

- **Route:** delegated direct writer; the change is limited to the bootstrap login composition, responsive login styles, and focused UI regression coverage.
- **Acceptance:** the bootstrap screen shows only the login surface (no marketing/setup copy or decorative text); the form remains accessible and touch-friendly; the role picker and credentials fit the 480x480 kiosk and tablet viewports without avoidable page scrolling; login errors and retry remain actionable.
- **Checks:** strict RED/GREEN bootstrap markup and responsive-style tests, focused web typecheck/lint, full unit suite, production build, and diff checks. No APK rebuild or device registration is authorized for this web-only presentation change.
- **Rollback boundary:** remove only the compact bootstrap composition and responsive login styles/tests; preserve role-driven provisioning and Admin fallback behavior.

### AWC-LOGIN-ROLE-CARDS-ERROR — Refine role cards and diagnose startup availability

- **Route:** delegated direct after read-only mapping; the work spans the role-card component markup/styles/tests and the bootstrap availability/error path only.
- **Acceptance:** the `Usar este dispositivo como` choices remain large, clear, and touch-selectable at 480x480 and tablet sizes without redundant descriptions; startup availability errors are explained from observed network/server behavior and do not mask a reachable service; no registration or APK change is included.
- **Checks:** strict RED/GREEN role-card markup/style regression, focused App/bootstrap/API tests, web typecheck/lint/build, full unit suite, and LAN endpoint verification. Physical devices remain operator-controlled.
- **Rollback boundary:** remove only role-card presentation/error diagnostics changes; preserve role-driven provisioning, Admin fallback, and existing ROOM/AREA ownership.

### AWC-AREA-ASSIGNMENT-TARGET-VALIDATION — Refetch unusable AREA snapshot targets

- **Route:** delegated direct writer after read-only mapping; scope is the web login hydration helper and its App regression coverage.
- **Acceptance:** an authenticated AREA login refetches `/areas` when the snapshot collection is present but contains no usable active target; valid target DTOs continue directly to the picker; no Android, database, registration, or remote-device mutation is included.
- **Checks:** strict RED/GREEN App regression, full unit suite, workspace typecheck/lint, and diff checks. APK and physical-tablet validation remain pending.
- **Rollback boundary:** remove only the AREA target-shape guard and its regression; preserve cache-control, endpoint fallback, and role-driven provisioning.

### AWC-AREA-ASSIGNMENT-PERSISTENCE — Restore pending station onboarding after WebView reload

- **Route:** delegated direct writer after read-only root-cause mapping; scope is the persisted admin-session contract, App restore/login handoff, and focused model/App regressions.
- **Acceptance:** a WebView reload during AREA/ROOM target selection must restore the pending assignment picker instead of opening Admin; explicit ADMIN login and the assignment screen's Admin fallback must still open Admin; successful ROOM/AREA provisioning must clear the pending onboarding marker before device handoff.
- **Checks:** strict RED/GREEN persistence and reload regressions, full unit suite, workspace typecheck/lint, and diff checks. APK/device validation remains operator-controlled.
- **Rollback boundary:** remove only the pending-assignment session metadata and restore branching; preserve target hydration, native polling guards, and provisioning contracts.

### AWC-WEBVIEW-BUNDLE-RELOAD — Prevent stale WebView document/bundle after origin reload

- **Route:** delegated direct writer; the fix is limited to the Android WebView loading/cache policy and focused host tests.
- **Acceptance:** when the configured LAN origin is reloaded or the WebView is recreated, Android must request the current web entrypoint instead of reusing a stale document/module bundle; navigation policy and the existing restricted bridge remain unchanged.
- **Checks:** strict RED/GREEN Android WebView host regression, focused Android tests, debug assembly/lint/check, and diff checks. No device registration, live DB mutation, remote inspection, or APK/device validation is performed by the agent.
- **Rollback boundary:** remove only the WebView cache/reload policy and its focused regression coverage.

### AWC-WEBVIEW-VIEWPORT-FALLBACK — Restore viewport sizing in Android WebView

- **Route:** delegated direct writer; the fix spans the web entrypoint viewport measurement, assignment-screen layout fallback, and focused style/runtime regression coverage.
- **Acceptance:** Android WebView must resolve a usable app viewport even when `vh`/`dvh` evaluate to zero; AREA/ROOM target lists must render visible, scrollable buttons instead of collapsing to zero height; desktop/browser viewport behavior remains unchanged.
- **Checks:** strict RED/GREEN web regression for zero viewport units, focused/full web unit suite, typecheck, lint, production build, LAN WebView verification, and ADB/CDP runtime measurement. No station registration is performed by the agent.
- **Rollback boundary:** remove only the viewport custom-property fallback and assignment-screen sizing rules/tests.

### AWC-AREA-PICKER-COMPACT — Reclaim space in the station target picker

- **Route:** delegated direct writer; the change spans the assignment screen composition, responsive spacing, icon-only Admin action, and focused UI regression coverage.
- **Acceptance:** the AREA/ROOM picker uses the available viewport efficiently, keeps the target list as the primary surface, and moves the Admin fallback to an accessible icon-only control aligned in the card header without changing provisioning behavior.
- **Checks:** strict RED/GREEN assignment markup/style regression, focused web unit tests, typecheck, focused lint, production build, and ADB/CDP screenshot verification without selecting or registering a station.
- **Rollback boundary:** remove only the compact assignment layout, header Admin action, and its focused regression coverage.

### AWC-AREA-PICKER-GRID — Present station targets as a responsive grid

- **Route:** delegated direct writer; the follow-up is limited to the assignment target layout, responsive grid rules, and focused style regression coverage.
- **Acceptance:** AREA/ROOM target buttons render as a readable multi-column grid on tablet/desktop, remain single-column and touch-friendly on 480x480 screens, preserve keyboard focus and target selection behavior, and keep the icon-only Admin action unchanged.
- **Checks:** strict RED/GREEN grid-style regression, focused/full web tests, typecheck, focused lint, production build, and ADB/CDP screenshot verification without selecting or registering a station.
- **Rollback boundary:** remove only the responsive target-grid rules and their focused regression coverage.

## Progress

- [x] Architecture decision — one APK; native service owns AREA token/realtime for background notifications, while ROOM uses the shared browser device session; WebView remains the operator console and kiosk surface.
- [x] AWC-1 — boundary implementation and host verification complete; on-device lifecycle verification remains pending.
- [x] AWC-2 — native pairing, Keystore persistence, foreground-service restart, and WebView handoff implemented; on-device validation remains pending.
- [x] AWC-3 — native snapshot/state bridge and WebView polling implemented without a browser-owned device realtime client; on-device validation remains pending.
- [x] AWC-2/AWC-3 hardening — pairing rollback, snapshot clearing, native diagnostics reachability, and read-only AREA command gating implemented; on-device validation remains pending.
- [x] Final native snapshot refresh hardening — App-level regression coverage now verifies that an absent/invalid native snapshot clears the stale device view into the existing bootstrap/error state without browser credential or realtime fallback; on-device validation remains pending.
- [x] Native ownership retry/recovery hardening — bridge-present startup and bootstrap retry now remain native-owned, while non-admin polling restores a later native snapshot without browser device-session or realtime fallback; on-device validation remains pending.
- [x] Admin realtime boundary fix — a native bridge no longer suppresses browser admin realtime or its status callback, while native device realtime remains disabled; on-device validation remains pending.
- [x] Android WebView server-origin recovery — main-frame origin/load failures now expose native retry and change-origin actions without clearing the configured receiver origin; on-device callback and lifecycle validation remain pending.
- [x] Android WebView recovery correction — keyed AndroidView creation/release now guarantees a fresh restricted WebView for origin/retry changes, while recovery state preserves the failed origin for editing and clears it on retry or successful save; on-device callback and lifecycle validation remain pending.
- [x] AWC-WEBVIEW-MODAL — real-tablet CDP inspection identified the shared card's viewport-relative height constraints as the collapse trigger; the persistent `height: auto; max-height: 100%` rule now renders the complete form on the target SM-T220 while retaining its own vertical overflow surface.
- [x] AWC-WEBVIEW-MODAL-STACK — removed the parent stacking context that trapped modal overlays below the admin navbar, raised the shared scrim above navigation, and verified the registration form fits the target tablet viewport without scrolling.
- [x] AWC-DEVICE-REPROVISION — retired installation conflicts now return a reasoned `RESOURCE_CONFLICT`; the web client rotates only the stale installation identity and retries once, while AREA native handoff waits for its first snapshot.
- [x] AWC-AREA-ASSIGNMENT-NATIVE-POLL — native snapshot polling no longer replaces the post-login target picker while the bridge is unpaired; queued callbacks are guarded, and AREA handoff behavior remains covered.
- [x] AWC-AREA-ASSIGNMENT-STARTUP-RETRY — role login now cancels stale startup retries before persisting the session, so AREA/ROOM remain in target selection instead of switching to Admin.
- [x] AWC-AREA-ASSIGNMENT-TARGET-RECOVERY — post-login snapshot requests bypass WebView caches, incomplete target collections hydrate from authenticated `/areas` or `/rooms`, and fallback failures keep the assignment picker actionable.
- [x] AWC-ROOM-SESSION-OWNERSHIP — ROOM provisioning now follows the shared browser device-session flow even when the Android bridge is present; AREA keeps native pairing and background ownership.
- [x] AWC-MODAL-SELECT-LAYER — modal SelectInput forwards `modal={true}` to TouchSelect, the active selector is raised above later modal siblings, and modal menus use a fixed WebView-safe `240px` bound instead of the collapsing `min(..., 40vh)` expression; host and authenticated real-tablet interaction verification are complete without submitting registration.
- [x] AWC-LOGIN-ROLE-ONBOARDING — login now accepts ADMIN/ROOM/AREA, filters the target list, provisions through `/devices/bootstrap`, and hands off to the existing browser ROOM or native AREA ownership path; the Admin registration form remains the fallback.
- [x] AWC-LOGIN-VIEWPORT-COMPACT — bootstrap now renders only the login surface, removes setup/marketing copy and decorative elements, and uses compact square-kiosk/tablet responsive rules for the role-and-credential form.
- [x] AWC-LOGIN-ROLE-CARDS-ERROR — role cards are compact, touch-selectable, and responsive for 480x480 kiosks and tablets; the native-unpaired startup banner no longer presents a misleading local-service error.
- [x] AWC-LOGIN-ROLE-BUTTONS — replaced role radios/icons with three text-only buttons (`Admin`, `Habitación`, `Área`) while preserving keyboard/touch selection and the existing role callback.
- [x] AWC-AREA-ASSIGNMENT-TARGET-VALIDATION — AREA hydration now validates active target DTO shape and refetches `/areas` when the snapshot contains only unusable entries; APK and physical-tablet validation remain pending.
- [x] AWC-AREA-ASSIGNMENT-PERSISTENCE — persisted admin sessions now carry the pending AREA/ROOM role, reload restores the assignment picker, explicit Admin fallback clears the marker, and successful provisioning clears the session before handoff; APK and physical-tablet validation remain pending.
- [x] AWC-WEBVIEW-BUNDLE-RELOAD — Android WebView now bypasses the document/module cache, clears stale cache/history, and appends a unique entrypoint query on every load; host verification passed and physical-tablet validation remains operator-controlled.
- [x] AWC-WEBVIEW-VIEWPORT-FALLBACK — the web entrypoint now measures `window.innerHeight` into `--app-viewport-height`; app frames, compact login, room frame, and station target lists use that measured value instead of collapsing when Android WebView reports `vh`/`dvh` as `0px`.
- [x] AWC-AREA-PICKER-COMPACT — compacted the assignment card, promoted the target list to the primary flexible surface, and moved the Admin fallback to an accessible icon-only header action; host checks passed and real-tablet capture remains with the parent orchestrator.
- [x] AWC-AREA-PICKER-GRID — AREA/ROOM targets now use two columns on tablets, three on wide desktop viewports, and one touch-friendly column on 480x480 screens; host verification passed and real-tablet capture remains with the parent orchestrator.

## Route Evidence

- Mapping required more than four files and two ecosystems; delegated read-only mapping before implementation.
- Writer delegation is required because the change spans Android, web, server/shared contracts, and tests.
- AWC-1 stayed with one bounded writer and did not touch web/server/shared contracts. The user subsequently authorized completing AWC-2/AWC-3 before performing the physical device checks.
- The final stale native-view follow-up used the direct inline route and touched only the existing App/test hardening seam plus this task document.
- The confirmed native ownership retry/recovery follow-up also used the direct inline route and touched only `apps/web/src/App.tsx`, `tests/unit/app.test.ts`, and this task document.
- The confirmed admin realtime boundary follow-up used the direct inline route and touched only `apps/web/src/App.tsx`, `tests/unit/app.test.ts`, and this task document.
- AWC-WEBVIEW-MODAL used the delegated direct route because it spans shared modal CSS and regression coverage; parent verification independently reran the focused modal suite, full web unit suite, workspace typecheck, focused ESLint, project-only ESLint, and diff checks.
- The real-tablet modal fallback correction remained delegated direct and strictly scoped to the shared CSS rule, its regression test, and this evidence document.
- The confirmed percentage-bound modal correction remained delegated direct and strictly scoped to `apps/web/src/styles.css`, `tests/unit/ui-styles.test.ts`, and this evidence document; no APK or Android source change is involved.
- AWC-WEBVIEW-MODAL-STACK used delegated mapping and a bounded delegated writer; after the writer reached its runtime limit, the parent completed the already-established two-file change and independently verified it on the authorized tablet.
- AWC-ROOM-SESSION-OWNERSHIP uses delegated mapping and a bounded web writer. Mapping proved a full native ROOM façade would require native command proxying, offline queue transport, authenticated image streaming, realtime, heartbeat, and rotation; the smaller mode-aware browser path reuses the existing complete ROOM session without duplicating ownership.
- The ROOM ownership implementation observed RED before source changes for the new handoff/restore tests, then GREEN after propagating `assignmentMode` with the token and routing ROOM around the native bridge.
- AWC-MODAL-SELECT-LAYER mapping confirmed that `TouchSelect` already has modal-specific backdrop/menu z-index rules, but `AdminScreen`'s `SelectInput` wrapper never passes `modal={true}` to the selectors rendered inside `Modal`.
- AWC-MODAL-SELECT-LAYER RED reproduced the selector menu as a one-pixel strip on the authorized tablet after the missing prop was fixed; the remaining cause was `.modal-card { overflow-y: auto; }` clipping the absolutely positioned menu. The shared card now uses `overflow: visible`, while `.modal-scrim` remains the scroll surface for long content.
- The user clarified that the authorized tablet and ROOM kiosk are different physical devices. The tablet must not be provisioned as ROOM; its intended AREA/kiosk registration must use the shared bootstrap flow separately from ROOM registration.
- The user confirmed that the current Admin “Registrar estación” form remains only as an administrative fallback; normal station assignment should happen immediately after admin login through a role and target selection.
- The latest tablet screenshot was captured after reloading the APK configured with `192.168.0.201:4173`; LAN verification shows that origin serves the current picker with the empty-state marker, while the tablet still shows neither target buttons nor the empty-state, indicating a stale WebView document/module cache rather than a target-data discrepancy.
- AWC-WEBVIEW-VIEWPORT-FALLBACK mapping used ADB/CDP on the authorized SM-T220 and proved the DOM already contained six AREA buttons; only the CSS `vh`/`dvh` sizing path collapsed their list to `0px`. The web fix measures the real viewport before React renders and updates it on `resize`, preserving browser behavior while providing a pixel fallback for the affected WebView.
- AWC-AREA-PICKER-COMPACT used the delegated direct route because the change spans assignment-screen composition, responsive CSS, regression coverage, and task evidence. The compact header keeps the context icon, eyebrow, title, and explanatory copy in one row; the target list receives the remaining measured viewport height, while the Admin fallback is a 48px icon button with both `aria-label` and `title`.
- AWC-LOGIN-ROLE-ONBOARDING mapping was delegated before implementation because the flow crosses App startup, authentication, shared bootstrap DTOs, Admin snapshot data, and device handoff. A bounded writer was attempted for the multi-file change; the parent reconciled the shared worktree and completed the final role-at-login implementation without registering any physical device.
- The target picker intentionally uses full-width touch buttons rather than modal selectors: ROOM filters active rooms that lack an active ROOM device, while AREA lists active areas. Selecting a target sends the existing admin-authenticated `/devices/bootstrap` request and then reuses mode-aware handoff (`/device/session` for ROOM, native bridge for AREA).
- The user authorized removing all visible setup/marketing copy from the bootstrap login and optimizing the remaining form for both 480x480 kiosks and the tablet; the role selection and credential labels remain because they are part of the accessible form.
- AWC-LOGIN-VIEWPORT-COMPACT used the delegated direct route; the writer owned BootstrapScreen, shared styles, and focused bootstrap/style tests while preserving App role/provisioning behavior.
- The user supplied two screenshots showing the role cards on a tablet and a square kiosk, plus the generic `El servicio local no está disponible` banner. The current LAN checks must distinguish a transient/unreachable Vite-proxy request from a server-side API error before changing the registration contract.
- AWC-LOGIN-ROLE-CARDS-ERROR used the delegated direct route after the screenshot mapping. The writer removed redundant role descriptions from `AdminLoginForm`, scoped the role-card layout to the bootstrap login card, and preserved the accessible fieldset/radio semantics without changing station registration or APK code.
- Follow-up mapping found the screenshot banner is produced by `NATIVE_SNAPSHOT_UNAVAILABLE` when the Android bridge is present before the tablet has been assigned, not by the healthy `/devices/bootstrap-state` API; a bounded writer is correcting that misleading bootstrap error while keeping native retry behavior.
- The bounded follow-up writer changed both native snapshot-empty paths (`initialize` and `refreshNativeSnapshot`) to keep the bootstrap login actionable with `error: null` while retaining bounded retry; real API failures without a native bridge still use the generic service-unavailable message.
- The user requested a simpler role control after reviewing the cards: text-only buttons are preferred over radio inputs and icons, with the role values and provisioning flow unchanged.
- The current ROOM screenshot confirms the bootstrap conflict is caused by a retired `installation_id` left by an earlier partial registration; the safe recovery route must create a new installation identity client-side rather than reactivate the retired device row. AREA needs a separate regression because native pairing can fail after bootstrap and currently returns to the bootstrap surface while no assignment state is persisted.
- The reprovision fix preserves terminal retirement: the server does not reactivate or reuse retired rows. It returns `details.reason = RETIRED_INSTALLATION`; the browser clears only its installation-id key, creates a fresh identity, updates the assignment state/session, and retries the same target once. Active installation conflicts remain single-attempt errors.
- The user-reported APK-only regression is explained by the native snapshot polling effect in `apps/web/src/App.tsx`: while `view.kind === 'assignment'` and the bridge has no paired snapshot, the one-second poll unconditionally replaces the assignment picker with the bootstrap login. The browser path does not have this bridge, so it works normally.
- AWC-WEBVIEW-BUNDLE-RELOAD fixes the stale WebView root cause natively: `LOAD_NO_CACHE`, `clearCache(true)`, `clearHistory()`, no-cache request headers, and a unique query on the entrypoint URL. The web session remains available because DOM storage stays enabled.
- ADB/CDP inspection of the live tablet proved the current React DOM already contains all six active AREA buttons, but their computed container height is `0px` because Android WebView resolves `1vh`, `1dvh`, and `min(55vh, 420px)` to `0px`; the admin button overlays the first target and the remaining targets are clipped by the collapsed layout. This is a CSS viewport-unit compatibility issue, not missing area data.
- The assignment-poll regression RED reproduced `bootstrap-screen` replacing the AREA picker; GREEN keeps `device-role-assignment-screen` visible when the unpaired native interval fires. This is a web bundle fix served by the existing Vite dev origin; no APK source or native service change is required.
- The new symptom is a second startup race: `completeAdminLogin` persists the admin session while the pre-login native startup retry timer remains scheduled. When it fires, `restoreAdminSession` legitimately restores `kind: 'admin'`, overriding the selected AREA/ROOM assignment. The role-login handoff must cancel that timer before persisting/transitioning.
- The startup-retry regression RED reproduced `admin-screen` after advancing the pending 250 ms retry; GREEN keeps `device-role-assignment-screen` visible for AREA. The fix is web-only and does not require an APK rebuild.
- The APK screenshot's remaining empty target state was traced to an incomplete/cached authenticated snapshot path: the live database has six active areas and direct service snapshot output includes them, while the WebView client had no GET cache policy. Assignment snapshot/target requests now use `cache: no-store`, `/system/snapshot` sends `Cache-Control: no-store`, and AREA/ROOM fall back to their authenticated collection endpoint when the snapshot omits targets.
- The target-recovery regression RED reproduced an empty AREA target collection when `/system/snapshot` omitted `areas`; GREEN hydrates `/areas` with `cache: no-store`. A second regression keeps the assignment picker visible with an actionable service error when fallback hydration fails.

## Verification Evidence

- AWC-DEVICE-REPROVISION RED/GREEN coverage: `tests/unit/hotel-service.test.ts` distinguishes retired versus active installation conflicts; `tests/unit/app.test.ts` covers ROOM and AREA identity rotation, active-conflict non-retry, and delayed native AREA snapshot handoff. Focused App/service checks passed (57 tests).
- AWC-AREA-ASSIGNMENT-NATIVE-POLL RED/GREEN verification passed: `tests/unit/app.test.ts` — 26 tests; the full web unit suite passed with 421 tests across 39 files, plus typecheck, lint, and `git diff --check`. No APK build or physical-tablet registration was performed.
- AWC-AREA-ASSIGNMENT-STARTUP-RETRY RED/GREEN verification passed: `tests/unit/app.test.ts` — 27 tests; the full web unit suite passed with 422 tests across 39 files, plus typecheck, lint, and `git diff --check`. No APK build or physical-tablet registration was performed.
- AWC-AREA-ASSIGNMENT-TARGET-RECOVERY RED/GREEN verification passed: App 29 tests; `tests/unit/api.test.ts` 11 tests; `tests/integration/http-api.test.ts` 18 tests; full unit suite 425 tests across 39 files; workspace typecheck, lint, production web build, and `git diff --check` passed. The build retains the existing non-blocking Vite chunk-size warning. No APK build, physical-tablet registration, or live device mutation was performed.
- AWC-AREA-ASSIGNMENT-TARGET-VALIDATION RED reproduced the skipped `/areas` fallback when the snapshot contained only inactive AREA entries and the unhandled missing-`areas` shape when fallback failed; GREEN now validates `active`, `id`, `code`, and `displayName`, refetches authenticated `/areas`, and normalizes missing `areas`/`rooms` to empty arrays before rendering. App 30 tests, full unit suite 425 tests across 39 files, workspace typecheck/lint, and `git diff --check` passed. APK and physical-tablet validation remain pending.
- AWC-AREA-ASSIGNMENT-PERSISTENCE RED reproduced WebView reload restoring `admin-screen` because the persisted session contained no role; GREEN persists `pendingStationRole`, restores AREA/ROOM assignment after reload, clears it for explicit Admin fallback and successful provisioning, and keeps restore callbacks stable. App + app-model tests 46/46, full unit suite 427 tests across 39 files, workspace typecheck/lint, and `git diff --check` passed. APK and physical-tablet validation remain pending.
- AWC-WEBVIEW-BUNDLE-RELOAD RED initially failed because the cache-busting helper preserved surrounding whitespace in the configured origin; GREEN trims and canonicalizes the origin before appending the unique query. Focused Android test `WebViewBoundaryTest` passed; full Android `:app:test :app:assembleDebug :app:lint :app:check` passed. Debug APK generated at `apps/android-notification-receiver/app/build/outputs/apk/debug/app-debug.apk` (SHA-256 `9213f80cec3bc649a5d92a65ce00e80f92f6b235e948cc5b5fea8a572c91331a`). Physical-tablet validation remains pending.
- AWC-WEBVIEW-VIEWPORT-FALLBACK RED failed on the missing viewport measurement/custom-property contract; GREEN passed `tests/unit/ui-styles.test.ts` (60 tests), the full web unit suite (428 tests), web typecheck, focused ESLint, production web build, and `git diff --check`. LAN markers are present on `192.168.0.201:4173` and the static server. Live ADB/CDP verification on SM-T220 reports `innerHeight=529`, `--app-viewport-height=529px`, six AREA buttons, and a visible `.station-assignment-list` of `290.94px`; no station was registered.
- AWC-AREA-PICKER-COMPACT RED failed because the assignment screen had no compact header, icon-only Admin action, or flexible target-list contract. GREEN passed `tests/unit/ui-styles.test.ts` and `tests/unit/device-role-assignment.test.ts` (66 tests), web typecheck, focused ESLint, production web build, and scoped `git diff --check`. Baseline CDP measurements were viewport `1006x529`, card height `637.9px`, list height `290.94px`, and the Admin action at `y=583` outside the viewport; the new card is bounded to the measured viewport and dedicates remaining space to the list. Real-tablet screenshot verification remains with the parent orchestrator; no target was selected and no station was registered.
- AWC-AREA-PICKER-GRID RED failed because the target container had no column definition; GREEN passed the focused grid regression and the complete `tests/unit/ui-styles.test.ts` suite (62 tests), web typecheck, focused ESLint, production web build, and scoped `git diff --check`. The layout uses two columns by default, three at `min-width: 1101px`, and one within the 480x480 kiosk breakpoint while retaining the existing 64px target minimum. Real-tablet screenshot verification remains with the parent orchestrator; no target was selected and no station was registered.
- Parent verification after the grid change passed the full web unit suite: 431 tests across 39 files. CDP on the SM-T220 measured two `285px` columns at `1006x529`; the six targets render in three rows and the screenshot is stored at `artifacts/tablet-area-picker-grid.png`.
- AWC-AREA-PICKER-GRID is authorized by the operator as a follow-up presentation change; provisioning behavior and station registration remain out of scope.
- AWC-AREA-PICKER-COMPACT is authorized by the operator after the first successful tablet rendering; implementation must preserve target selection and avoid station registration during verification.
- ADB delivery verification: the generated debug APK was installed on the authorized SM-T220 with `adb install -r -d`, the app was force-stopped/launched, and a fresh screenshot showed the current Spanish login with `Admin`, `Habitación`, and `Área`. Credentials were not entered and no station was registered; AREA picker validation remains pending operator action.
- The implemented recovery preserves terminal retirement and audit history: it never reactivates a retired row, rotates only the browser installation identity, retries once, and leaves active conflicts actionable in the assignment picker.
- Final web verification for this fix: full unit suite passed (420 tests across 39 files), workspace typecheck passed, workspace build passed, lint passed, and `git diff --check` passed. The existing Vite chunk-size warning remains non-blocking. No APK build, live DB mutation, or physical-device registration was performed.

- Current receiver host verification remains valid: Android unit suite, debug assembly, lint, check, and diff checks passed before this feature.
- Current on-device verification is unavailable and must not be claimed until a tablet/emulator run is observed.
- Current local device check reports no connected `adb` devices and no `emulator` executable is available.
- The initial AWC-1 RED command was attempted with `rtk gradlew test --tests com.hotelalert.notificationreceiver.WebViewBoundaryTest`; it was blocked before compilation because the shell had no `JAVA_HOME` or `java` executable, and the lifecycle `:app:test` task does not accept `--tests`.
- After sourcing `/home/jorlys/.local/share/hotel-alert-env/android-toolchain.sh`, the focused test passed with `rtk gradlew :app:testDebugUnitTest --tests com.hotelalert.notificationreceiver.WebViewBoundaryTest`.
- Full Android verification passed with `rtk gradlew :app:test :app:assembleDebug :app:lint :app:check`.
- Kotlin emitted deprecation warnings for the explicit file-URL access restrictions in `HotelWebView.kt`; lint and all requested Gradle checks passed.
- Independent verification found no production caller of `HotelNotificationReceiverService.start()`; AWC-2 now wires pairing to the restart action, which starts the foreground receiver after persistence.
- Pairing uses the validated WebView server origin and atomic token/configuration replacement; the existing configuration store's legacy validation remains outside the new bridge input path.
- Android tests are JVM-only; no `androidTest` currently proves a real WebView callback or Activity/service lifecycle.
- Focused native pairing tests pass after sourcing `/home/jorlys/.local/share/hotel-alert-env/android-toolchain.sh`.
- Native bridge tests pass, including asynchronous pairing, failure propagation, snapshot validation, and receiver-state mapping.
- App integration tests cover native snapshot hydration, browser realtime suppression, and native pairing handoff without browser credential persistence.
- Web unit suite passes: `390` tests across `38` files.
- Workspace typecheck and lint pass; ESLint now ignores generated `**/build/**` artifacts.
- Android host checks pass after the bridge integration: test, debug assembly, lint, and check.
- The web layer detects the versioned bridge, sends pairing only to native, clears browser device credentials, polls native snapshots, and disables the browser Socket.IO device connection when native is present.
- Focused RED tests reproduced stale pairing/snapshot state after restart failure and an unreachable diagnostics route before the hardening changes.
- Focused Android tests pass after hardening: `NativePairingCoordinatorTest`, `NativeWebViewBridgeTest`, and `MainActivityTest`.
- Full Android host checks pass after hardening: `rtk gradlew :app:test :app:assembleDebug :app:lint :app:check`.
- Web unit tests pass: `391` tests across `38` files; workspace typecheck, lint, and `rtk git diff --check` pass.
- No commit was created; the pre-existing dirty worktree remains untouched outside the authorized hardening files.
- The follow-up RED test was observed with `corepack pnpm exec vitest run tests/unit/app.test.ts -t "clears the stale native device view when refresh finds no snapshot"`; it failed because the stale device render remained (`expected bootstrap-screen`, received `undefined`).
- The focused GREEN regression passed with the same command after the minimal App transition change.
- Focused App/native bridge checks pass: `corepack pnpm exec vitest run tests/unit/app.test.ts tests/unit/native-bridge.test.ts` — `2` files, `17` tests passed.
- Full web unit checks pass after the follow-up: `corepack pnpm test:unit` — `38` files, `392` tests passed.
- `corepack pnpm typecheck` passed across all configured workspace projects.
- `corepack pnpm lint` passed with ESLint and `rtk git diff --check` passed.
- No physical-device validation is available; the native snapshot-clearing behavior remains host-test verified only.
- Final host verification for the confirmed App null-snapshot fix: `corepack pnpm exec vitest run tests/unit/app.test.ts tests/unit/native-bridge.test.ts` passed with 2 files and 17 tests; `corepack pnpm test:unit` passed with 38 files and 392 tests; `corepack pnpm typecheck`, `corepack pnpm lint`, and `rtk git diff --check` all passed.
- No physical device or emulator was inspected or used for this follow-up; native snapshot clearing remains host-test verified only.
- The native ownership RED command was observed with `corepack pnpm exec vitest run tests/unit/app.test.ts -t "does not fall back to browser device credentials when native snapshot is unavailable|recovers the native device view when a snapshot becomes available after an empty read|re-enters native initialization from bootstrap retry when the bridge is present"`; it failed with 3 tests and 12 skipped because the pre-fix implementation rendered the browser-hydrated device state instead of the native bootstrap state.
- The native ownership GREEN command passed with the same focused selector: 1 file, 3 tests passed, and 12 skipped.
- Focused App/native bridge verification passed: `corepack pnpm exec vitest run tests/unit/app.test.ts tests/unit/native-bridge.test.ts` — 2 files, 20 tests passed.
- Final web unit verification passed: `corepack pnpm test:unit` — 38 files, 395 tests passed.
- Final workspace checks passed: `corepack pnpm typecheck`, `corepack pnpm lint`, and `rtk git diff --check`.
- No physical device or emulator was inspected or used for the native ownership follow-up; the retry and recovery behavior remains host-test verified only.
- The admin realtime boundary RED command was observed with `corepack pnpm exec vitest run tests/unit/app.test.ts -t "keeps admin realtime browser-owned while native device realtime stays disabled"`; it failed with 1 test and 15 skipped because the native bridge produced `{ enabled: false, hasSnapshot: false }` for the restored admin view instead of `{ enabled: true, hasSnapshot: true }`.
- The focused GREEN command passed with the same selector: 1 test passed and 15 skipped; the test also honored `onStatus('online')` for the admin view and confirmed the paired native device view still used `{ enabled: false, hasSnapshot: true }`.
- Focused App/realtime boundary verification passed: `corepack pnpm exec vitest run tests/unit/app.test.ts tests/unit/realtime-connection.test.ts` — 2 files, 25 tests passed.
- The first post-implementation typecheck exposed a TypeScript control-flow narrowing error in the realtime fallback expression (`TS2367`); the fallback was made explicitly disabled for loading/bootstrap and the final typecheck passed.
- Final web unit verification passed: `corepack pnpm test:unit` — 38 files, 396 tests passed.
- Final workspace checks passed: `corepack pnpm typecheck`, `corepack pnpm lint`, and `rtk git diff --check`.
- No physical device or emulator was inspected or used for the admin realtime boundary follow-up; browser/admin and native/device behavior remain host-test verified only.
- Fresh independent verification after the admin realtime fix found no critical, high, or medium findings; it validated native device realtime suppression, browser-owned admin realtime/status, native bootstrap ownership, snapshot recovery, and read-only AREA controls.
- The independent App/realtime/device regression set passed: 70 tests; the parent spot check `corepack pnpm test:unit` passed with 38 files and 396 tests.
- The focused Android RED command was `source /home/jorlys/.local/share/hotel-alert-env/android-toolchain.sh && rtk gradlew :app:testDebugUnitTest --tests com.hotelalert.notificationreceiver.WebViewRecoveryTest` (run from `apps/android-notification-receiver`); it failed at test compilation with unresolved recovery-state symbols because the recovery behavior was not implemented yet.
- The focused Android GREEN command with the same selector passed: `BUILD SUCCESSFUL`.
- The full focused Android unit command `source /home/jorlys/.local/share/hotel-alert-env/android-toolchain.sh && rtk gradlew :app:testDebugUnitTest` passed: `BUILD SUCCESSFUL`.
- The final Android command `source /home/jorlys/.local/share/hotel-alert-env/android-toolchain.sh && rtk gradlew :app:test :app:assembleDebug :app:lint :app:check` passed: `BUILD SUCCESSFUL`; only the existing explicit file-URL restriction deprecation warnings were emitted.
- `rtk git diff --check` passed.
- JVM coverage now verifies the main-frame-only recovery state transition and fresh WebView instance key used by retry/origin replacement; the real `WebViewClient` callbacks and Activity/WebView lifecycle remain an on-device check, and no physical device or emulator was used.
- Independent verification findings for this correction were addressed without broadening scope: the high-risk unkeyed AndroidView replacement, the medium stale/blank editor origin, and the low missing failed-origin assertions.
- The correction RED command was `source /home/jorlys/.local/share/hotel-alert-env/android-toolchain.sh && rtk gradlew :app:testDebugUnitTest --tests com.hotelalert.notificationreceiver.WebViewRecoveryTest`; it failed at test compilation because `failedServerOrigin` and the new recovery-transition arguments were not implemented.
- The correction GREEN command with the same selector passed: `BUILD SUCCESSFUL`.
- Final Android host verification after the correction passed: `source /home/jorlys/.local/share/hotel-alert-env/android-toolchain.sh && rtk gradlew :app:test :app:assembleDebug :app:lint :app:check` — `BUILD SUCCESSFUL`; only the existing explicit file-URL restriction deprecation warnings were emitted.
- `rtk git diff --check` from the repository root returned no output; the Android recovery files and task file are untracked in this dirty worktree, so this check does not validate their whitespace.
- `HotelWebView` now keys the AndroidView subtree by origin/reload key, constructs the restricted view in the factory, and releases it through `onRelease`; MainActivity passes the current failed origin into recovery state and the existing main-frame, navigation, diagnostics, and native receiver behavior remains unchanged.
- No physical device or emulator was inspected or used for this correction; real WebView callbacks and Activity/WebView lifecycle remain pending on-device validation.
- The modal-collapse diagnosis is confirmed by behavior: content appears after vertical swiping in the title strip, so the shared modal content renders but is trapped in a collapsed inner scroll viewport on Android WebView.
- The modal correction is authorized by the user; implementation must follow strict TDD with a failing regression observed before the production CSS change.
- The modal regression RED command was `corepack pnpm exec vitest run tests/unit/ui-styles.test.ts -t "gives shared modal cards a definite viewport-backed scroll surface"`; it failed with 1 test failed and 55 skipped because `.modal-card` had no viewport-backed `height` declaration.
- The modal GREEN command with the same selector passed: 1 test passed and 55 skipped after adding the shared viewport-backed modal height.
- Focused modal verification passed: `corepack pnpm exec vitest run tests/unit/ui-styles.test.ts tests/unit/modal.test.ts` — 2 files, 60 tests passed.
- Full web unit verification passed: `corepack pnpm test:unit` — 38 files, 397 tests passed.
- `corepack pnpm typecheck` passed across all configured workspace projects.
- The required `corepack pnpm lint` command failed with exit code 134 after Node reached its heap limit; a `NODE_OPTIONS=--max-old-space-size=4096 corepack pnpm lint` retry also failed with the same out-of-memory condition. Focused ESLint for `Modal.tsx`, `ui-styles.test.ts`, and `modal.test.ts` passed.
- Root-cause diagnostic: the dirty worktree contains untracked `opencode-2.0.11/` with 4,190 TypeScript/JavaScript source files, and the root `eslint .` command scans that subtree because `eslint.config.cjs` does not ignore it. Project-only lint passed with `corepack pnpm exec eslint . --ignore-pattern 'opencode-2.0.11/**' --format stylish`; no config change was made because this task remains scoped to the modal correction.
- `rtk git diff --check` passed with no output after the modal change.
- No physical device or emulator was inspected or used for the modal correction; Android WebView runtime behavior remains pending on-device validation.
- Parent verification confirmed the focused modal suite (`60` tests), full web unit suite (`397` tests), workspace typecheck, focused ESLint, project-only ESLint excluding unrelated `opencode-2.0.11/**`, and `rtk git diff --check` all passed. The required root `corepack pnpm lint` remains unavailable because ESLint scans the unrelated untracked source tree and exits with out-of-memory.
- The initial delivery verification rebuilt `apps/web/dist` as `index-DAbsis_N.css` with the combined `min(...dvh..., ...vh...)` declaration; the later real-tablet failure superseded that verification because it proved only bundle delivery, not compatibility with the target WebView.
- Final delivery verification rebuilt `apps/web/dist` as `index-CXH1kjbz.css`. The already-running local production server returned that exact asset, and the served CSS contains the ordered `height:calc(100vh - 48px);height:calc(100dvh - 48px)` fallback.
- Android JVM tests and a forced debug assembly passed with `./gradlew :app:test :app:assembleDebug --rerun-tasks`; the refreshed APK is `apps/android-notification-receiver/app/build/outputs/apk/debug/app-debug.apk` with SHA-256 `459dc5734a23c3c2e298982377ff49bbd7e9bcd43565cb55939f6e30386bc62d`.
- The user-provided real-tablet capture `WhatsApp Image 2026-09-20 at 8.57.29 PM.jpeg` showed that the modal still collapsed after the APK update and server restart. The earlier unsupported-`dvh` diagnosis was a hypothesis based on the screenshot and is superseded by the later CDP evidence from the target tablet.
- The progressive-enhancement fallback RED command was `corepack pnpm exec vitest run tests/unit/ui-styles.test.ts -t "gives shared modal cards a definite viewport-backed scroll surface"`; it failed with 1 test failed and 55 skipped because the rule did not contain standalone ordered `vh` and `dvh` height declarations.
- The same focused command passed GREEN with 1 test passed and 55 skipped after changing `.modal-card` to declare `height: calc(100vh - 48px)` first and `height: calc(100dvh - 48px)` second, while explicitly rejecting the combined `min(...)` form.
- Focused fallback verification passed: `corepack pnpm exec vitest run tests/unit/ui-styles.test.ts tests/unit/modal.test.ts` — 2 files and 60 tests passed.
- `rtk git diff --check -- apps/web/src/styles.css tests/unit/ui-styles.test.ts odd/tasks/android-webview-console.md` passed with no output.
- Final production delivery rebuilt `apps/web/dist` as `index-CXH1kjbz.css`; the active local server on port `3001` returned that exact asset and its content includes the ordered `vh`/`dvh` fallback.
- The isolated source/test patch is staged without unrelated worktree changes. The required work-unit commit was attempted with `fix(web): add WebView-safe modal height fallback` but Git rejected it because no repository/global `user.name` or `user.email` is configured; commit identity remains pending user configuration.
- Real-device inspection used a Samsung SM-T220 running Android 14 with WebView 151. The document viewport reported `innerHeight: 529`; the affected `.modal-card` had a computed rectangle height of `61.5px`, while `max-height: calc(100vh - 48px)` computed to `0px` and `height: calc(100dvh - 48px)` remained collapsed.
- CDP mutation on the same open modal proved the replacement before source implementation: `height: auto; max-height: none` expanded the card to `439.6px` and revealed the full form; `height: auto; max-height: 100%` produced the same `439.6px` result while preserving a bound from the fixed, inset, padded `.modal-scrim`.
- The persistent fix therefore removes all `vh`/`dvh` sizing from the shared `.modal-card`, sets `height: auto; max-height: 100%`, and retains `overflow-y: auto`. This supersedes both the original combined `min(...)` diagnosis and the ordered `vh`/`dvh` fallback diagnosis.
- The percentage-bound regression RED command was `corepack pnpm exec vitest run tests/unit/ui-styles.test.ts -t "lets shared modal cards size to content within the scrim scroll surface"`; it failed with 1 test failed and 55 skipped because the rule still contained viewport-relative heights and did not contain `height: auto`.
- The same focused command passed GREEN with 1 test passed and 55 skipped after the shared rule changed to `height: auto; max-height: 100%` and retained `overflow-y: auto`, with the test also rejecting `vh`/`dvh` units in that rule.
- Final focused modal verification passed with `corepack pnpm exec vitest run tests/unit/ui-styles.test.ts tests/unit/modal.test.ts`: 2 files and 60 tests passed. `git diff --check -- apps/web/src/styles.css tests/unit/ui-styles.test.ts odd/tasks/android-webview-console.md` returned no output.
- Persistent on-device verification passed after closing and reopening the modal to remove all temporary inline mutations: WebView computed `height: 439.577px`, `max-height: 100%`, no inline style, and rendered the complete registration form. Evidence: `artifacts/android-modal-debug/modal-final.png`.
- The stacking regression RED command was `corepack pnpm exec vitest run tests/unit/ui-styles.test.ts -t "keeps modal overlays above the Admin navigation stacking layer"`; it failed because `.admin-shell` still declared `z-index: 1` and trapped the modal below the sticky navbar.
- The same focused command passed GREEN after removing `.admin-shell`'s stacking context and changing `.modal-scrim` from `z-index: 10` to `z-index: 40`.
- Final focused modal/style verification passed: `corepack pnpm exec vitest run tests/unit/ui-styles.test.ts tests/unit/modal.test.ts` — 2 files and 61 tests passed; the scoped diff check returned no output.
- Real-device CDP verification on the authorized SM-T220 measured a `1006 x 529` viewport and modal bounds `x=203.286`, `y=44.624`, `width=600`, `height=439.577`, `bottom=484.202`; `clientHeight` and `scrollHeight` were both `438`, proving the registration form needs no internal scroll at this resolution. Hit-testing in the former navbar overlap returned the modal as the owner. Evidence: `artifacts/android-modal-debug/modal-stack-final.png`.
- Earlier controlled live retries showed both outcomes: a fresh installation can receive HTTP `201 Created`, while the tablet's stale retired installation receives `RESOURCE_CONFLICT`. The current server/web fix handles the latter explicitly without reactivating the retired row.
- The subsequent native handoff failed consistently: `HotelAlertNative` accepted the asynchronous pairing request, then reported `FAILED` with `errorCode: INVALID_ASSIGNMENT`; receiver state remained `IDLE` and no native snapshot was stored.
- CodeGraph confirmed the immediate cause in `DeviceSnapshotParser.parseSnapshot`: it hard-requires `assignmentMode == "AREA"`, a non-null `areaId`, and `config.mode == "AREA"`, so a valid ROOM snapshot cannot pass native pairing.
- A full native ROOM implementation is intentionally rejected for this work unit: it would need a closed command façade for room requests, DND, screensaver state, snapshot refresh, offline replay, authenticated image streaming, realtime, heartbeat, and token rotation. The selected mode-aware contract keeps native ownership for AREA only and uses the already-complete browser device session for ROOM, with no concurrent native ROOM connection.
- Focused GREEN verification passed: `corepack pnpm exec vitest run tests/unit/app.test.ts tests/unit/admin-screen.test.ts` — 2 files and 42 tests; `corepack pnpm --filter @hotel/web typecheck` passed; focused ESLint and scoped `git diff --check` passed.
- Full web unit verification passed: `corepack pnpm test:unit` — 38 files and 401 tests.
- On the authorized SM-T220 using the live Vite origin, the ROOM handoff bypassed `HotelAlertNative.pairDevice`, stored the device credential in the existing browser session, rendered room 101 with `Online`, and left the native snapshot `null`. After a full WebView reload, the same ROOM screen restored from the browser session with the native snapshot still `null`; no admin screen remained visible. Evidence was captured through CDP; no token value was persisted in task evidence.
- The current tablet capture shows the modal card above the navbar but the selector menu clipped beneath the card. CDP confirmed the modal selector wrapper has no `touch-select--modal` class because the wrapper drops the `modal` prop; the existing `.touch-select--modal .touch-select__menu` rule therefore never applies.
- Focused selector/style verification passed after the two-part fix: `corepack pnpm exec vitest run tests/unit/admin-screen.test.ts tests/unit/touch-select.test.ts tests/unit/ui-styles.test.ts` — 3 files and 93 tests passed; web typecheck, focused ESLint, and scoped `git diff --check` also passed.
- CDP on the authenticated tablet then showed a second independent cause: the open `.touch-select__menu` resolved to `max-height: 0px` under Android WebView even though its source used `min(320px, 40vh)`, leaving only the border/padding strip. The modal override now uses `max-height: 240px` and the active wrapper uses `touch-select--open` plus the `aria-expanded` fallback selector.
- Focused selector/style verification passed after the height and stacking fix: `corepack pnpm exec vitest run tests/unit/admin-screen.test.ts tests/unit/touch-select.test.ts tests/unit/ui-styles.test.ts` — 3 files and 95 tests passed; web typecheck, focused ESLint, and scoped `git diff --check` also passed.
- Full web unit verification passed after the selector fix: `corepack pnpm test:unit` — 38 files and 404 tests passed.
- Authenticated real-tablet verification passed after a full WebView reload: the mode menu displayed `Pantalla de habitación` and `Consola de área` above the submit button, and the room menu displayed all three rooms above the surrounding content. No option was changed and `Registrar estación` was never pressed.
- The prior live test retired the temporary AREA and ROOM rows in `data/hotel.sqlite`; no direct database mutation was used to restore them. Tablet role restoration remains pending authenticated use of the shared web registration flow.
- The new login-role onboarding work is authorized but has not registered or mutated any device in this session.
- AWC-LOGIN-ROLE-ONBOARDING RED was observed before the new screen existed: `corepack pnpm exec vitest run tests/unit/device-role-assignment.test.ts` failed with a module-not-found error. GREEN now passes the focused role/assignment suite: `corepack pnpm exec vitest run tests/unit/device-role-assignment.test.ts tests/unit/admin-login.test.ts tests/unit/bootstrap-screen.test.ts tests/unit/app.test.ts` — 4 files, 32 tests passed.
- The focused App tests verify that selecting ROOM at login routes to the target picker and that choosing a room calls `/devices/bootstrap` with the exact shared payload, stores the browser credential, and leaves the native bridge unused for ROOM.
- Final web verification for AWC-LOGIN-ROLE-ONBOARDING passed: `corepack pnpm test:unit` — 39 files, 412 tests; `corepack pnpm --filter @hotel/web typecheck`; focused ESLint over the changed web/tests files; and `git diff --check`.
- No APK was rebuilt and no tablet/room device was registered for this feature; the user retains the registration action. The existing Admin “Registrar estación” form remains available as the administrative fallback.
- AWC-LOGIN-VIEWPORT-COMPACT RED/GREEN verification passed: the bootstrap regression now proves the visible surface contains the auth form and actionable error only, excludes the former intro/installation/build text, and includes explicit square-kiosk and tablet CSS rules.
- Final compact-login checks passed: `corepack pnpm exec vitest run tests/unit/bootstrap-screen.test.ts tests/unit/admin-login.test.ts tests/unit/app.test.ts tests/unit/ui-styles.test.ts` — 4 files, 86 tests; `corepack pnpm test:unit` — 39 files, 413 tests; web typecheck; focused ESLint; production web build; and `git diff --check`.
- AWC-LOGIN-ROLE-CARDS-ERROR focused verification passed: `corepack pnpm exec vitest run tests/unit/admin-login.test.ts tests/unit/bootstrap-screen.test.ts tests/unit/ui-styles.test.ts tests/unit/app.test.ts` — 4 files and 87 tests; web typecheck, focused ESLint, and `git diff --check` also passed.
- Full web unit verification passed after the role-card change: `corepack pnpm test:unit` — 39 files and 414 tests; production web build passed with only the existing Vite chunk-size warning.
- Live bootstrap availability checks returned HTTP 200 from `127.0.0.1:3001`, `192.168.0.201:4173`, and the Vite path with an LAN `Origin`; the screenshot banner is not a current server/API failure. The native bridge path separately emitted the same generic message for an unpaired tablet, which is the misleading case being corrected.
- No API/server contract, APK, or device registration change was made for AWC-LOGIN-ROLE-CARDS-ERROR.
- AWC-LOGIN-ROLE-CARDS-ERROR final verification passed after the native-banner correction: focused suite — 4 files and 88 tests; full unit suite — 39 files and 415 tests; web typecheck, focused ESLint, production build, and `git diff --check` all passed. The build emitted only the existing Vite chunk-size warning.
- AWC-LOGIN-ROLE-BUTTONS verification passed: focused login/bootstrap/style/App suite — 4 files and 88 tests; full unit suite — 39 files and 415 tests; web typecheck, focused ESLint, production build, and `git diff --check` all passed. The build emitted only the existing Vite chunk-size warning.
- AWC-LOGIN-ROLE-BUTTONS used the existing delegated direct writer; buttons expose `aria-pressed`, retain the existing role state/callback, and remain at least 48px tall in both responsive layouts. Labels are localized as `Admin`/`Habitación`/`Área` in Spanish and `Admin`/`Room`/`Area` in English.

## Next Step

Have the operator reload `http://192.168.0.201:4173/` and validate the three text buttons on both target viewports from `corepack pnpm dev`; verify a previously retired installation can register a new ROOM/AREA target without clearing the whole browser or reactivating the retired row. If a banner reappears after pairing, capture the browser network failure time and server log request ID before changing the API contract. The native AREA lifecycle matrix for Home, Back, Recents dismissal, screen-off, reboot, force-stop, and battery restrictions remains pending. Work-unit commits remain pending because Git user identity is not configured in this repository; configure it before committing the dirty worktree.

### AWC-AREA-PAIRING-HANDOFF-RECOVERY — Complete native AREA handoff without duplicate bootstrap

- **Route:** delegated direct writer after live ADB/CDP and database mapping; the change spans Android Keystore token persistence, web bootstrap retry state, and focused pairing/handoff regressions.
- **Trigger evidence:** mapping required App, API, server bootstrap/idempotency, native bridge, Android pairing coordinator, service controller, and live tablet/SQLite evidence (4+ files); implementation touches multiple non-trivial files.
- **Authorized scope:** fix the selected AREA handoff and its recovery only. Do not create, retire, reassign, or delete stations automatically; preserve the existing active Housekeeping row created during diagnosis.
- **Acceptance:** selecting an AREA on the tablet completes native pairing and transitions to the AREA view; a transient native handoff failure can be retried with the already-created bootstrap result instead of issuing a second bootstrap for the same installation; active-installation conflicts remain actionable and no duplicate device is created; ROOM browser ownership remains unchanged.
- **Checks:** strict RED/GREEN focused web/App and Android pairing/service tests, full web unit suite, workspace typecheck, focused lint, Android unit/build checks, `git diff --check`, and real SM-T220 CDP/ADB verification without additional station registration.
- **Rollback boundary:** remove only native AREA token-persistence/handoff recovery changes and their focused tests; preserve grid, viewport, modal, login-role, and ROOM ownership work.
- **Root cause confirmed:** Android Keystore rejected the caller-provided AES-GCM IV (`InvalidAlgorithmParameterException: Caller-provided IV not permitted`) in `AndroidKeyStoreDeviceTokenStore.write`; the server bootstrap had already created the device, so the coordinator rolled back local credentials and the next tap produced `RESOURCE_CONFLICT`.
- **Implementation:** encryption now lets Android Keystore generate the GCM IV and stores `cipher.iv`; onboarding uses the stable key `station-onboarding-{role}-{installationId}-{targetId}` so a retry replays the idempotent result instead of creating a second device. The unrelated foreground-service experiment was reverted.
- **Verification:** Android `:app:test :app:assembleDebug` passed; web `corepack pnpm test:unit` passed with 39 files/432 tests; `corepack pnpm typecheck`, focused ESLint, and scoped diff checks passed. On SM-T220, pairing the already-created Housekeeping device succeeded, the receiver reached `SYNCHRONIZED`, the native snapshot rendered the AREA console, and the service reported `isForeground=true`. No additional station was registered.
- **Status:** Complete for the reported duplicate-bootstrap/native pairing failure. Remaining lifecycle checks (reboot, force-stop, battery restrictions) stay outside this correction.

### AWC-STATION-DELETION-LOGOUT — Clear deleted station state and return to onboarding

- **Route:** delegated direct writer after mapping the web/native auth-invalidation flow; the change spans App local-state cleanup, Android receiver credential cleanup, and focused regressions.
- **Trigger evidence:** the existing web handler removes only the browser token, while the native bridge keeps the last snapshot/configuration after `DEVICE_INACTIVE`; the authenticated AREA view therefore remains visible after an administrator deletes the station.
- **Authorized scope:** clear only assignment/session state when the server invalidates a device; preserve the configured server origin so the APK can return to the login/onboarding screen. Do not create, retire, reassign, or delete stations from the agent.
- **Acceptance:** a deleted AREA station is detected on the next authoritative snapshot/heartbeat, the native receiver clears token/configuration/snapshot/cursor, the WebView leaves the device view, all browser device cache is removed, and the operator sees the login/onboarding surface ready to assign the station again. ROOM browser ownership remains unchanged.
- **Checks:** strict RED/GREEN App and Android auth-invalidation tests, full web unit suite, workspace typecheck/lint, Android unit/build/check, and scoped diff checks. Physical tablet validation must not select or register a station.
- **Rollback boundary:** remove only invalidated-station cleanup and its focused tests; preserve native AREA pairing, browser ROOM ownership, and the existing Admin fallback.

### AWC-AREA-CONSOLE-COMPACT — Float status messages and reclaim AREA console space

- **Route:** delegated direct writer after mapping the AREA console markup and responsive styles; the change spans AreaDisplay composition, device styles, and focused UI regression coverage.
- **Trigger evidence:** AREA status/error messages are rendered as normal-flow `.inline-alert` blocks, the footer consumes layout height, and grid columns stretch empty queue states to the tallest column (`min-height: 240px`), leaving avoidable blank space.
- **Acceptance:** AREA connection/error/native-command messages render in an accessible floating status stack that does not participate in layout; the queue board aligns columns to their content, removes forced empty-column height, and reduces unnecessary area padding/gaps while preserving touch targets, drag/drop behavior, and actionable errors.
- **Checks:** strict RED/GREEN DeviceScreen/style regressions, full web unit suite, workspace typecheck/lint, and scoped diff checks. Verify the compact layout in browser and authorized tablet without modifying station assignments.
- **Rollback boundary:** remove only floating status presentation and AREA spacing/queue sizing changes; preserve request transitions and ROOM layout.

## Progress (continued)

- [x] AWC-STATION-DELETION-LOGOUT — clear native/browser assignment state after server invalidation; return to onboarding.
- [x] AWC-AREA-CONSOLE-COMPACT — float AREA status messages and reclaim unused queue space.

## Route Evidence (continued)

- The mapping trigger fired because the deletion path crosses App startup/auth invalidation, the native Android receiver/storage/bridge, and DeviceScreen/styles/tests (4+ files); read-only mapping was delegated before any source edit.
- Writer delegation is required because the authorized implementation spans more than two non-trivial files and two runtimes (web and Android).

## Verification Evidence (continued)

- `corepack pnpm test:unit` passed: 39 files, 435 tests.
- `corepack pnpm typecheck` passed for all workspace projects.
- Android `:app:assembleDebug :app:lint :app:check` passed; `:app:test` passed.
- APK rebuilt at `apps/android-notification-receiver/app/build/outputs/apk/debug/app-debug.apk`, SHA-256 `00dbd533ea0fa80432b12b1555d145aee3628afc74c2fd8c91d803ed2005b9fe`, and installed on the authorized SM-T220 through ADB. The device opened on the login/onboarding surface after installation.
- No station was created, retired, reassigned, or deleted by the agent.
- Definitive invalidation is limited to `DEVICE_INACTIVE` and `DEVICE_TOKEN_REVOKED`; recoverable token-rotation failures do not clear assignment state.

## Next Step (continued)

Operator validation: delete an AREA station from Admin and confirm the affected tablet clears its native/browser assignment state, returns to login, and can be assigned again. Validate the AREA console at the tablet viewport and confirm floating notices do not change queue layout height.

### AWC-ANDROID-CONNECTION-BRANDING — Match native connection/recovery UI to the web app

- **Route:** delegated direct writer after mapping the Compose setup/recovery screens, MainActivity host, theme, and launcher resources.
- **Trigger evidence:** the APK's first-run/recovery/diagnostic Compose surfaces still use default Material styling while the web app defines a custom paper/ink/coral/amber visual system; the launcher manifest has no branded icon reference.
- **Authorized scope:** restyle native setup/recovery connection surfaces with the existing web palette and typography cues, preserve behavior and accessibility, and replace the default launcher icon with a repo-native vector/adaptive icon. Do not change pairing semantics or mutate stations.
- **Acceptance:** setup and recovery screens visibly share the web app's background, card, typography, button, field, status, and spacing language; retry/change-server actions remain touch-friendly and accessible; diagnostics remains usable; launcher uses the new Hotel Alert mark instead of the platform default.
- **Checks:** strict RED/GREEN Android UI/resource tests, `:app:test`, `:app:assembleDebug`, `:app:lint`, `:app:check`, and ADB screenshot verification on the authorized tablet without registering a station.
- **Rollback boundary:** remove only the native branding/theme/icon changes and focused tests/resources; preserve the WebView, pairing, invalidation, and station lifecycle behavior.

## Progress (branding)

- [x] AWC-ANDROID-CONNECTION-BRANDING — align native connection/recovery screens with web styles and replace the launcher icon.

### AWC-AREA-REQUEST-SEMANTICS — Align visible request states with operator workflow

- **Route:** delegated direct after mapping shared status transitions, server snapshot filters, AreaDisplay filters/actions, and localization/tests.
- **Trigger evidence:** the current UI exposes four visible states (`Nueva`, `Aceptada`, `En progreso`, and hidden completed) while the operator workflow requires three states: Pendientes, En proceso, and Completadas; the server snapshot also excludes completed requests from AREA consoles.
- **Authorized scope:** preserve legacy data compatibility where safe, but make the new AREA workflow use PENDING → IN_PROGRESS → COMPLETED, expose completed requests in the AREA console, and keep all status mutations owned by the responsible AREA principal.
- **Acceptance:** AREA UI shows only the three requested workflow states, pending requests start directly as En proceso, in-process requests complete only after the responsible confirms, completed requests remain visible in the AREA console, and room creation/request behavior remains unchanged.
- **Checks:** strict RED/GREEN shared/domain/server/web regressions, full web unit suite, workspace typecheck, focused lint, integration tests, and diff checks. No station mutation.
- **Rollback boundary:** remove only the state-semantic/UI changes and focused tests; preserve native command transport and existing request authorization.

### AWC-ANDROID-AREA-COMMANDS — Enable responsible AREA actions in the native console

- **Route:** delegated direct writer after mapping the native bridge, token/configuration stores, HTTP client, and existing transition authorization.
- **Trigger evidence:** the APK advertises `deviceCommands=false`, so AreaDisplay renders the exact error shown in the tablet screenshot and blocks every transition even though server policy already authorizes AREA device principals.
- **Authorized scope:** add a secure native command façade that keeps the device token in Android storage, sends authorized request transitions to the existing server endpoints, reports async results through the bridge, and enables only AREA command capability. Do not expose tokens to JavaScript or mutate stations.
- **Acceptance:** the responsible AREA console can start and complete requests from Android; authorization, expected-version conflict handling, idempotency, and definitive auth invalidation remain enforced; ROOM devices stay read-only for request transitions.
- **Checks:** strict RED/GREEN native bridge/HTTP/client tests, Android `:app:test`, assemble, lint, check, focused web native-bridge/App/DeviceScreen tests, full web suite, typecheck, and ADB verification without registering a station.
- **Rollback boundary:** remove only the native request-command façade and capability wiring; preserve native pairing, snapshot delivery, invalidation cleanup, and ROOM ownership.

## Progress (request workflow)

- [x] AWC-AREA-REQUEST-SEMANTICS — align visible statuses and completed-request visibility.
- [x] AWC-ANDROID-AREA-COMMANDS — enable responsible AREA actions through the secure native bridge.

## Verification Evidence (branding)

- Added `HotelAlertTheme` and brand mark using the web console palette, serif headings, sans-serif body text, paper cards, coral/amber accents, and matching rounded surfaces.
- Restyled native server-origin setup and recovery screens without changing save/retry/change-server behavior; MainActivity now applies the theme to all native surfaces, including diagnostics.
- Replaced the platform launcher icon with a Hotel Alert vector mark and updated the app label/theme status-bar colors.
- Android `:app:test`, `:app:assembleDebug`, `:app:lint`, and `:app:check` passed.
- Final APK SHA-256: `38d3bd2c963e8c88a4f3fc648374da2a88133f623c1c3301db3d783cfc5493da`.
- Installed the APK on the authorized tablet; the custom launcher mark was visible during startup and the WebView login remained functional. No station was registered or mutated.

## Verification Evidence (request workflow)

- [x] AWC-AREA-REQUEST-SNAPSHOT-REFRESH — refresh the native AREA snapshot after realtime request events so room requests appear in the Android WebView console.

- AREA-visible workflow now exposes only `Pendientes`, `En proceso`, and `Completadas`; legacy `ACCEPTED` rows are grouped into `En proceso` without destructive data migration.
- New AREA actions use `PENDING -> IN_PROGRESS -> COMPLETED`; the server still accepts legacy `PENDING -> ACCEPTED -> IN_PROGRESS` records and exposes completed requests in AREA snapshots while preserving ROOM's active-request view.
- Only an assigned AREA device principal can transition requests; administrator views remain read-only for request status changes and retain history access.
- Android WebView capabilities now advertise `deviceCommands:true` only when the secure native command coordinator is installed. The bridge accepts request metadata only, keeps the bearer token in Keystore-backed storage, executes the existing `/start` and `/complete` endpoints with expected-version and idempotency headers, and returns an asynchronous command status.
- ROOM devices remain read-only for native request commands; the coordinator rejects commands when the native snapshot is not an AREA snapshot.
- `corepack pnpm test:unit` passed: 39 files, 436 tests. `corepack pnpm typecheck` passed across all workspace projects. Focused ESLint passed for changed web/server/shared/notification files.
- Android `:app:testDebugUnitTest`, `:app:assembleDebug`, `:app:lint`, and `:app:check` passed.
- APK rebuilt at `apps/android-notification-receiver/app/build/outputs/apk/debug/app-debug.apk`, SHA-256 `f96c6302697973ea6ea351e2fb4a7904aeeaa90ac90acdbed1bd2a822d16c707`, and installed on the authorized SM-T220. The post-install screenshot shows the branded login surface; no station was registered, reassigned, retired, or deleted.
- Scoped `git diff --check` passed with no whitespace errors; no commit was created because repository Git identity is not configured.

### AWC-AREA-BACKGROUND-ACTIONS — Make AREA actions reliable in foreground and background

- **Route:** delegated direct writer after mapping the native WebView command path, server transition policy, foreground service lifecycle, and Android notification sink.
- **Trigger evidence:** the tablet reproduced `REQUEST_INVALID_TRANSITION` through the native bridge even though source code allows `PENDING -> IN_PROGRESS`; the running server had loaded an older `@hotel/shared` build. The existing foreground service survives Activity/WebView closure but only opens diagnostics from request notifications and offers no background action.
- **Authorized scope:** make the runtime transition path use the current shared transition contract and expose actionable Android heads-up notifications from the existing foreground service. The notification action must transition the responsible AREA request to `IN_PROGRESS` with expected-version and idempotency protection, without exposing device credentials or mutating station assignments.
- **Acceptance:** tapping `Iniciar solicitud` from the AREA WebView succeeds against a freshly restarted dev server; a new request produces an Android heads-up notification while the Activity is minimized/closed; the notification includes an action that starts the request; auth/version/invalid-transition failures are shown with a specific localized message; service lifecycle remains independent of the WebView.
- **Checks:** focused web/native bridge tests, Android unit tests for notification action and command result handling, `corepack pnpm --filter @hotel/shared build`, Android `:app:test`, assemble, lint, check, integration realtime test, APK install, and ADB verification without station mutation.
- **Rollback boundary:** remove only the notification action/receiver and command error mapping/runtime refresh changes; preserve pairing, snapshot delivery, station invalidation, and existing request semantics.

## Progress (background actions)

- [x] AWC-AREA-REQUEST-ACTION-ERROR — eliminate the stale shared-runtime transition mismatch and surface precise native command errors.
- [x] AWC-AREA-BACKGROUND-NOTIFICATION-ACTION — add heads-up request notifications with a direct request action while the app is minimized or closed.

## Verification Evidence (background actions)

- CDP reproduction on the authorized SM-T220 returned `REQUEST_INVALID_TRANSITION` for a PENDING request through `transitionRequest`; the source shared contract already permits `PENDING -> IN_PROGRESS`, proving the running server needed a rebuilt shared package and restart.
- The existing `HotelNotificationReceiverService` is a `START_STICKY` foreground `dataSync` service and remains active independently of `MainActivity`; `AndroidNotificationSink` currently posts a notification that only opens diagnostics.
- Rebuilt `@hotel/shared` and reloaded the dev server; the same native command then succeeded with `PENDING -> IN_PROGRESS` (one existing request was advanced during verification).
- `apps/web/src/api.ts` now maps native command codes such as `REQUEST_VERSION_CONFLICT`, `REQUEST_INVALID_TRANSITION`, device invalidation, unavailable commands, and denied Android notifications to localized messages instead of the generic update failure.
- Added `NotificationActionReceiver` (`exported=false`) with Keystore-backed coordinator access, `expectedVersion`, stable idempotency metadata, success cancellation, and specific failure notifications. Request notifications use a versioned high-importance channel (`hotel-alert-requests-v2`) so Android can display heads-up alerts and an action while the Activity/WebView is closed.
- Verification passed: Android `:app:testDebugUnitTest`, `:app:test`, `:app:assembleDebug`, `:app:lintDebug`, `:app:lint`, `:app:check`; web focused tests (90 tests), realtime integration (12 tests), workspace typecheck, production web build, and `git diff --check`.
- APK rebuilt and installed on the authorized SM-T220 through ADB. Current debug APK SHA-256: `042abeccff3b0e53cfa8ab5ee29f3dfe2f55069c5922f889461eb7846dc5f195`; no station was registered or mutated.

## Verification Evidence (AREA request delivery)

- Root cause confirmed: the realtime `request.created`/`request.updated` event reached `AndroidLanReceiver` and the notification sink, but the `NativeReceiverSnapshotStore` consumed by the WebView remained stale because request events did not trigger a snapshot refresh.
- `AndroidLanReceiver` now requests `synchronize(refreshSnapshot = true)` for `request.created` and `request.updated`, so the native AREA queue receives the latest server snapshot without requiring a manual reload.
- Added `requestEventsRefreshTheNativeSnapshotForTheWebViewConsole` regression coverage; Android `:app:testDebugUnitTest`, `:app:test`, `:app:assembleDebug`, `:app:lint`, and `:app:check` passed after the fix.
- `corepack pnpm vitest run tests/integration/realtime.test.ts` passed: 12 tests, including delivery after room/area assignment changes.
- Rebuilt and installed the current APK on the authorized SM-T220 through ADB. SHA-256: `daab2dbcb4c1a36fbe8c88179982aa1e184fcb962a6b9d4a0992e665a07bcd57`. Installation preserved the existing device data; no station was registered or mutated.
### AWC-AREA-NOTIFICATION-SOUND — Add an audible alert to incoming AREA requests

- **Route:** delegated direct writer; the change spans Android notification-channel sound configuration, bundled notification audio resources, and focused Android verification.
- **Trigger evidence:** the installed AREA notification channel is HIGH importance and actionable, but `AndroidNotificationSink` uses the system default sound and no request-specific bundled alert; the operator explicitly requires a bell sound on every incoming request.
- **Authorized scope:** add a bundled bell notification sound to new request notifications without changing request transitions, station assignment, or the existing background action contract. Preserve Android channel versioning so the sound is applied to existing installations.
- **Acceptance:** a new request notification plays an audible bell when notifications are enabled, remains heads-up/actionable while the Activity/WebView is closed, and respects Android channel/user mute settings; notification failures remain non-fatal to realtime delivery.
- **Checks:** strict Android unit/build/lint/check verification, channel/resource inspection on the authorized tablet, APK rebuild/install, and `git diff --check`; no station registration or mutation.
- **Rollback boundary:** remove only the bundled alert resource and notification sound/channel configuration; preserve error mapping, background actions, snapshot refresh, and station lifecycle.

## Progress (notification sound)

- [x] AWC-AREA-NOTIFICATION-SOUND — add audible bell sound to incoming AREA notifications.

## Verification Evidence (notification sound)

- Added `app/src/main/res/raw/hotel_alert_bell.ogg`, a 1.15-second bundled bell sound, and configured `hotel-alert-requests-v3` with `AudioAttributes.USAGE_NOTIFICATION` and HIGH importance.
- Versioned the channel because Android preserves existing channel sound/mute settings; existing tablets now create the audible v3 channel without altering the legacy v2 channel.
- Android `:app:testDebugUnitTest`, `:app:test`, `:app:assembleDebug`, `:app:lintDebug`, `:app:lint`, and `:app:check` passed.
- Rebuilt and installed the final APK on SM-T220. SHA-256: `d83235870bb467ce80c534727ec2b1c8b9870e0d9367e89e186058b8e425cf01`.
- ADB verified `hotel-alert-requests-v3` at importance `4` with the bundled `android.resource://` sound URI and `POST_NOTIFICATIONS` granted. No station was registered or mutated.
### AWC-AREA-NOTIFICATION-TAP-ROUTE — Return notification taps to the web AREA console

- **Route:** delegated direct writer; the change spans Android notification content-intent routing, MainActivity intent handling/WebView startup, and focused Android tests.
- **Trigger evidence:** the tablet screenshot shows a request notification tap opening the native “Hotel Alert notification receiver” diagnostics screen. `AndroidNotificationSink` adds event/request/area extras, while `MainActivity.shouldShowReceiverDiagnostics` treats those extras as a diagnostics request; the notification body therefore bypasses the web AREA console.
- **Authorized scope:** make a request-notification body tap reopen the configured WebView console at the responsible AREA view, while keeping explicit diagnostics/service notifications on the diagnostics screen and preserving the background action button.
- **Acceptance:** tapping a request notification body does not show native setup/diagnostics; it opens the web console with the current native AREA snapshot and request context available, even when the Activity was closed. Explicit diagnostics intents remain unchanged; no station assignment or request mutation is performed by the routing fix.
- **Checks:** strict Android unit/build/lint/check verification, ADB install/smoke verification on SM-T220 without station mutation, and `git diff --check`.
- **Rollback boundary:** remove only request-notification body routing and its focused tests; preserve notification sound, background action, native diagnostics, snapshot refresh, and station lifecycle.

## Progress (notification tap route)

- [x] AWC-AREA-NOTIFICATION-TAP-ROUTE — route request notification taps to the web AREA console.

## Verification Evidence (notification tap route)

- Root cause confirmed: request notification body intents carried event/request/area extras, and `MainActivity.shouldShowReceiverDiagnostics` interpreted those metadata extras as a diagnostics request. That routed notification taps to the native setup screen instead of the WebView AREA console.
- `AndroidNotificationSink` now opens `MainActivity` for request body taps without diagnostics metadata; `MainActivity` enters native diagnostics only when the explicit `EXTRA_SHOW_DIAGNOSTICS` flag is present. The notification action button remains unchanged.
- `MainActivityTest` covers the explicit-diagnostics-only decision. Android `:app:testDebugUnitTest`, `:app:assembleDebug`, `:app:lintDebug`, and `:app:check` passed.
- Rebuilt and installed the final APK on the authorized SM-T220. SHA-256: `4edce180784f31eab55a0e7c77852ee2f955ffbe1e4e2ad8ed82b57e3a34a6a9`.
- No station was registered, reassigned, retired, deleted, or otherwise mutated during verification. A live end-to-end body-tap test remains for the operator to perform with a fresh request notification.

### AWC-BACKGROUND-ROOM-ALERT-POPUP — Show only new room requests as an actionable popup

- **Route:** delegated direct writer after mapping the realtime event boundary, Android notification channel, background action receiver, and Activity lifecycle.
- **Trigger evidence:** the current native sink delivers both `request.created` and `request.updated`, so status changes generate notifications. The current UI is a system notification only; the operator requires an actionable popup with room/service details while the WebView is minimized or closed.
- **Authorized scope:** notify only for new requests created by ROOM devices and only while the operator app is backgrounded; present a high-priority heads-up/full-screen-capable native popup with request details and an `Iniciar solicitud` action that reuses the existing idempotent AREA transition. Preserve the web modal when the app is foregrounded, notification sound, snapshot refresh, station lifecycle, and diagnostics fallback.
- **Acceptance:** `request.updated` never posts an operator alert; a new ROOM request posts one audible high-priority alert while the app is minimized/closed; the alert shows room, area, and service data and lets the operator start the request without opening the WebView; foreground WebView behavior remains unchanged; duplicate/replayed events remain suppressed.
- **Checks:** strict RED/GREEN Android unit tests for event filtering, foreground suppression, popup intent metadata, and action wiring; Android test/build/lint/check; ADB channel/notification smoke verification on SM-T220 without station mutation; `git diff --check`.
- **Rollback boundary:** remove only the popup Activity, background visibility gate, created-event notification filter, and focused tests; preserve the existing native command coordinator, snapshot delivery, sound channel, and station lifecycle.

## Progress (background room alert popup)

- [x] AWC-BACKGROUND-ROOM-ALERT-POPUP — show only new room requests as an actionable background popup.

## Verification Evidence (background room alert popup)

- `NotificationReceiverCore` now delivers to the Android notification sink only for `request.created`; `request.updated` events continue to advance/acknowledge the cursor and trigger native snapshot refresh without posting an alert.
- `AndroidNotificationSink` suppresses operator alerts while `MainActivity` is foreground. When the app is minimized or closed while the foreground receiver service remains active, the request uses the HIGH-importance v3 channel with the bundled bell and an actionable heads-up notification.
- The notification title/text and expanded content include room, service, and area. The `Accept / start request` action reuses `NotificationActionReceiver` and the existing idempotent `PENDING -> IN_PROGRESS` coordinator path.
- Android 14 verification confirmed `hotel-alert-requests-v3` at importance `4` with the bundled sound URI and POST_NOTIFICATIONS granted. Full-screen intents were intentionally not required because Android 14 restricts them; the supported heads-up popup remains the primary cross-app surface.
- Android `:app:testDebugUnitTest`, `:app:assembleDebug`, `:app:lintDebug`, and `:app:check` passed. APK rebuilt and installed on SM-T220; SHA-256: `1c99bf1c8c5cc090a47f8005073433a2fcf32e560b98dbca0a9fd46b27c8c468`.
- No station was registered, reassigned, retired, deleted, or otherwise mutated. Live room-to-area notification/action verification remains for a fresh request generated by the operator.
