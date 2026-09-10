import fs from 'node:fs';
import path from 'node:path';
import express, { Router, type Application, type ErrorRequestHandler, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { z } from 'zod';
import {
  adminCreateSchema,
  adminLoginSchema,
  adminPatchSchema,
  areaCreateSchema,
  areaPatchSchema,
  deviceAssignmentSchema,
  deviceCreateSchema,
  devicePatchSchema,
  deviceRebindSchema,
  heartbeatSchema,
  requestCreateSchema,
  requestStatusSchema,
  requestTransitionSchema,
  rotationClaimSchema,
  roomCreateSchema,
  roomDoNotDisturbSchema,
  roomPatchSchema,
  serviceCreateSchema,
  servicePatchSchema,
  settingsPatchSchema,
  tokenRotationSchema,
  type PageResult,
  type RequestStatus
} from '@hotel/shared';
import type { ServerConfig } from '../config/env';
import type { HotelService, RequestFilters } from '../domain/hotel-service';
import { AppError, isAppError, validationError } from '../errors';
import { actorForPrincipal, type AdminPrincipal, type Principal } from '../security/principal';
import { createRateLimiter, principalKey, sourceIpKey } from './rate-limit';

const ADMIN_SESSION_COOKIE = 'hotel_admin_session';
const JSON_BODY_LIMIT = '256kb';

declare global {
  // Express request context is populated by the first middleware.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      principal?: Principal;
    }
  }
}

