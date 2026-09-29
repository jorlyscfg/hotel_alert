# Deployment Guide

## Supported deployment shape

Run one Node.js process on a trusted hotel-LAN host with the SQLite database and backup directory on durable local storage. Serve the web application and API from the same origin. This keeps browser credentials same-origin and avoids requiring CORS for the normal installation.

The application listens on `HOST` and `PORT` and serves Socket.IO at `/socket.io` with the `/realtime` namespace. Keep the HTTP and WebSocket routes reachable from every configured room tablet and staff workstation.

## Notification receiver boundary

The verified T2 TypeScript LAN runtime is an additive, read-only receiver boundary around the device snapshot and Socket.IO event stream. It is not a native Windows service or Android application, and its presence does not claim platform notification support. The Windows Node.js service and native Android Compose targets remain future T3 work; their contracts, secure-storage responsibilities, and verification gates are defined in [`notification-receiver.md`](notification-receiver.md).

When either future adapter is deployed, keep it on the trusted hotel LAN/VPN and point it at the same server origin. Do not expose the receiver or Socket.IO port to the public internet, and do not replace the existing web/kiosk deployment with an unverified native adapter.

## Prerequisites

- Node.js `>=20.18.0 <26`
- Corepack with pnpm `9.15.5`
- A writable application data directory
- A separate, access-controlled backup destination
- A process supervisor such as systemd, Docker, or an equivalent managed service
- A LAN address or DNS name reachable by kiosk devices

## Configuration

Start from `.env.example`. Production must provide:

```dotenv
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
APP_ORIGIN=http://hotel-alert.internal:3000
DATABASE_PATH=./data/hotel.sqlite
SESSION_SECRET=<random-secret>
TOKEN_PEPPER=<different-random-secret>
```

Use the documented heartbeat, replay, retention, and rate-limit bounds. `SESSION_SECRET` and `TOKEN_PEPPER` must not be reused, committed, or printed. Changing either invalidates the corresponding stored credentials and requires a controlled recovery plan.

## First LAN connection

Find the deployment host's private address before configuring tablets:

- Linux: `ip -br address`
- macOS: `ipconfig getifaddr en0` (use the active interface when it is not `en0`)
- Windows: `ipconfig`

For development, keep the API private to the host and expose the Vite development server to the LAN:

```dotenv
HOST=0.0.0.0
APP_ORIGIN=http://192.168.1.20:4173
VITE_SERVER_ORIGIN=http://127.0.0.1:3001
```

Run `corepack pnpm dev`, then open `http://192.168.1.20:4173` from a tablet or staff workstation. The Vite server proxies `/api` and `/socket.io` to the loopback API origin, so `APP_ORIGIN` must be the browser's origin (`4173`), not the proxy target (`3001`).

For a compiled production process, build the web application and use the server origin instead:

```dotenv
HOST=0.0.0.0
PORT=3000
APP_ORIGIN=http://192.168.1.20:3000
```

Then open `http://192.168.1.20:3000`. Replace `192.168.1.20` with the actual private address or an internal DNS name. Never use `localhost` in a tablet URL because it resolves to the tablet itself.

## Firewall and isolation

`HOST=0.0.0.0` listens on every host interface. Configure the host firewall to allow only the required TCP port from the trusted hotel-LAN subnet: `4173` and `3001` for development, or `3000` for the compiled server. Do not port-forward these ports to the public internet. If the host has multiple networks, restrict the firewall rule to the hotel-LAN interface/subnet.

Keep `APP_ORIGIN` as one exact browser origin, including scheme and port, because it is used for Socket.IO origin validation. The normal production shape is same-origin and does not need broad CORS. Create an administrator with `corepack pnpm admin:create`; there are no default credentials. Use independent production secrets, and never place `.env`, database files, backups, tokens, or generated credentials in source control.

From another LAN device, verify readiness with `http://<lan-address>:<port>/api/v1/system/health`. A failed connection usually means the process is not listening on the LAN address, the firewall is blocking the port, the browser URL does not match `APP_ORIGIN`, or the device is on a different network.

## Release procedure

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm test:faults
corepack pnpm build
corepack pnpm db:migrate
corepack pnpm start
```

Before restarting a live installation:

1. Create a verified backup with `corepack pnpm backup`.
2. Confirm the backup checksum and integrity result are successful.
3. Drain or announce the short interruption to staff.
4. Stop the old process gracefully and start the new compiled process.
5. Verify `GET /api/v1/system/health` and one authenticated admin request.
6. Confirm that a room device reconnects and that its status becomes `ONLINE` after a heartbeat.

## Network and reverse proxy

The built-in server is HTTP. If the application is exposed outside the trusted LAN, terminate TLS at a reverse proxy and forward both `/api` and `/socket.io` (including WebSocket upgrades). Set `APP_ORIGIN` to the exact browser origin, including scheme and port. Do not enable broad CORS as a substitute for correct origin configuration.

## Storage and backups

- Keep `DATABASE_PATH` on durable storage with restricted permissions.
- Keep backups outside the live database directory when possible.
- Run `corepack pnpm backup` on a schedule appropriate to request volume.
- Run `corepack pnpm restore:check -- --file <backup.sqlite>` before using a backup for recovery.
- Keep the checksum sidecar with each backup.
- Run `corepack pnpm purge:retention` after confirming backup health and according to the operations schedule.

## Health and shutdown

The health endpoint reports process readiness, database readability, migration state, and the unpublished outbox backlog. A non-ready database or migration state is a deployment blocker. Use SIGINT or SIGTERM for shutdown so HTTP, Socket.IO, and SQLite resources can close cleanly.

The browser cannot guarantee Android screen-on, Wi-Fi persistence, auto-start, or watchdog recovery. Those controls belong to the kiosk/MDM deployment described in [`android-kiosk.md`](android-kiosk.md). A managed browser is not equivalent to native background notification delivery; see [`notification-receiver.md`](notification-receiver.md) before deploying a future platform adapter.
