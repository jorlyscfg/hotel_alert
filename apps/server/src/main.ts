import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import type { Application } from 'express';
import { loadConfig, type ServerConfig } from './config/env';
import { closeDatabase, openDatabase, runMigrations, type SqliteDatabase } from './db/connection';
import { HotelService } from './domain/hotel-service';
import { createApp } from './http/app';
import { attachRealtime, type RealtimeServer } from './realtime/server';

export interface ServerRuntime {
  app: Application;
  database: SqliteDatabase;
  httpServer: HttpServer;
  realtime: RealtimeServer;
  service: HotelService;
  close(): Promise<void>;
}

export function createServerRuntime(config: ServerConfig): ServerRuntime {
  const database = openDatabase(config);
  runMigrations(database);
  const hooks: { publishPendingEvents?: () => void } = {};
  const service = new HotelService(database, config, () => hooks.publishPendingEvents?.());
  const app = createApp(service, config);
  const httpServer = createHttpServer(app);
  const realtime = attachRealtime(httpServer, service, config);
  hooks.publishPendingEvents = realtime.publishPendingEvents;
  let closed = false;

  return {
    app,
    database,
    httpServer,
    realtime,
    service,
    close: async () => {
      if (closed) return;
      closed = true;
      await realtime?.close();
      await closeHttpServer(httpServer);
      closeDatabase(database);
    }
  };
}

function closeHttpServer(server: HttpServer): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close((error) => error === undefined ? resolve() : reject(error));
  });
}

function start(): void {
  const config = loadConfig();
  const runtime = createServerRuntime(config);
  const shutdown = (): void => {
    void runtime.close();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  runtime.httpServer.listen(config.port, config.host);
}

if (require.main === module) {
  start();
}