export function createApp(service: HotelService, config: ServerConfig): Application {
  const app = express();
  const api = Router();
  const admin = requireAdmin(service);
  const device = requireDevice(service);
  const anyPrincipal = requireAnyPrincipal(service);
  const loginRateLimit = createRateLimiter({ name: 'admin-login', limit: 5, windowMs: 60_000, key: sourceIpKey });
  const bootstrapStateRateLimit = createRateLimiter({ name: 'bootstrap-state', limit: 30, windowMs: 60_000, key: sourceIpKey });
  const principalMutationRateLimit = createRateLimiter({ name: 'authenticated-mutation', limit: 120, windowMs: 60_000, key: principalKey });
  const adminOperationRateLimit = createRateLimiter({ name: 'admin-operation', limit: 10, windowMs: 60_000, key: principalKey });
  const heartbeatRateLimit = createRateLimiter({ name: 'device-heartbeat', limit: 6, windowMs: 60_000, key: principalKey });
  const adminMutation = [admin, requireAdminCsrf(service), principalMutationRateLimit];
  const adminSensitiveMutation = [admin, requireAdminCsrf(service), adminOperationRateLimit];
  const requestMutation = [anyPrincipal, requireAdminCsrfIfNeeded(service), principalMutationRateLimit];

  app.disable('x-powered-by');
  app.use(requestContext);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cookieParser());
  app.use(express.json({ limit: JSON_BODY_LIMIT, strict: true }));

  api.post('/auth/admin/login', loginRateLimit, asyncHandler(async (req, res) => {
    const input = parseBody(adminLoginSchema, req.body);
    const result = service.loginAdmin(input.username, input.password, req.requestId, req.ip, req.get('user-agent'));
    res.cookie(ADMIN_SESSION_COOKIE, result.sessionToken, {
      httpOnly: true,
      sameSite: 'strict',
      secure: isSecureOrigin(config.appOrigin),
      maxAge: config.adminSessionTtlMinutes * 60 * 1000,
      path: '/'
    });
    sendData(res, 200, result.data, req.requestId);
  }));

  api.get('/auth/admin/me', admin, asyncHandler(async (req, res) => {
    const principal = getAdminPrincipal(req);
    sendData(res, 200, { id: principal.adminId, username: principal.username, expiresAt: getSessionExpiry(service, principal) }, req.requestId);
  }));

  api.post('/auth/admin/logout', adminMutation, asyncHandler(async (req, res) => {
    service.logoutAdmin(getAdminPrincipal(req), req.requestId);
    res.clearCookie(ADMIN_SESSION_COOKIE, { httpOnly: true, sameSite: 'strict', secure: isSecureOrigin(config.appOrigin), path: '/' });
    res.status(204).send();
  }));

  api.post('/auth/admin/logout-all', adminMutation, asyncHandler(async (req, res) => {
    service.logoutAllAdminSessions(getAdminPrincipal(req), req.requestId);
    res.clearCookie(ADMIN_SESSION_COOKIE, { httpOnly: true, sameSite: 'strict', secure: isSecureOrigin(config.appOrigin), path: '/' });
    res.status(204).send();
  }));

  api.post('/auth/admin/change-password', adminMutation, asyncHandler(async (req, res) => {
    requireMutationKey(req);
    const input = parseBody(passwordChangeSchema, req.body);
    const principal = getAdminPrincipal(req);
    const data = service.changeAdminPassword(principal, principal.adminId, input.currentPassword, input.newPassword, req.requestId);
    res.clearCookie(ADMIN_SESSION_COOKIE, { httpOnly: true, sameSite: 'strict', secure: isSecureOrigin(config.appOrigin), path: '/' });
    sendData(res, 200, data, req.requestId);
  }));

  api.get('/devices/bootstrap-state', bootstrapStateRateLimit, asyncHandler(async (req, res) => {
    const installationId = parseRequiredQuery(req.query['installationId'], 'installationId', 128);
    sendData(res, 200, service.getBootstrapState(installationId), req.requestId);
  }));

  const bootstrapDevice = asyncHandler(async (req, res) => {
    requireMutationKey(req);
    const principal = getAdminPrincipal(req);
    const input = parseBody(deviceCreateSchema, req.body);
    const data = service.bootstrapDevice(input, actorForPrincipal(principal), req.requestId);
    sendData(res, 201, data, req.requestId, { configurationRevision: data.configurationRevision });
  });
  api.post('/devices/bootstrap', adminSensitiveMutation, bootstrapDevice);
  api.post('/devices', adminSensitiveMutation, bootstrapDevice);

  api.get('/device/session', device, asyncHandler(async (req, res) => {
    sendData(res, 200, service.getDeviceSnapshot(getDevicePrincipal(req)), req.requestId);
  }));

  api.post('/device/heartbeat', [device, heartbeatRateLimit], asyncHandler(async (req, res) => {
    const input = parseBody(heartbeatSchema, req.body);
    service.recordHeartbeat(getDevicePrincipal(req), {
      ...(input.clientVersion === undefined ? {} : { clientVersion: input.clientVersion }),
      ...(input.socketConnected === undefined ? {} : { socketConnected: input.socketConnected })
    }, req.ip, req.get('user-agent'));
    sendData(res, 200, { ok: true }, req.requestId);
  }));

  api.post('/device/token-rotation/claim', device, asyncHandler(async (req, res) => {
    const input = parseBody(rotationClaimSchema, req.body);
    const data = service.claimTokenRotation(getDevicePrincipal(req), input.rotationId);
    sendData(res, 200, data, req.requestId);
  }));

  api.post('/device/token-rotation/acknowledge', asyncHandler(async (req, res) => {
    const principal = service.authenticateRotationToken(readBearerToken(req));
    const input = parseBody(rotationClaimSchema, req.body);
    service.acknowledgeTokenRotation(principal, input.rotationId, req.requestId);
    sendData(res, 200, { rotationId: input.rotationId, acknowledged: true }, req.requestId);
  }));

  api.post('/device/rebind', adminSensitiveMutation, asyncHandler(async (req, res) => {
    const idempotencyKey = requireMutationKey(req);
    const result = service.rebindDevice(getAdminPrincipal(req), parseBody(deviceRebindSchema, req.body), idempotencyKey, req.requestId);
    sendData(res, 200, result.data, req.requestId, { configurationRevision: result.data.configurationRevision, idempotentReplay: result.idempotentReplay });
  }));

  api.get('/room/me/services', device, asyncHandler(async (req, res) => {
    sendList(res, service.getRoomServices(getDevicePrincipal(req)), req.requestId);
  }));

  api.patch('/room/me/do-not-disturb', [device, principalMutationRateLimit], asyncHandler(async (req, res) => {
    const result = service.setRoomDoNotDisturb(getDevicePrincipal(req), parseBody(roomDoNotDisturbSchema, req.body).doNotDisturb, requireMutationKey(req), req.requestId);
    sendData(res, 200, result.data, req.requestId, { configurationRevision: service.getConfigurationRevision(), idempotentReplay: result.idempotentReplay });
  }));

  api.get('/room/me/requests', device, asyncHandler(async (req, res) => {
    sendPage(res, service.listRoomRequestsPage(getDevicePrincipal(req), parseRequestFilters(req)), req.requestId);
  }));

  api.get('/area/me/requests', device, asyncHandler(async (req, res) => {
    sendPage(res, service.listAreaRequestsPage(getDevicePrincipal(req), parseRequestFilters(req)), req.requestId);
  }));

  api.post('/requests', device, asyncHandler(async (req, res) => {
    const input = parseBody(requestCreateSchema, req.body);
    const result = service.createRequest(getDevicePrincipal(req), input.serviceId, requireMutationKey(req), req.requestId);
    sendData(res, 201, result.data, req.requestId, { idempotentReplay: result.idempotentReplay });
  }));

  api.get('/requests/:requestId', anyPrincipal, asyncHandler(async (req, res) => {
    sendData(res, 200, service.getAuthorizedRequest(getPrincipal(req), routeParam(req.params['requestId'], 'requestId')), req.requestId);
  }));

  api.get('/requests', admin, asyncHandler(async (req, res) => {
    sendPage(res, service.listRequestsPage({ ...parseRequestFilters(req), includeCreator: true }), req.requestId);
  }));

  api.get('/requests/:requestId/history', admin, asyncHandler(async (req, res) => {
    sendList(res, service.getRequestHistory(getPrincipal(req), routeParam(req.params['requestId'], 'requestId')), req.requestId);
  }));

  for (const transition of [
    { path: '/requests/:requestId/accept', status: 'ACCEPTED' as const },
    { path: '/requests/:requestId/start', status: 'IN_PROGRESS' as const },
    { path: '/requests/:requestId/complete', status: 'COMPLETED' as const }
  ]) {
    api.post(transition.path, requestMutation, asyncHandler(async (req, res) => {
      const input = parseBody(requestTransitionSchema, req.body);
      const result = service.transitionRequest(getPrincipal(req), routeParam(req.params['requestId'], 'requestId'), transition.status, input.expectedVersion, requireMutationKey(req), req.requestId);
      sendData(res, 200, result.data, req.requestId, { idempotentReplay: result.idempotentReplay });
    }));
  }

  api.get('/rooms', admin, asyncHandler(async (req, res) => {
    sendList(res, service.listRooms(), req.requestId);
  }));
  api.get('/rooms/:id', admin, asyncHandler(async (req, res) => {
    sendResource(res, service.getRoom(routeParam(req.params['id'], 'id')), req.requestId, 'Room');
  }));
  api.post('/rooms', adminMutation, asyncHandler(async (req, res) => {
    requireMutationKey(req);
    const data = service.createRoom(parseBody(roomCreateSchema, req.body), actorForPrincipal(getAdminPrincipal(req)), req.requestId);
    sendData(res, 201, data, req.requestId, { configurationRevision: service.getConfigurationRevision() });
  }));
  api.patch('/rooms/:id', adminMutation, asyncHandler(async (req, res) => {
    requireMutationKey(req);
    const data = service.patchRoom(routeParam(req.params['id'], 'id'), parseBody(roomPatchSchema, req.body), actorForPrincipal(getAdminPrincipal(req)), req.requestId);
    sendData(res, 200, data, req.requestId, { configurationRevision: service.getConfigurationRevision() });
  }));
  registerToggleRoutes(api, '/rooms/:id', adminMutation, (req, active) => service.patchRoom(routeParam(req.params['id'], 'id'), { active }, actorForPrincipal(getAdminPrincipal(req)), req.requestId), service, true);

  api.get('/areas', admin, asyncHandler(async (req, res) => {
    sendList(res, service.listAreas(), req.requestId);
  }));
  api.get('/areas/:id', admin, asyncHandler(async (req, res) => {
    sendResource(res, service.getArea(routeParam(req.params['id'], 'id')), req.requestId, 'Area');
  }));
  api.post('/areas', adminMutation, asyncHandler(async (req, res) => {
    requireMutationKey(req);
    const data = service.createArea(parseBody(areaCreateSchema, req.body), actorForPrincipal(getAdminPrincipal(req)), req.requestId);
    sendData(res, 201, data, req.requestId, { configurationRevision: service.getConfigurationRevision() });
  }));
  api.patch('/areas/:id', adminMutation, asyncHandler(async (req, res) => {
    requireMutationKey(req);
    const data = service.patchArea(routeParam(req.params['id'], 'id'), parseBody(areaPatchSchema, req.body), actorForPrincipal(getAdminPrincipal(req)), req.requestId);
    sendData(res, 200, data, req.requestId, { configurationRevision: service.getConfigurationRevision() });
  }));
  registerToggleRoutes(api, '/areas/:id', adminMutation, (req, active) => service.patchArea(routeParam(req.params['id'], 'id'), { active }, actorForPrincipal(getAdminPrincipal(req)), req.requestId), service, true);

  api.get('/services', admin, asyncHandler(async (req, res) => {
    const activeOnly = parseBooleanQuery(req.query['activeOnly']);
    const areaId = optionalQuery(req.query['areaId'], 128);
    sendList(res, service.listServices(activeOnly, areaId), req.requestId);
  }));
  api.get('/services/:id', admin, asyncHandler(async (req, res) => {
    sendResource(res, service.getService(routeParam(req.params['id'], 'id')), req.requestId, 'Service');
  }));
  api.post('/services', adminMutation, asyncHandler(async (req, res) => {
    requireMutationKey(req);
    const data = service.createService(parseBody(serviceCreateSchema, req.body), actorForPrincipal(getAdminPrincipal(req)), req.requestId);
    sendData(res, 201, data, req.requestId, { configurationRevision: service.getConfigurationRevision() });
  }));
  api.patch('/services/:id', adminMutation, asyncHandler(async (req, res) => {
    requireMutationKey(req);
    const data = service.patchService(routeParam(req.params['id'], 'id'), parseBody(servicePatchSchema, req.body), actorForPrincipal(getAdminPrincipal(req)), req.requestId);
    sendData(res, 200, data, req.requestId, { configurationRevision: service.getConfigurationRevision() });
  }));
  registerToggleRoutes(api, '/services/:id', adminMutation, (req, active) => service.patchService(routeParam(req.params['id'], 'id'), { active }, actorForPrincipal(getAdminPrincipal(req)), req.requestId), service, true);

  api.get('/devices', admin, asyncHandler(async (req, res) => {
    sendList(res, service.listDevices(), req.requestId);
  }));
  api.get('/devices/:id', admin, asyncHandler(async (req, res) => {
    sendResource(res, service.getDevice(routeParam(req.params['id'], 'id')), req.requestId, 'Device');
  }));
  api.patch('/devices/:id', adminMutation, asyncHandler(async (req, res) => {
    requireMutationKey(req);
    const data = service.patchDevice(getAdminPrincipal(req), routeParam(req.params['id'], 'id'), parseBody(devicePatchSchema, req.body), req.requestId);
    sendData(res, 200, data, req.requestId, { configurationRevision: service.getConfigurationRevision() });
  }));
  registerToggleRoutes(api, '/devices/:id', adminMutation, (req, active) => service.patchDevice(getAdminPrincipal(req), routeParam(req.params['id'], 'id'), { active }, req.requestId), service, true);
  api.post('/devices/:id/retire', adminSensitiveMutation, asyncHandler(async (req, res) => {
    const result = service.retireDevice(getAdminPrincipal(req), routeParam(req.params['id'], 'id'), requireMutationKey(req), req.requestId);
    sendData(res, 200, result.data, req.requestId, { configurationRevision: result.configurationRevision, idempotentReplay: result.idempotentReplay });
  }));
  api.post('/devices/:id/assignment', adminMutation, asyncHandler(async (req, res) => {
    requireMutationKey(req);
    const data = service.assignDevice(getAdminPrincipal(req), routeParam(req.params['id'], 'id'), parseBody(deviceAssignmentSchema, req.body), req.requestId);
    sendData(res, 200, data.device, req.requestId, { configurationRevision: data.configurationRevision });
  }));
  api.post('/devices/:id/token-rotation', adminSensitiveMutation, asyncHandler(async (req, res) => {
    requireMutationKey(req);
    const input = parseBody(tokenRotationSchema, req.body);
    const data = service.startTokenRotation(getAdminPrincipal(req), routeParam(req.params['id'], 'id'), input.gracePeriodMinutes ?? 30, input.reason, req.requestId);
    sendData(res, 202, data, req.requestId, { configurationRevision: service.getConfigurationRevision() });
  }));
  api.post('/devices/:id/revoke-token', adminSensitiveMutation, asyncHandler(async (req, res) => {
    requireMutationKey(req);
    service.revokeDeviceToken(getAdminPrincipal(req), routeParam(req.params['id'], 'id'), req.requestId);
    sendData(res, 200, { revoked: true }, req.requestId, { configurationRevision: service.getConfigurationRevision() });
  }));

  api.get('/admins', admin, asyncHandler(async (req, res) => {
    sendList(res, service.listAdmins(), req.requestId);
  }));
  api.get('/admins/:id', admin, asyncHandler(async (req, res) => {
    sendResource(res, service.getAdmin(routeParam(req.params['id'], 'id')), req.requestId, 'Administrator');
  }));
  api.post('/admins', adminMutation, asyncHandler(async (req, res) => {
    requireMutationKey(req);
    const data = service.createAdmin(parseBody(adminCreateSchema, req.body), actorForPrincipal(getAdminPrincipal(req)), req.requestId);
    sendData(res, 201, data, req.requestId);
  }));
  api.patch('/admins/:id', adminMutation, asyncHandler(async (req, res) => {
    requireMutationKey(req);
    const data = service.patchAdmin(getAdminPrincipal(req), routeParam(req.params['id'], 'id'), parseBody(adminPatchSchema, req.body), req.requestId);
    sendData(res, 200, data, req.requestId);
  }));
  registerAdminToggleRoutes(api, '/admins/:id', adminMutation, (req, active) => service.patchAdmin(getAdminPrincipal(req), routeParam(req.params['id'], 'id'), { active }, req.requestId));
  api.post('/admins/:id/password', adminMutation, asyncHandler(async (req, res) => {
    requireMutationKey(req);
    const input = parseBody(passwordChangeSchema, req.body);
    const data = service.changeAdminPassword(getAdminPrincipal(req), routeParam(req.params['id'], 'id'), input.currentPassword, input.newPassword, req.requestId);
    sendData(res, 200, data, req.requestId);
  }));
  api.post('/admins/:id/revoke-sessions', adminMutation, asyncHandler(async (req, res) => {
    requireMutationKey(req);
    service.revokeAdminSessions(getAdminPrincipal(req), routeParam(req.params['id'], 'id'), req.requestId);
    sendData(res, 200, { revoked: true }, req.requestId);
  }));

  api.get('/audit-log', admin, asyncHandler(async (req, res) => {
    const limit = parseLimitQuery(req.query['limit']);
    sendList(res, service.getAuditLog(limit), req.requestId);
  }));
  api.get('/settings', admin, asyncHandler(async (req, res) => {
    sendList(res, service.listSettings(), req.requestId);
  }));
  api.patch('/settings', adminMutation, asyncHandler(async (req, res) => {
    requireMutationKey(req);
    const input = parseBody(settingsPatchSchema, req.body);
    const data = service.updateSettings(getAdminPrincipal(req), input.changes, req.requestId);
    sendList(res, data, req.requestId, { configurationRevision: service.getConfigurationRevision() });
  }));
  api.get('/system/health', asyncHandler(async (req, res) => {
    const health = service.getHealth();
    sendData(res, health.status === 'ready' ? 200 : 503, health, req.requestId);
  }));
  api.get('/system/snapshot', admin, asyncHandler(async (req, res) => {
    sendData(res, 200, service.getAdminSnapshot(), req.requestId);
  }));

  api.use((_req, res) => {
    res.status(404).json({ error: { code: 'RESOURCE_NOT_FOUND', message: 'The requested endpoint was not found.', requestId: res.req['requestId'] } });
  });
  app.use('/api/v1', api);
  serveWebApplication(app);
  app.use(errorHandler);
  return app;
}

