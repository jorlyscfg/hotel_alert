# Hotel Local App

Hotel Local App is a LAN-first request and alert workflow for hotel rooms and service teams. Guests submit requests from a room device, staff work from an area queue, and administrators manage the catalog, assignments, credentials, and operational settings.

## Stack

- Node.js 20.18–25 and pnpm 9.15.5 through Corepack
- TypeScript, Express, React, Vite, Socket.IO
- SQLite with `better-sqlite3`, WAL mode, foreign keys, and a 5-second busy timeout
- Shared domain types and Zod validation in `packages/shared`

## Quick start

```bash
corepack pnpm install
cp .env.example .env
corepack pnpm db:migrate
# Fresh databases start with admin / admin; choose a new password at first Admin login.
corepack pnpm dev
```

Open `http://localhost:4173`. During development, Vite serves the web application on port `4173` and proxies API and Socket.IO traffic to the server on port `3001`. The compiled server serves the web application in production and exposes the API below `/api/v1`.

### Open the development app from another LAN device

1. Find the host computer's private LAN address. On Linux, use `ip -br address`; on macOS, use `ipconfig getifaddr en0`; on Windows, use `ipconfig`.
2. Set the browser origin in `.env` to that address while keeping the development proxy on loopback:

   ```dotenv
   HOST=0.0.0.0
   APP_ORIGIN=http://192.168.1.20:4173
   VITE_SERVER_ORIGIN=http://127.0.0.1:3001
   ```

3. Start the app with `corepack pnpm dev` and open `http://192.168.1.20:4173` on the tablet or workstation. Replace the example address with the address found in step 1.
4. Allow TCP `4173` and `3001` from the trusted hotel-LAN subnet in the host firewall. Do not forward either port from the internet.

Do not use `localhost` on a tablet: it refers to the tablet itself. `APP_ORIGIN` must match the address and port in the browser URL exactly because it is also used for Socket.IO origin validation.

For local demonstrations only:

```bash
SEED_DEMO=true corepack pnpm db:seed
```

Demo seeding is rejected in production and writes newly generated credentials to `data/seed-credentials.json` with restrictive permissions. Never use seeded credentials in a real hotel deployment.

## Production start

1. Install the pinned dependencies with Corepack.
2. Set `NODE_ENV=production`, `PORT`, `APP_ORIGIN`, `SESSION_SECRET`, and `TOKEN_PEPPER` to the deployment values and independently generated secrets.
3. Set `DATABASE_PATH` and `BACKUP_DIRECTORY` to durable, access-controlled locations.
4. Run `corepack pnpm build`.
5. Run `corepack pnpm db:migrate` and start with `corepack pnpm start`.
6. Verify `GET /api/v1/system/health` before accepting device traffic.

For a production LAN installation, use `HOST=0.0.0.0`, set `APP_ORIGIN` to the exact production browser origin such as `http://192.168.1.20:3000`, and allow only TCP `3000` from the trusted LAN. Keep the server on an isolated/private network, do not expose it through port forwarding, and use a reverse proxy with TLS before allowing access from an untrusted network.

### Docker Compose

The repository includes a single-service production image. It runs migrations on startup and stores SQLite, backups, and information images in the named `hotel-data` volume.

```bash
cp .env.example .env
# Set NODE_ENV=production, APP_ORIGIN, SESSION_SECRET, and TOKEN_PEPPER in .env.
docker compose up -d --build
docker compose ps
curl http://localhost:3000/api/v1/system/health
```

Set `APP_ORIGIN` to the exact browser origin used by room devices. Override the host port with `HOTEL_APP_PORT` when port `3000` is already occupied. Do not mount the repository's `data/` directory over `/app/data` unless its permissions and backup policy are controlled; never commit `.env` or SQLite files.

### FreeKiosk REST control

The optional backend control route uses the device's most recent private LAN heartbeat address to call FreeKiosk's `POST /api/audio/beep` endpoint. Configure it only when FreeKiosk REST is enabled on the kiosk:

```dotenv
FREEKIOSK_API_PORT=8080
FREEKIOSK_API_KEY=replace-with-the-kiosk-api-key
FREEKIOSK_API_TIMEOUT_MS=3000
```

The API key is required outside test mode. FreeKiosk REST and the Hotel Local App must remain on a private LAN or VPN; do not publish either service to the internet.

Production deployment and recovery procedures are in [`docs/deployment.md`](docs/deployment.md) and [`docs/operations-runbook.md`](docs/operations-runbook.md).

## Useful commands

| Command | Purpose |
| --- | --- |
| `corepack pnpm dev` | Run the web and server development processes |
| `corepack pnpm --filter @hotel/web dev` | Run only the Vite development server |
| `corepack pnpm --filter @hotel/server dev` | Run only the API and realtime development server |
| `corepack pnpm build` | Build shared types, server JavaScript, and the web bundle |
| `corepack pnpm start` | Start the compiled server |
| `corepack pnpm db:migrate` | Apply local schema and starter-catalog migrations |
| `corepack pnpm admin:create` | Create an administrator locally or from environment input |
| `corepack pnpm backup` | Create and integrity-check a SQLite backup |
| `corepack pnpm restore:check -- --file <backup.sqlite>` | Verify a backup before restore planning |
| `corepack pnpm purge:retention` | Purge eligible durable events |
| `corepack pnpm test` | Run unit and integration tests |
| `corepack pnpm test:faults` | Run fault-injection tests |
| `corepack pnpm test:e2e` | Run Playwright tests |
| `corepack pnpm lint` | Run ESLint |
| `corepack pnpm typecheck` | Type-check all workspace packages |

## Runtime model

- REST mutations are authoritative and transactional.
- Socket.IO under `/realtime` distributes committed outbox events and ephemeral presence changes.
- Realtime clients replay durable events when their cursor is inside the configured 60-minute and 100,000-event minimum floors; otherwise they receive a full-snapshot request.
- Device and administrator sockets are disconnected after their credentials or sessions are revoked.
- Device tokens are displayed only at issuance or rebind time. Raw tokens, cookies, passwords, and authorization headers must not be logged or committed.

## Repository safety

Do not commit `.env`, SQLite files, backups, `data/seed-credentials.json`, raw device tokens, or administrator credentials. Review [`docs/threat-model.md`](docs/threat-model.md) before exposing the application beyond the trusted hotel LAN.
