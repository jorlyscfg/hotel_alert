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
- Information artwork is shared across the selected device languages: each new upload or repair accepts one source image, from which the server produces a square and a horizontal variant. The source may contain embedded text, which will be shared unchanged across languages.
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
2. Information uploads/repairs accept one source image and the server creates one square and one horizontal variant using a centered cover crop that fills the target dimensions.
3. The same Information image variants are served for every app language, while the device still selects square versus horizontal by viewport.
4. Invalid/corrupt, unsupported, oversized, and excessive-pixel images fail safely without partial persistence or leaking decoder details.
5. Existing authorization, CSRF/rate-limit/idempotency behavior, ordering, language fallback for legacy data, and clear/delete behavior remain intact.
6. Focused tests, typecheck, and diff checks pass; existing unrelated dirty work remains untouched.

## Tasks
- [x] IMG-01 — Add bounded server-side image decode/normalization with focused tests and runtime documentation. Implementation and checks complete; committed as `988d265`.
- [x] IMG-02 — Move background upload transformation from browser to the server while preserving the current setting/display contract; add API/UI tests. Complete; included in work-unit commit `f073d67`.
- [x] IMG-03 — Normalize Information module upload/repair images on the server and broaden the file picker; add API/service/UI regression tests. Complete; included in work-unit commit `f073d67`.
- [x] IMG-04 — Replace Information image uploads/repairs with a single shared source image; generate centered square and horizontal cover-cropped variants server-side and serve them regardless of device language. Complete; committed as `1b3e9e2`.

## Progress and Evidence
- Exploration: complete. CodeGraph mapping and a read-only explorer traced both upload flows. FFmpeg 8.0.1-3ubuntu2 is installed locally; no Sharp/Jimp/canvas processing package is declared or installed.
- Source changes: IMG-01 added `apps/server/src/images/image-processor.ts`, `tests/unit/image-processor.test.ts`, and `docs/server-image-processing.md`.
- Source changes: IMG-02 added a multipart ROOM background endpoint and bounded WebP normalizer; the settings UI now previews the selected file locally and submits the original image to the server, with no browser-side MIME/120-KiB gate. The parser preserves case-sensitive multipart boundaries while matching media types case-insensitively.
- Source changes: IMG-03 normalizes all Information image uploads and repair variants to WebP before persistence, preserves localized variant metadata/idempotency, and accepts `image/*` in the picker. Invalid batches are rejected before any files are persisted.
- Source changes: IMG-04 accepts one multipart source for each new or repaired Information slide, generates centered cover-cropped shared WebP assets at 480×480 and 1280×720, and serves the same artwork to English and Spanish devices. Repair replaces legacy localized files transactionally; users never need to supply prebuilt variants.
- Verification: IMG-01 focused Vitest 12/12, workspace typecheck, and tracked/untracked whitespace checks passed.
- Verification: After IMG-02 and IMG-03, focused integration/unit coverage passed (11 files, 196 tests); `corepack pnpm typecheck` and image-scoped `git diff --check` passed. The supplied `fondo.jpg` also normalized successfully to both expected WebP background variants within the existing setting cap.
- Verification: After IMG-04, focused Vitest passed (8 files, 182 tests), `corepack pnpm typecheck` passed, and the scoped source/index whitespace checks passed. Coverage includes shared-language equality, exact output dimensions, atomic conversion of legacy localized artwork, and rejection of multiple source files without partial writes.
- Unrelated check: `tests/unit/admin-localization.test.ts` has 23/24 passing; its city-search test expects weather coordinate inputs while availability is still `checking`. This belongs to the existing time-zone/location work, not image uploads, so it was left unchanged.
- Work-unit commits: IMG-01 `988d265`; IMG-02 and IMG-03 `f073d67` (`feat(server): normalize uploaded images`), on `jorlys/feat/lan-notification-agent`. The ~400-line budget was crossed; the user rejected branch chains and authorized continuing here. Keep unrelated staged/unstaged work untouched.
- Work-unit commit: IMG-04 `1b3e9e2` (`feat(images): share information image variants`), scoped via an isolated index to exclude unrelated dirty hunks. Actual diff: 349 insertions and 281 deletions; proceed under the existing `exception-ok` delivery strategy, with unrelated staged/unstaged changes preserved.
- Review assessment: disabled by clone-local user preference; report `disabled/unmanaged`.
- Accepted user correction: one image source is shared by English/Spanish devices; generate a square for compact screens and a horizontal variant for tablets. Use a centered crop and scale-to-cover so each generated asset fully fills its target dimensions.
- IMG-04 actual authored change count: 630 lines (349 additions + 281 deletions). Route: delegated direct implementation; trigger evidence: UI, API, normalizer, persistence/content selection, and multiple tests are non-trivial files. Continue on `jorlys/feat/lan-notification-agent` and preserve all unrelated staged/unstaged changes.

## Next Step
Image-upload work is complete. The user runs the local `corepack pnpm dev` server; do not deploy or restart it on their behalf. Track the unrelated city-search localization test separately if requested.

## Key Learnings
- Before this change, the background used browser canvas and stored two data URLs in system settings; Information uploads were stored unchanged after PNG/JPEG/WebP magic-byte checks.
- The original ROOM rejection was caused by the browser-side canvas/MIME and combined 120-KiB data-URL gate. Uploads now bypass that gate and are verified/decoded and normalized by the server; multipart boundary tokens are case-sensitive even though the media-type comparison is not.
- Information image sources are shared across locales by user decision; only geometry variants differ. Center-cropped cover variants preserve aspect ratio and fully cover their target canvas. Legacy locale-specific records continue to be served until the client repairs that slide with one new shared source.
- FFmpeg is locally available and can decode common raster formats, but support is limited to codecs built into the server's FFmpeg runtime.
