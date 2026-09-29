FROM node:22-bookworm-slim AS build

ENV COREPACK_HOME=/corepack
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.5 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @hotel/shared build \
    && pnpm --filter @hotel/server build \
    && pnpm --filter @hotel/web build

FROM node:22-bookworm-slim AS runtime

ENV COREPACK_HOME=/corepack \
    NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/app/data/hotel.sqlite \
    BACKUP_DIRECTORY=/app/data/backups \
    INFORMATION_IMAGE_DIRECTORY=/app/data/information-images

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.5 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --prod --frozen-lockfile

COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/packages/shared/dist ./packages/shared/dist

RUN groupadd --system hotel && useradd --system --gid hotel --home-dir /app --no-create-home hotel \
    && mkdir -p /app/data/backups /app/data/information-images \
    && chown -R hotel:hotel /app

USER hotel

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1/system/health').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1))"

CMD ["node", "apps/server/dist/main.js"]
