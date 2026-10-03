# Server-Processed Image Uploads

## Objective
Accept user-selected image files for the app background and Information module, then decode, validate, resize/crop, and normalize them on the server before storage and display.

## Problem and Why
Before implementation, the background was resized in the browser and the Information module only accepted a short allowlist of image MIME types, then stored uploaded bytes unchanged. Users should not need to understand file formats or prepare optimized image variants manually; one server-side pipeline should produce assets compatible with the app.

## Authorized Scope
- Admin background image upload and clear flow.
- Admin Information module image upload and repair flow.
- Server image decoding/normalization, validation, storage, and response compatibility for both flows.
- Focused unit/integration tests and documentation of the local image processor requirement.

## Constraints
- Preserve all pre-existing dirty worktree changes. In particular, shared server route/service and admin files already have user-owned edits; integrate with them and never reset or stage unrelated hunks.
- Preserve Information module's language-specific artwork and existing language/variant metadata. The server can resize/crop but cannot translate embedded text.
- Do not trust uploaded filename or declared MIME. Verify/decode image content; reject corrupt, oversized, or unsupported data with a safe user-facing error.
- Bound input bytes, decoded pixels, subprocess time, and normalized output bytes. Do not retain originals unless the existing contract requires it.
- Reuse the existing output/storage contract where possible; the background still produces its square and wide variants.
- Use the FFmpeg executable already installed on the local server host; do not download a package or call an external image service. Document that the server runtime needs FFmpeg on PATH (or a configured binary path).
- No APK build/install, device operation, remote deployment, or server restart; the user runs local `corepack pnpm dev`.
- Effective TDD: OFF, as observed in the active project/session tracker. Use ordinary functional checks, not RED/GREEN claims.
- Focused runner: `corepack pnpm exec vitest run tests/unit/admin-screen.test.ts tests/unit/shared-domain.test.ts tests/unit/device-screen.test.ts tests/unit/information-image-store.test.ts tests/unit/information-service.test.ts tests/unit/information-carousel.test.ts tests/integration/information-api.test.ts`.
- Additional check: `corepack pnpm typecheck`; use `git diff --check`.

## Delivery
- Route: delegated direct implementation.
- Trigger evidence: CodeGraph and mapping found both upload flows span 4+ non-trivial files; implementation will change multiple non-trivial client/server/test files, requiring a delegated writer.
- Branch: user clarified to continue on the existing checkout branch, with no new branches. Current branch is `jorlys/feat/lan-notification-agent`; stay on it and do not switch or fetch. The worktree contains extensive unrelated staged/unstaged changes; preserve them and scope commits to this feature's own changes.
- Strategy: `exception-ok` per the user's no-new-branches instruction. IMG-01 alone adds 588 authored lines across processor/tests/runtime docs (generated files excluded), exceeding the ~400-line budget. IMG-01 commit: `988d265` (scoped to the processor, tests, and runtime documentation).

## Acceptance Criteria
1. The background picker accepts image files without requiring a specific browser-side MIME allowlist or canvas conversion; the server generates the same two display variants in the existing settings contract.
2. Information uploads/repairs accept image files and the server normalizes each language/variant upload before persistence and serving.
3. Invalid/corrupt, unsupported, oversized, and excessive-pixel images fail safely without partial persistence or leaking decoder details.
4. Existing authorization, CSRF/rate-limit/idempotency behavior, ordering, language fallback, and clear/delete behavior remain intact.
5. Focused tests, typecheck, and diff checks pass; existing unrelated dirty work remains untouched.

## Tasks
- [x] IMG-01 — Add bounded server-side image decode/normalization with focused tests and runtime documentation. Implementation and checks complete; committed as `988d265`.
- [x] IMG-02 — Move background upload transformation from browser to the server while preserving the current setting/display contract; add API/UI tests. Complete; included in work-unit commit `f073d67`.
- [x] IMG-03 — Normalize Information module upload/repair images on the server and broaden the file picker; add API/service/UI regression tests. Complete; included in work-unit commit `f073d67`.

## Progress and Evidence
- Exploration: complete. CodeGraph mapping and a read-only explorer traced both upload flows. FFmpeg 8.0.1-3ubuntu2 is installed locally; no Sharp/Jimp/canvas processing package is declared or installed.
- Source changes: IMG-01 added `apps/server/src/images/image-processor.ts`, `tests/unit/image-processor.test.ts`, and `docs/server-image-processing.md`.
- Source changes: IMG-02 added a multipart ROOM background endpoint and bounded WebP normalizer; the settings UI now previews the selected file locally and submits the original image to the server, with no browser-side MIME/120-KiB gate. The parser preserves case-sensitive multipart boundaries while matching media types case-insensitively.
- Source changes: IMG-03 normalizes all Information image uploads and repair variants to WebP before persistence, preserves localized variant metadata/idempotency, and accepts `image/*` in the picker. Invalid batches are rejected before any files are persisted.
- Verification: IMG-01 focused Vitest 12/12, workspace typecheck, and tracked/untracked whitespace checks passed.
- Verification: After IMG-02 and IMG-03, focused integration/unit coverage passed (11 files, 196 tests); `corepack pnpm typecheck` and image-scoped `git diff --check` passed. The supplied `fondo.jpg` also normalized successfully to both expected WebP background variants within the existing setting cap.
- Unrelated check: `tests/unit/admin-localization.test.ts` has 23/24 passing; its city-search test expects weather coordinate inputs while availability is still `checking`. This belongs to the existing time-zone/location work, not image uploads, so it was left unchanged.
- Work-unit commits: IMG-01 `988d265`; IMG-02 and IMG-03 `f073d67` (`feat(server): normalize uploaded images`), on `jorlys/feat/lan-notification-agent`. The ~400-line budget was crossed; the user rejected branch chains and authorized continuing here. Keep unrelated staged/unstaged work untouched.
- Review assessment: disabled by clone-local user preference; report `disabled/unmanaged`.

## Next Step
No image implementation remains. The user can retry the ROOM background and Information uploads against their local `corepack pnpm dev` server; do not deploy or restart it on their behalf. Track the unrelated city-search localization test separately if requested.

## Key Learnings
- Before this change, the background used browser canvas and stored two data URLs in system settings; Information uploads were stored unchanged after PNG/JPEG/WebP magic-byte checks.
- The original ROOM rejection was caused by the browser-side canvas/MIME and combined 120-KiB data-URL gate. Uploads now bypass that gate and are verified/decoded and normalized by the server; multipart boundary tokens are case-sensitive even though the media-type comparison is not.
- Information artwork is localized; preserve independent English/Spanish uploads while generating normalized display assets.
- FFmpeg is locally available and can decode common raster formats, but support is limited to codecs built into the server's FFmpeg runtime.
