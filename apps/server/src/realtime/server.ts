import type { Server as HttpServer, IncomingHttpHeaders } from 'node:http';
import { Server as SocketIOServer, type Namespace, type Socket } from 'socket.io';
import { z } from 'zod';
import {
  heartbeatSchema,
  type DevicePresence,
  type DurableRealtimeEvent,
  type RealtimeAuth,
  type ServerToClientEventMap,
  type TransportAck
} from '@hotel/shared';
import type { ServerConfig } from '../config/env';
import type { HotelService, OutboxRow, ReplayPlan, SecurityChange } from '../domain/hotel-service';
import { AppError, isAppError, validationError } from '../errors';
import type { Principal } from '../security/principal';

const ADMIN_SESSION_COOKIE = 'hotel_admin_session';
const MAX_SOCKET_PAYLOAD_BYTES = 64 * 1024;
const DEVICE_HEARTBEAT_LIMIT = 6;
const DEVICE_HEARTBEAT_WINDOW_MS = 60_000;
const MAX_HEARTBEAT_BUCKETS = 10_000;

const realtimeAuthSchema = z.object({
  deviceId: z.string().trim().min(1).max(128).optional(),
  deviceToken: z.string().min(1).max(512).optional(),
  clientInstanceId: z.string().trim().min(1).max(128),
  lastSeenEventSequence: z.number().int().nonnegative().optional(),
  deviceConfigVersion: z.number().int().positive().optional(),
  clientVersion: z.string().trim().min(1).max(64)
}).strict();

const syncSchema = z.object({
  lastSeenEventSequence: z.number().int().nonnegative().optional(),
  deviceConfigVersion: z.number().int().positive().optional()
}).strict();

const receivedEventSchema = z.object({ eventId: z.string().trim().min(1).max(128) }).strict();

interface SocketContext {
  principal: Principal;
  auth: RealtimeAuth;
}

interface SocketData {
  realtime?: SocketContext;
}

export interface RealtimeServer {
  publishPendingEvents(): void;
  runMaintenance(): void;
  close(): Promise<void>;
}

export function isAllowedRealtimeOrigin(origin: string | undefined, config: Pick<ServerConfig, 'nodeEnv' | 'appOrigin'>): boolean {
  if (origin === undefined || origin === config.appOrigin) return true;
  if (config.nodeEnv === 'production') return false;

  let configuredOrigin: URL;
  let requestOrigin: URL;
  try {
    configuredOrigin = new URL(config.appOrigin);
    requestOrigin = new URL(origin);
  } catch {
    return false;
  }

  return requestOrigin.protocol === 'http:'
    && requestOrigin.port === configuredOrigin.port
    && isPrivateIpv4(requestOrigin.hostname);
}

function isPrivateIpv4(hostname: string): boolean {
  const octets = hostname.split('.').map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
  const [first, second] = octets;
  if (first === undefined || second === undefined) return false;
  return first === 10
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168);
}