function isSecureOrigin(origin: string): boolean {
  try {
    return new URL(origin).protocol === 'https:';
  } catch {
    return false;
  }
}

function serveWebApplication(app: Application): void {
  const webDirectory = path.resolve(__dirname, '../../../../apps/web/dist');
  if (!fs.existsSync(webDirectory)) return;
  app.use(express.static(webDirectory));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      next();
      return;
    }
    res.sendFile(path.join(webDirectory, 'index.html'), (error) => {
      if (error !== undefined) next(error);
    });
  });
}

function requestContext(req: Request, res: Response, next: NextFunction): void {
  req.requestId = `http_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

function requireAdmin(service: HotelService): RequestHandler {
  return (req, _res, next) => {
    try {
      const credentials = readCredentials(req);
      if (credentials.bearer !== undefined || credentials.cookie === undefined) {
        throw new AppError('AUTH_REQUIRED', 'An administrator session is required.', 401);
      }
      req.principal = service.authenticateAdmin(credentials.cookie);
      next();
    } catch (error) {
      next(error);
    }
  };
}

function requireDevice(service: HotelService): RequestHandler {
  return (req, _res, next) => {
    try {
      const credentials = readCredentials(req);
      if (credentials.cookie !== undefined || credentials.bearer === undefined) {
        throw new AppError('AUTH_REQUIRED', 'A device bearer token is required.', 401);
      }
      req.principal = service.authenticateDeviceToken(credentials.bearer).principal;
      next();
    } catch (error) {
      next(error);
    }
  };
}

function requireAnyPrincipal(service: HotelService): RequestHandler {
  return (req, _res, next) => {
    try {
      const credentials = readCredentials(req);
      if (credentials.cookie !== undefined) {
        req.principal = service.authenticateAdmin(credentials.cookie);
      } else if (credentials.bearer !== undefined) {
        req.principal = service.authenticateDeviceToken(credentials.bearer).principal;
      } else {
        throw new AppError('AUTH_REQUIRED', 'Authentication is required.', 401);
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

function requireAdminCsrf(service: HotelService): RequestHandler {
  return (req, _res, next) => {
    try {
      service.verifyCsrf(getAdminPrincipal(req), req.get('x-csrf-token'));
      next();
    } catch (error) {
      next(error);
    }
  };
}

function requireAdminCsrfIfNeeded(service: HotelService): RequestHandler {
  return (req, _res, next) => {
    try {
      const principal = getPrincipal(req);
      if (principal.kind === 'ADMIN') {
        service.verifyCsrf(principal, req.get('x-csrf-token'));
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

function readCredentials(req: Request): { cookie: string | undefined; bearer: string | undefined } {
  const cookie = req.cookies?.[ADMIN_SESSION_COOKIE] as string | undefined;
  const authorization = req.get('authorization');
  if (cookie !== undefined && authorization !== undefined) {
    throw new AppError('AUTH_AMBIGUOUS_CREDENTIALS', 'Provide either an administrator cookie or a device bearer token, not both.', 400);
  }
  if (authorization === undefined) {
    return { cookie, bearer: undefined };
  }
  if (!authorization.startsWith('Bearer ')) {
    throw new AppError('AUTH_INVALID', 'Authorization must use the Bearer scheme.', 401);
  }
  const bearer = authorization.slice('Bearer '.length);
  if (bearer.length === 0) {
    throw new AppError('AUTH_INVALID', 'A bearer token is required.', 401);
  }
  return { cookie, bearer };
}

function readBearerToken(req: Request): string | undefined {
  const credentials = readCredentials(req);
  if (credentials.cookie !== undefined || credentials.bearer === undefined) {
    throw new AppError('AUTH_REQUIRED', 'A device bearer token is required.', 401);
  }
  return credentials.bearer;
}

function getPrincipal(req: Request): Principal {
  if (req.principal === undefined) {
    throw new AppError('AUTH_REQUIRED', 'Authentication is required.', 401);
  }
  return req.principal;
}

function getAdminPrincipal(req: Request): AdminPrincipal {
  const principal = getPrincipal(req);
  if (principal.kind !== 'ADMIN') {
    throw new AppError('AUTH_REQUIRED', 'An administrator session is required.', 401);
  }
  return principal;
}

function getDevicePrincipal(req: Request) {
  const principal = getPrincipal(req);
  if (principal.kind !== 'DEVICE') {
    throw new AppError('AUTH_REQUIRED', 'A device bearer token is required.', 401);
  }
  return principal;
}

function getSessionExpiry(service: HotelService, principal: AdminPrincipal): string {
  return service.getAdminSessionExpiry(principal);
}

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw validationError('Request body failed validation.', result.error.flatten());
  }
  return result.data;
}

function parseRequiredQuery(value: unknown, name: string, maxLength: number): string {
  const parsed = z.string().trim().min(1).max(maxLength).safeParse(queryValue(value));
  if (!parsed.success) {
    throw validationError(`${name} is required.`, parsed.error.flatten());
  }
  return parsed.data;
}

function optionalQuery(value: unknown, maxLength: number): string | undefined {
  const raw = queryValue(value);
  if (raw === undefined || raw === '') return undefined;
  const parsed = z.string().trim().min(1).max(maxLength).safeParse(raw);
  if (!parsed.success) throw validationError('Query parameter is invalid.', parsed.error.flatten());
  return parsed.data;
}

function routeParam(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) {
    throw validationError(`${name} is required.`);
  }
  return value;
}

function queryValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === 'string' ? first : undefined;
  }
  return undefined;
}

function parseBooleanQuery(value: unknown): boolean {
  const raw = queryValue(value);
  if (raw === undefined) return false;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw validationError('Boolean query parameters must be true or false.');
}

function parseLimitQuery(value: unknown): number {
  const raw = queryValue(value);
  if (raw === undefined) return 100;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw validationError('limit must be an integer between 1 and 100.');
  }
  return parsed;
}

function parseRequestFilters(req: Request): RequestFilters {
  const filters: RequestFilters = {};
  const rawStatuses = queryValue(req.query['status']);
  if (rawStatuses !== undefined && rawStatuses !== '') {
    const result = requestStatusSchema.array().safeParse(rawStatuses.split(','));
    if (!result.success) throw validationError('status contains an unsupported request status.', result.error.flatten());
    filters.statuses = result.data as RequestStatus[];
  }
  const roomId = optionalQuery(req.query['roomId'], 128);
  const serviceId = optionalQuery(req.query['serviceId'], 128);
  const areaId = optionalQuery(req.query['areaId'], 128);
  const deviceId = optionalQuery(req.query['deviceId'], 128);
  const createdFrom = optionalQuery(req.query['from'], 40);
  const createdTo = optionalQuery(req.query['to'], 40);
  const search = optionalQuery(req.query['search'], 200);
  const cursor = optionalQuery(req.query['cursor'], 4096);
  const limit = queryValue(req.query['limit']);
  if (roomId !== undefined) filters.roomId = roomId;
  if (serviceId !== undefined) filters.serviceId = serviceId;
  if (areaId !== undefined) filters.areaId = areaId;
  if (deviceId !== undefined) filters.deviceId = deviceId;
  if (createdFrom !== undefined) filters.createdFrom = parseDateFilter(createdFrom, 'from', false);
  if (createdTo !== undefined) filters.createdTo = parseDateFilter(createdTo, 'to', true);
  if (search !== undefined) filters.search = search;
  if (cursor !== undefined) filters.cursor = cursor;
  if (limit !== undefined) filters.limit = parseLimitQuery(limit);
  return filters;
}

function parseDateFilter(value: string, name: string, endExclusive: boolean): string {
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value);
  if (Number.isNaN(parsed.getTime())) throw validationError(`${name} must be a valid ISO date.`);
  if (endExclusive && /^\d{4}-\d{2}-\d{2}$/.test(value)) parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString();
}

function requireMutationKey(req: Request): string {
  const value = req.get('idempotency-key');
  if (value === undefined || value.length < 1 || value.length > 128) {
    throw new AppError('VALIDATION_ERROR', 'Idempotency-Key must contain 1 to 128 characters.', 422);
  }
  return value;
}

function sendData(res: Response, status: number, data: unknown, requestId: string, extra: Record<string, unknown> = {}): void {
  res.status(status).json({ data, ...extra, requestId });
}

function sendList(res: Response, data: unknown, requestId: string, extra: Record<string, unknown> = {}): void {
  res.status(200).json({ data, page: { nextCursor: null, hasMore: false }, ...extra, requestId });
}

function sendPage<T>(res: Response, page: PageResult<T>, requestId: string, extra: Record<string, unknown> = {}): void {
  res.status(200).json({ data: page.data, page: page.page, ...extra, requestId });
}

function sendResource(res: Response, data: unknown, requestId: string, resource: string): void {
  if (data === null) {
    throw new AppError('RESOURCE_NOT_FOUND', `${resource} was not found.`, 404);
  }
  sendData(res, 200, data, requestId);
}

function registerToggleRoutes(
  router: Router,
  route: string,
  middleware: RequestHandler[],
  update: (req: Request, active: boolean) => unknown,
  service: HotelService,
  requiresKey: boolean
): void {
  for (const toggle of ['activate', 'deactivate'] as const) {
    router.post(`${route}/${toggle}`, middleware, asyncHandler(async (req, res) => {
      if (requiresKey) requireMutationKey(req);
      const data = update(req, toggle === 'activate');
      sendData(res, 200, data, req.requestId, { configurationRevision: service.getConfigurationRevision() });
    }));
  }
}

function registerAdminToggleRoutes(
  router: Router,
  route: string,
  middleware: RequestHandler[],
  update: (req: Request, active: boolean) => unknown
): void {
  for (const toggle of ['activate', 'deactivate'] as const) {
    router.post(`${route}/${toggle}`, middleware, asyncHandler(async (req, res) => {
      requireMutationKey(req);
      sendData(res, 200, update(req, toggle === 'activate'), req.requestId);
    }));
  }
}

function asyncHandler(handler: (req: Request, res: Response, next: NextFunction) => unknown): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

const errorHandler: ErrorRequestHandler = (error: unknown, req, res, _next) => {
  const requestId = req.requestId;
  if (isAppError(error)) {
    res.status(error.statusCode).json({ error: { code: error.code, message: error.message, details: error.details, requestId } });
    return;
  }
  if (error instanceof z.ZodError) {
    res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'Request validation failed.', details: error.flatten(), requestId } });
    return;
  }
  if (error instanceof SyntaxError) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Request body contains invalid JSON.', requestId } });
    return;
  }
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected server error occurred.', requestId } });
};

const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(12).max(256)
}).strict();
