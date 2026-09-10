# Operations Runbook

## Daily checks

1. Open the admin dashboard and review `OFFLINE` and `STALE` devices.
2. Check the outbox backlog from the health endpoint.
3. Confirm the latest backup and checksum verification result.
4. Check for services without active areas, rooms without active services, and invalid assignments.
5. Confirm that the host has free disk space for the database and backups.

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

### Administrator session concern

Log out the affected session or revoke all sessions for the administrator. Connected administrator sockets are disconnected after revocation. If administrator access is unavailable, use the local credential-management procedure rather than creating a web first-admin route.

## Realtime incident

1. Check `GET /api/v1/system/health`.
2. Check the outbox backlog and recent database busy errors.
3. Verify that REST works independently of Socket.IO.
4. Restart the server gracefully if the process is unhealthy.
5. Confirm clients reconnect, replay when possible, or request a full snapshot.
6. If the event backlog remains stuck, preserve the database and backup before investigating or purging.

## Data handling rules

Never log or paste passwords, raw tokens, cookies, authorization headers, seed credentials, or unrestricted request payloads. Preserve request IDs, operation names, safe error codes, timestamps, and affected resource IDs for triage.