export function attachRealtime(httpServer: HttpServer, service: HotelService, config: ServerConfig): RealtimeServer {
  const io = new SocketIOServer(httpServer, {
    path: '/socket.io',
    maxHttpBufferSize: MAX_SOCKET_PAYLOAD_BYTES,
    cors: {
      origin: (requestOrigin, callback) => callback(null, isAllowedRealtimeOrigin(requestOrigin, config)),
      credentials: true
    },
    allowRequest: (request, callback) => {
      const requestOrigin = request.headers.origin;
      callback(null, requestOrigin === undefined || (typeof requestOrigin === 'string' && isAllowedRealtimeOrigin(requestOrigin, config)));
    }
  });
  const realtime = io.of('/realtime');
  const socketsByPrincipal = new Map<string, Set<Socket>>();
  const heartbeatRateLimiter = createHeartbeatRateLimiter();
  const publishPendingEvents = createPublisher(realtime, service, (deviceId) => {
    refreshDeviceSubscriptions(socketsByPrincipal, service, deviceId);
  });
  const runMaintenance = createMaintenanceRunner(realtime, service);
  const invalidatePrincipal = (change: SecurityChange): void => {
    const sockets = socketsByPrincipal.get(securityChangeKey(change));
    if (sockets === undefined) return;
    for (const socket of sockets) {
      socket.disconnect(true);
    }
  };
  service.setSecurityChangeHandler(invalidatePrincipal);

  realtime.use((socket, next) => {
    try {
      const auth = parseAuth(socket.handshake.auth);
      const principal = authenticateSocket(socket.handshake.headers, auth, service);
      assertDeviceIdentity(principal, auth);
      socket.data = { realtime: { principal, auth } } satisfies SocketData;
      next();
    } catch (error) {
      next(toSocketError(error));
    }
  });

  realtime.on('connection', (socket: Socket) => {
    const context = (socket.data as SocketData).realtime;
    if (context === undefined) {
      socket.disconnect(true);
      return;
    }
    const principalKey = keyForPrincipal(context.principal);
    registerSocket(socket, principalKey, socketsByPrincipal);
    joinDerivedRooms(socket, context.principal);
    sendInitialSync(socket, service.getReplayPlan(context.auth.lastSeenEventSequence, context.auth.deviceConfigVersion, context.principal));
    registerSocketHandlers(socket, service, heartbeatRateLimiter);
  });

  const interval = setInterval(publishPendingEvents, config.outboxPublishIntervalMs);
  interval.unref();
  const maintenanceInterval = setInterval(runMaintenance, config.pendingAlertIntervalMs);
  maintenanceInterval.unref();

  return {
    publishPendingEvents,
    runMaintenance,
    close: async () => {
      clearInterval(interval);
      clearInterval(maintenanceInterval);
      service.setSecurityChangeHandler(undefined);
      heartbeatRateLimiter.clear();
      await new Promise<void>((resolve) => io.close(() => resolve()));
      socketsByPrincipal.clear();
    }
  };
}

interface HeartbeatBucket {
  count: number;
  resetAt: number;
}

interface HeartbeatRateLimiter {
  consume(deviceId: string): boolean;
  clear(): void;
}

