# Threat Model

## Scope and assumptions

The application is a single-process, LAN-first hotel workflow backed by SQLite. Room devices and staff browsers are semi-trusted clients. The LAN, host filesystem, administrator credentials, and deployment secrets require separate operational protection. This document covers the application boundary, not physical access control or MDM implementation.

## Assets

- Guest request contents and request history
- Device bearer tokens and administrator sessions
- Room, area, and service configuration
- Audit records and durable realtime events
- SQLite database, backups, and checksum sidecars
- Session and token peppers

## Trust boundaries

1. Browser clients to same-origin REST and Socket.IO endpoints.
2. Device bearer tokens to server-side token hashes.
3. Administrator sessions and CSRF tokens to privileged mutations.
4. Node process to SQLite and filesystem backups.
5. Server outbox to connected realtime clients.

## Primary threats and controls

| Threat | Control |
| --- | --- |
| Unauthenticated administrative mutation | Session authentication, CSRF validation, authorization checks, and no web first-admin route |
| Stolen device token | Hashed token storage, explicit revoke/rebind, immediate socket invalidation, one-time display policy |
| Replay or duplicate mutation | Operation-scoped idempotency keys, request hashes, bounded retention, mismatch rejection |
| Token leakage through idempotency storage | AES-256-GCM encryption of the rebind response secret; plaintext token is not stored in `response_json` |
| Cross-room or cross-area request visibility | Server-derived device scope and filtered request/replay queries |
| CSRF or origin abuse | Same-origin default, CSRF token, restrictive `APP_ORIGIN`, and security headers |
| Input injection or oversized payload | Shared Zod validation, maximum lengths, bounded JSON/socket payloads, safe error mapping |
| Lost realtime event | Transactional outbox, replay cursor, full-snapshot fallback, and no client-side authority |
| Backup tampering or corruption | SQLite integrity verification, SHA-256 sidecar, restore check, restricted backup storage |
| Credential/session revocation not taking effect | Connected device and administrator sockets are disconnected after revocation |
| Availability loss from SQLite contention | WAL, full synchronous mode, foreign keys, busy timeout, serialized mutations, and fault tests |
| Sensitive data in logs | Structured safe identifiers only; no passwords, raw tokens, cookies, or authorization headers |

## Residual risks

- A bearer token can be used until revocation if it is stolen.
- A compromised LAN host or administrator workstation can bypass application-level protections.
- Browser presence cannot prove screen visibility, power state, Wi-Fi persistence, or audible audio.
- SQLite is a single-host datastore; host failure requires backup recovery.
- TLS and external reverse-proxy hardening are deployment responsibilities.

## Verification focus

Run unit, integration, e2e, and fault-injection suites before release. At minimum exercise duplicate/out-of-order events, network loss, pending requests during restart, outbox publication failures, SQLite busy behavior, browser storage clearing, connected-token revocation, assignment changes, simultaneous accepts, and backup restoration.
