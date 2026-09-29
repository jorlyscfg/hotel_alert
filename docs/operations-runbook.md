# Operations Runbook

## Daily checks

1. Open the admin dashboard and review `OFFLINE` and `STALE` devices.
2. Check the outbox backlog from the health endpoint.
3. Confirm the latest backup and checksum verification result.
4. Check for services without active areas, rooms without active services, and invalid assignments.
5. Confirm that the host has free disk space for the database and backups.

## Notification receiver checks (when deployed)

The current browser/kiosk path remains valid while the native T3 adapters are unavailable. When a verified receiver adapter is deployed, add these checks without treating them as request mutations:

1. Confirm the platform service/application is running and reports `synchronized` rather than only “process started”.
2. Confirm the assigned area, last heartbeat, and last safe error code in the platform diagnostics.
3. Send one controlled request and verify the OS notification. A request restored from `activeRequests` after restart must not create a synthetic duplicate alert.
4. Exercise a reconnect or server restart and confirm replay/full-snapshot recovery.
5. If delivery fails, preserve the cursor and inspect the sink/storage error before restarting or rebinding the device.

The Windows Node.js service and native Android Compose application are future T3 targets, not current deployment claims. See [`notification-receiver.md`](notification-receiver.md) for their implementation and platform-verification gates.

## Start and health check

```bash
corepack pnpm start
curl --fail http://127.0.0.1:3000/api/v1/system/health
```

Do not mark the service healthy only because the process is listening. The response must report a readable database and applied migration state.

## Backup and restore verification

```bash
corepack pnpm backup
corepack pnpm restore:check -- --file data/backups/<backup.sqlite>
```

`restore:check` is non-destructive. It validates SQLite integrity, the checksum sidecar, and the migration version. A verified backup is not a restore; use a maintenance window and a separate recovery procedure before replacing the live database.

## Retention

```bash
corepack pnpm purge:retention
```

The durable realtime replay window retains at least 60 minutes and at least 100,000 events. Unpublished outbox events are never eligible for deletion. Idempotency retention is separate and defaults to 72 hours; the offline client queue defaults to 48 hours.

## Credential incidents

### Lost or exposed device token

1. Identify the device from its installation ID.
2. Revoke its token from the admin device-management screen.
3. Confirm the connected device is disconnected.
4. If the device is still trusted, use protected rebind and provision the replacement token.
5. Record the incident reason in the audit trail without recording the token itself.

For a platform receiver, also confirm that the replacement token is written only to the platform's protected store. Do not reset the durable event cursor as a substitute for token recovery.

### Administrator session concern

Log out the affected session or revoke all sessions for the administrator. Connected administrator sockets are disconnected after revocation. If administrator access is unavailable, use the local credential-management procedure rather than creating a web first-admin route.

## Realtime incident

1. Check `GET /api/v1/system/health`.
2. Check the outbox backlog and recent database busy errors.
3. Verify that REST works independently of Socket.IO.
4. Restart the server gracefully if the process is unhealthy.
5. Confirm clients reconnect, replay when possible, or request a full snapshot.
6. If the event backlog remains stuck, preserve the database and backup before investigating or purging.

For a receiver adapter, check the `synchronized` state, heartbeat, sink result, durable cursor write, and `client.event.received` receipt in that order. A transport receipt never means that the hotel request was accepted or completed.

## Receiver rollback

Receiver rollback is additive: stop or disable only the affected platform service/application and return operators to the existing web/kiosk path. Preserve the server, database, outbox, replay history, and durable cursor. Revoke and rebind the device only for a credential incident or an intentional replacement; do not delete receiver state as a routine rollback.

## Data handling rules

Never log or paste passwords, raw tokens, cookies, authorization headers, seed credentials, or unrestricted request payloads. Preserve request IDs, operation names, safe error codes, timestamps, and affected resource IDs for triage.