function createHeartbeatRateLimiter(): HeartbeatRateLimiter {
  const buckets = new Map<string, HeartbeatBucket>();

  return {
    consume: (deviceId) => {
      const now = Date.now();
      for (const [bucketKey, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(bucketKey);
      }

      const current = buckets.get(deviceId);
      if (current === undefined && buckets.size >= MAX_HEARTBEAT_BUCKETS) return false;
      const bucket = current ?? { count: 0, resetAt: now + DEVICE_HEARTBEAT_WINDOW_MS };
      if (bucket.count >= DEVICE_HEARTBEAT_LIMIT) return false;
      bucket.count += 1;
      buckets.set(deviceId, bucket);
      return true;
    },
    clear: () => buckets.clear()
  };
}

function createMaintenanceRunner(namespace: Namespace, service: HotelService): () => void {
  let previousPresence = new Map<string, DevicePresence>();

  return () => {
    try {
      service.purgeRetention();
      const currentPresence = new Map<string, DevicePresence>();
      for (const device of service.listDevices()) {
        currentPresence.set(device.id, device.presence);
        if (previousPresence.get(device.id) !== undefined && previousPresence.get(device.id) !== device.presence) {
          const payload = {
            deviceId: device.id,
            presence: device.presence,
            lastSeenAt: device.lastHeartbeatAt
          };
          namespace.to(`device:${device.id}`).emit('device.presence.changed', payload);
          namespace.to('admin').emit('device.presence.changed', payload);
        }
      }
      previousPresence = currentPresence;
    } catch {
      namespace.to('admin').emit('system.maintenance', {
        message: 'Realtime maintenance could not complete.',
        severity: 'WARNING'
      });
    }
  };
}

function registerSocket(socket: Socket, principalKey: string | undefined, socketsByPrincipal: Map<string, Set<Socket>>): void {
  if (principalKey === undefined) return;
  const sockets = socketsByPrincipal.get(principalKey) ?? new Set<Socket>();
  sockets.add(socket);
  socketsByPrincipal.set(principalKey, sockets);
  socket.once('disconnect', () => {
    sockets.delete(socket);
    if (sockets.size === 0) socketsByPrincipal.delete(principalKey);
  });
}

function keyForPrincipal(principal: Principal): string | undefined {
  if (principal.kind === 'ADMIN') return `ADMIN:${principal.adminId}`;
  if (principal.kind === 'DEVICE') return `DEVICE:${principal.deviceId}`;
  return undefined;
}

function securityChangeKey(change: SecurityChange): string {
  return `${change.kind}:${change.id}`;
}

function createPublisher(namespace: Namespace, service: HotelService, onDeviceConfigChanged: (deviceId: string) => void): () => void {
  let publishing = false;
  return () => {
    if (publishing) return;
    publishing = true;
    try {
      for (const row of service.getPendingOutbox(1000)) {
        try {
          const event = toDurableEvent(row);
          const deviceId = publishEvent(namespace, event);
          if (deviceId !== undefined) onDeviceConfigChanged(deviceId);
          service.markOutboxPublished(row.id);
        } catch (error) {
          service.markOutboxFailure(row.id, error instanceof Error ? error.message : 'Realtime publication failed.');
        }
      }
    } finally {
      publishing = false;
    }
  };
}

function publishEvent(namespace: Namespace, event: DurableRealtimeEvent<string, unknown>): string | undefined {
  const payload = asRecord(event.payload);
  switch (event.name) {
    case 'request.created':
    case 'request.updated': {
      const request = asRecord(payload['request']);
      emitTo(namespace, `room:${stringValue(request['roomId'])}`, event);
      emitTo(namespace, `area:${stringValue(request['responsibleAreaId'])}`, event);
      emitTo(namespace, 'admin', event);
      return undefined;
    }
    case 'device.config.changed': {
      const deviceId = stringValue(payload['deviceId']);
      emitTo(namespace, `device:${deviceId}`, event);
      emitTo(namespace, 'admin', event);
      return deviceId;
    }
    case 'device.token.rotation.required':
      emitTo(namespace, `device:${stringValue(payload['deviceId'])}`, event);
      emitTo(namespace, 'admin', event);
      return undefined;
    case 'service.catalog.changed':
      namespace.emit(event.name, event);
      return undefined;
    case 'room.updated': {
      const room = asRecord(payload['room']);
      emitTo(namespace, `room:${stringValue(room['id'])}`, event);
      namespace.to('area-devices').emit(event.name, event);
      emitTo(namespace, 'admin', event);
      return undefined;
    }
    case 'system.maintenance':
      namespace.emit(event.name, event);
      return undefined;
    default:
      throw new AppError('INTERNAL_ERROR', `Unsupported realtime event: ${event.name}`, 500);
  }
}

function emitTo(namespace: Namespace, room: string, event: DurableRealtimeEvent<string, unknown>): void {
  if (room.endsWith(':')) {
    throw new AppError('INTERNAL_ERROR', 'Realtime event target is missing.', 500);
  }
  namespace.to(room).emit(event.name, event);
}

function toDurableEvent(row: OutboxRow): DurableRealtimeEvent<string, unknown> {
  const payload: unknown = JSON.parse(row.payload_json) as unknown;
  const event: DurableRealtimeEvent<string, unknown> = {
    schemaVersion: 1,
    eventId: row.event_id,
    eventSequence: row.id,
    name: row.event_name,
    occurredAt: row.created_at,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    payload
  };
  if (row.aggregate_version !== null) {
    event.aggregateVersion = row.aggregate_version;
  }
  return event;
}

function parseAuth(value: unknown): RealtimeAuth {
  const result = realtimeAuthSchema.safeParse(value);
  if (!result.success) {
    throw validationError('Socket authentication payload failed validation.', result.error.flatten());
  }
  const auth: RealtimeAuth = {
    clientInstanceId: result.data.clientInstanceId,
    clientVersion: result.data.clientVersion
  };
  if (result.data.deviceId !== undefined) auth.deviceId = result.data.deviceId;
  if (result.data.deviceToken !== undefined) auth.deviceToken = result.data.deviceToken;
  if (result.data.lastSeenEventSequence !== undefined) auth.lastSeenEventSequence = result.data.lastSeenEventSequence;
  if (result.data.deviceConfigVersion !== undefined) auth.deviceConfigVersion = result.data.deviceConfigVersion;
  return auth;
}

function authenticateSocket(headers: IncomingHttpHeaders, auth: RealtimeAuth, service: HotelService): Principal {
  const cookie = readCookie(headers.cookie, ADMIN_SESSION_COOKIE);
  if (cookie !== undefined && auth.deviceToken !== undefined) {
    throw new AppError('AUTH_AMBIGUOUS_CREDENTIALS', 'Provide either an administrator cookie or a device token, not both.', 400);
  }
  if (cookie !== undefined) {
    if (auth.deviceId !== undefined) {
      throw new AppError('AUTH_AMBIGUOUS_CREDENTIALS', 'Administrator connections cannot include a device identity.', 400);
    }
    const principal = service.authenticateAdmin(cookie);
    if (principal.mustChangePassword === true) {
      throw new AppError('ADMIN_PASSWORD_CHANGE_REQUIRED', 'Change the initial administrator password before continuing.', 403);
    }
    return principal;
  }
  return service.authenticateDeviceToken(auth.deviceToken).principal;
}

function assertDeviceIdentity(principal: Principal, auth: RealtimeAuth): void {
  if (principal.kind === 'DEVICE') {
    if (auth.deviceId !== principal.deviceId) {
      throw new AppError('AUTH_INVALID', 'The device identity does not match the device token.', 401);
    }
    return;
  }
  if (auth.deviceId !== undefined || auth.deviceConfigVersion !== undefined) {
    throw new AppError('AUTH_INVALID', 'Device-only handshake fields are not valid for this principal.', 401);
  }
}

function readCookie(header: string | string[] | undefined, name: string): string | undefined {
  const value = Array.isArray(header) ? header.join(';') : header;
  if (value === undefined) return undefined;
  for (const part of value.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const raw = part.slice(separator + 1).trim();
    return raw.length === 0 ? undefined : decodeURIComponent(raw);
  }
  return undefined;
}

function joinDerivedRooms(socket: Socket, principal: Principal): void {
  if (principal.kind === 'ADMIN') {
    void socket.join('admin');
    return;
  }
  if (principal.kind !== 'DEVICE') return;
  void socket.join(`device:${principal.deviceId}`);
  if (principal.assignmentMode === 'ROOM' && principal.roomId !== null) {
    void socket.join(`room:${principal.roomId}`);
  }
  if (principal.assignmentMode === 'AREA' && principal.areaId !== null) {
    void socket.join('area-devices');
    void socket.join(`area:${principal.areaId}`);
  }
}

function refreshDeviceSubscriptions(socketsByPrincipal: Map<string, Set<Socket>>, service: HotelService, deviceId: string): void {
  const sockets = socketsByPrincipal.get(`DEVICE:${deviceId}`);
  if (sockets === undefined) return;
  try {
    const nextPrincipal = service.getDevicePrincipal(deviceId);
    for (const socket of sockets) {
      const context = (socket.data as SocketData).realtime;
      if (context?.principal.kind !== 'DEVICE') continue;
      leaveAssignmentRooms(socket, context.principal);
      context.principal = nextPrincipal;
      joinDerivedRooms(socket, nextPrincipal);
    }
  } catch {
    // The config event still reaches the device room; the client will recover with a snapshot.
  }
}

function leaveAssignmentRooms(socket: Socket, principal: Principal): void {
  if (principal.kind === 'DEVICE' && principal.assignmentMode === 'ROOM' && principal.roomId !== null) {
    void socket.leave(`room:${principal.roomId}`);
  }
  if (principal.kind === 'DEVICE' && principal.assignmentMode === 'AREA' && principal.areaId !== null) {
    void socket.leave('area-devices');
    void socket.leave(`area:${principal.areaId}`);
  }
}

function sendInitialSync(socket: Socket, plan: ReplayPlan): void {
  socket.emit('connection.ready', {
    serverTime: new Date().toISOString(),
    currentEventSequence: plan.currentEventSequence,
    sync: plan.sync
  } satisfies ServerToClientEventMap['connection.ready']);
  if (plan.sync === 'REPLAY_AVAILABLE') {
    if (!sendReplayEvents(socket, plan.events)) {
      socket.emit('sync.required', {
        reason: plan.reason ?? 'EVENT_GAP',
        currentEventSequence: plan.currentEventSequence
      } satisfies ServerToClientEventMap['sync.required']);
    }
  } else if (plan.sync === 'FULL_SNAPSHOT_REQUIRED') {
    socket.emit('sync.required', {
      reason: plan.reason ?? 'EVENT_GAP',
      currentEventSequence: plan.currentEventSequence
    } satisfies ServerToClientEventMap['sync.required']);
  }
}

function sendReplayEvents(socket: Socket, events: OutboxRow[]): boolean {
  for (const row of events) {
    try {
      socket.emit(row.event_name, toDurableEvent(row));
    } catch {
      return false;
    }
  }
  return true;
}

function registerSocketHandlers(socket: Socket, service: HotelService, heartbeatRateLimiter: HeartbeatRateLimiter): void {
  socket.on('connection.sync', (payload, acknowledgement) => {
    try {
      const context = requireContext(socket);
      const input = parseSync(payload);
      const plan = service.getReplayPlan(input.lastSeenEventSequence, input.deviceConfigVersion, context.principal);
      if (plan.sync === 'REPLAY_AVAILABLE') {
        if (!sendReplayEvents(socket, plan.events)) {
          socket.emit('sync.required', {
            reason: plan.reason ?? 'EVENT_GAP',
            ...(input.lastSeenEventSequence === undefined ? {} : { lastSeenEventSequence: input.lastSeenEventSequence }),
            currentEventSequence: plan.currentEventSequence
          } satisfies ServerToClientEventMap['sync.required']);
        }
      } else if (plan.sync === 'FULL_SNAPSHOT_REQUIRED') {
        socket.emit('sync.required', {
          reason: plan.reason ?? (input.deviceConfigVersion === undefined ? 'EVENT_GAP' : 'DEVICE_CONFIG_MISMATCH'),
          ...(input.lastSeenEventSequence === undefined ? {} : { lastSeenEventSequence: input.lastSeenEventSequence }),
          currentEventSequence: plan.currentEventSequence
        } satisfies ServerToClientEventMap['sync.required']);
      }
      acknowledgement?.({ ok: true, sync: plan.sync });
    } catch (error) {
      acknowledgement?.(toTransportAck(error));
    }
  });

  socket.on('device.heartbeat', (payload, acknowledgement) => {
    try {
      const context = requireContext(socket);
      if (context.principal.kind !== 'DEVICE') {
        throw new AppError('FORBIDDEN_ASSIGNMENT', 'Only devices can send heartbeats.', 403);
      }
      if (!heartbeatRateLimiter.consume(context.principal.deviceId)) {
        throw new AppError('RATE_LIMITED', 'Too many heartbeat events. Try again later.', 429);
      }
      const input = heartbeatSchema.parse(payload);
      service.recordHeartbeat(context.principal, {
        ...(input.clientVersion === undefined ? {} : { clientVersion: input.clientVersion }),
        ...(input.socketConnected === undefined ? {} : { socketConnected: input.socketConnected })
      }, socket.handshake.address, readHeader(socket.handshake.headers, 'user-agent'));
      acknowledgement?.({ ok: true });
    } catch (error) {
      acknowledgement?.(toTransportAck(error));
    }
  });

  socket.on('client.event.received', (payload, acknowledgement) => {
    try {
      const input = receivedEventSchema.parse(payload);
      acknowledgement?.({ ok: true, eventId: input.eventId });
    } catch (error) {
      acknowledgement?.(toTransportAck(error));
    }
  });
}

function parseSync(value: unknown): { lastSeenEventSequence?: number; deviceConfigVersion?: number } {
  const result = syncSchema.safeParse(value);
  if (!result.success) {
    throw validationError('Socket synchronization payload failed validation.', result.error.flatten());
  }
  const input: { lastSeenEventSequence?: number; deviceConfigVersion?: number } = {};
  if (result.data.lastSeenEventSequence !== undefined) input.lastSeenEventSequence = result.data.lastSeenEventSequence;
  if (result.data.deviceConfigVersion !== undefined) input.deviceConfigVersion = result.data.deviceConfigVersion;
  return input;
}

function requireContext(socket: Socket): SocketContext {
  const context = (socket.data as SocketData).realtime;
  if (context === undefined) {
    throw new AppError('AUTH_REQUIRED', 'Socket authentication is required.', 401);
  }
  return context;
}

function toTransportAck(error: unknown): TransportAck {
  return { ok: false, errorCode: isAppError(error) ? error.code : error instanceof z.ZodError ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR' };
}

function toSocketError(error: unknown): Error {
  const result = new Error(isAppError(error) ? error.message : 'Socket authentication failed.');
  if (isAppError(error)) {
    result.name = error.code;
  }
  return result;
}

function readHeader(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  if (Array.isArray(value)) return value[0];
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AppError('INTERNAL_ERROR', 'Realtime event payload is not an object.', 500);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new AppError('INTERNAL_ERROR', 'Realtime event payload is missing a target identifier.', 500);
  }
  return value;
}
