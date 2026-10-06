import crypto from 'node:crypto';
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
  informationImageVariantSchema,
  informationImageReorderSchema,
  requestCreateSchema,
  requestStatusSchema,
  requestStartSchema,
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
  type InformationImageLanguage,
  type InformationImageVariant,
  type RequestStatus
} from '@hotel/shared';
import type { ServerConfig } from '../config/env';
import type { HotelService, InformationImageUpload, RequestFilters, RotationTokenPrincipal } from '../domain/hotel-service';
import { AppError, isAppError, notFound, validationError } from '../errors';
import { createGeoapifyClient } from '../integrations/geoapify-client';
import { createMetNorwayWeatherClient, type WeatherUnavailableReason } from '../integrations/met-norway-weather-client';
import { hashJson } from '../security/crypto';
import { actorForPrincipal, type AdminPrincipal, type Principal } from '../security/principal';
import { ImageProcessingError, MAX_IMAGE_INPUT_BYTES } from '../images/image-processor';
import { normalizeInformationImageUploads } from '../images/information-image-normalizer';
import { normalizeRoomBackgroundImage } from '../images/room-background-normalizer';
import { createRateLimiter, principalKey, sourceIpKey } from './rate-limit';

const ADMIN_SESSION_COOKIE = 'hotel_admin_session';
const JSON_BODY_LIMIT = '64kb';

export interface AppDependencies {
  geoapifyFetch?: typeof fetch;
  metNorwayFetch?: typeof fetch;
  weatherLog?: (record: WeatherUnavailableLogRecord) => void;
}

export interface WeatherUnavailableLogRecord {
  event: 'device.weather.unavailable';
  severity: 'warn';
  requestId: string;
  reason: WeatherUnavailableReason | 'location_not_configured';
}

declare global {
  // Express request context is populated by the first middleware.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      principal?: Principal;
      rotationTokenPrincipal?: RotationTokenPrincipal;
    }
  }
}

export function createApp(service: HotelService, config: ServerConfig, dependencies: AppDependencies = {}): Application {
  const app = express();
  const api = Router();
  const admin = requireAdmin(service);
  const adminSession = requireAdmin(service, true);
  const device = requireDevice(service);
  const anyPrincipal = requireAnyPrincipal(service);
  const loginRateLimit = createRateLimiter({ name: 'admin-login', limit: config.loginRateLimitMaxRequests, windowMs: 60_000, key: sourceIpKey });
  const bootstrapStateRateLimit = createRateLimiter({ name: 'bootstrap-state', limit: 30, windowMs: 60_000, key: sourceIpKey });
  const principalMutationRateLimit = createRateLimiter({ name: 'authenticated-mutation', limit: 120, windowMs: 60_000, key: principalKey });
  const adminOperationRateLimit = createRateLimiter({ name: 'admin-operation', limit: 10, windowMs: 60_000, key: principalKey });
  const citySearchRateLimit = createRateLimiter({ name: 'city-search', limit: 30, windowMs: 60_000, key: principalKey });
  const heartbeatRateLimit = createRateLimiter({ name: 'device-heartbeat', limit: 6, windowMs: 60_000, key: principalKey });
  const geoapifyClient = createGeoapifyClient(config, dependencies.geoapifyFetch);
  const metNorwayWeatherClient = createMetNorwayWeatherClient(config, dependencies.metNorwayFetch);
  const weatherLog = dependencies.weatherLog ?? writeWeatherUnavailableLog;
  const informationImageUpload = express.raw({
    limit: `${config.informationImageMaxBytes * 4 + 128 * 1024}b`,
    type: (req) => {
      const contentTypeHeader = req.headers['content-type'];
      const contentType = Array.isArray(contentTypeHeader) ? contentTypeHeader[0] ?? '' : contentTypeHeader ?? '';
      return contentType.startsWith('multipart/form-data') || contentType.startsWith('application/octet-stream') || contentType.startsWith('image/');
    }
  });
  const roomBackgroundSourceUpload = express.raw({
    limit: `${MAX_IMAGE_INPUT_BYTES + 16 * 1024}b`,
    type: (req) => {
      const contentTypeHeader = req.headers['content-type'];
      const contentType = (Array.isArray(contentTypeHeader) ? contentTypeHeader[0] ?? '' : contentTypeHeader ?? '').toLowerCase();
      return contentType.startsWith('multipart/form-data') || contentType.startsWith('application/octet-stream') || contentType.startsWith('image/');
    }
  });
  const adminMutation = [admin, requireAdminCsrf(service), principalMutationRateLimit];
  const adminSessionMutation = [adminSession, requireAdminCsrf(service), principalMutationRateLimit];
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

  api.get('/auth/admin/me', adminSession, asyncHandler(async (req, res) => {
    const principal = getAdminPrincipal(req);
    sendData(res, 200, {
      id: principal.adminId,
      username: principal.username,
      expiresAt: getSessionExpiry(service, principal),
      mustChangePassword: principal.mustChangePassword === true
    }, req.requestId);
  }));

  api.post('/auth/admin/logout', adminSessionMutation, asyncHandler(async (req, res) => {
    service.logoutAdmin(getAdminPrincipal(req), req.requestId);
    res.clearCookie(ADMIN_SESSION_COOKIE, { httpOnly: true, sameSite: 'strict', secure: isSecureOrigin(config.appOrigin), path: '/' });
    res.status(204).send();
  }));

  api.post('/auth/admin/logout-all', adminMutation, asyncHandler(async (req, res) => {
    service.logoutAllAdminSessions(getAdminPrincipal(req), req.requestId);
    res.clearCookie(ADMIN_SESSION_COOKIE, { httpOnly: true, sameSite: 'strict', secure: isSecureOrigin(config.appOrigin), path: '/' });
    res.status(204).send();
  }));

  api.post('/auth/admin/change-password', adminSessionMutation, asyncHandler(async (req, res) => {
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
    const idempotencyKey = requireMutationKey(req);
    const principal = getAdminPrincipal(req);
    const input = parseBody(deviceCreateSchema, req.body);
    const result = service.bootstrapDeviceIdempotent(input, actorForPrincipal(principal), idempotencyKey, req.requestId);
    sendData(res, 201, result.data, req.requestId, { configurationRevision: result.data.configurationRevision, idempotentReplay: result.idempotentReplay });
  });
  api.post('/devices/bootstrap', adminSensitiveMutation, bootstrapDevice);
  api.post('/devices', adminSensitiveMutation, bootstrapDevice);

  api.get('/device/session', device, asyncHandler(async (req, res) => {
    sendData(res, 200, service.getDeviceSnapshot(getDevicePrincipal(req)), req.requestId);
  }));

  api.get('/device/weather', device, asyncHandler(async (req, res) => {
    const principal = getDevicePrincipal(req);
    if (principal.assignmentMode !== 'ROOM' || principal.roomId === null) {
      throw new AppError('FORBIDDEN_ASSIGNMENT', 'Weather forecast is available only to ROOM devices.', 403);
    }
    const settings = service.getSettings();
    const { weatherLatitude, weatherLongitude } = settings;
    if (weatherLatitude === null || weatherLongitude === null) {
      reportWeatherUnavailable(weatherLog, {
        event: 'device.weather.unavailable',
        severity: 'warn',
        requestId: req.requestId,
        reason: 'location_not_configured'
      });
      sendData(res, 200, null, req.requestId);
      return;
    }
    const weather = await metNorwayWeatherClient.getWeather(weatherLatitude, weatherLongitude, (reason) => {
      reportWeatherUnavailable(weatherLog, {
        event: 'device.weather.unavailable',
        severity: 'warn',
        requestId: req.requestId,
        reason
      });
    });
    sendData(res, 200, weather, req.requestId);
  }));

  api.post('/device/heartbeat', [device, heartbeatRateLimit], asyncHandler(async (req, res) => {
    const input = parseBody(heartbeatSchema, req.body);
    service.recordHeartbeat(getDevicePrincipal(req), {
      ...(input.clientVersion === undefined ? {} : { clientVersion: input.clientVersion }),
      ...(input.socketConnected === undefined ? {} : { socketConnected: input.socketConnected })
    }, req.ip, req.get('user-agent'));
    sendData(res, 200, { ok: true }, req.requestId);
  }));

  api.post('/device/token-rotation/claim', [device, adminOperationRateLimit], asyncHandler(async (req, res) => {
    const input = parseBody(rotationClaimSchema, req.body);
    const data = service.claimTokenRotation(getDevicePrincipal(req), input.rotationId);
    sendData(res, 200, data, req.requestId);
  }));

  api.post('/device/token-rotation/acknowledge', [requireRotationToken(service), adminOperationRateLimit], asyncHandler(async (req, res) => {
    const principal = getRotationTokenPrincipal(req);
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

  api.post('/requests', [device, principalMutationRateLimit], asyncHandler(async (req, res) => {
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
      const principal = getPrincipal(req);
      const requestId = routeParam(req.params['requestId'], 'requestId');
      const idempotencyKey = requireMutationKey(req);
      if (transition.status === 'IN_PROGRESS') {
        const input = parseBody(requestStartSchema, req.body);
        const result = service.transitionRequest(principal, requestId, transition.status, input.expectedVersion, idempotencyKey, req.requestId, input.responsibleName);
        sendData(res, 200, result.data, req.requestId, { idempotentReplay: result.idempotentReplay });
        return;
      }
      const input = parseBody(requestTransitionSchema, req.body);
      const result = service.transitionRequest(principal, requestId, transition.status, input.expectedVersion, idempotencyKey, req.requestId);
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
    const idempotencyKey = requireMutationKey(req);
    const principal = getAdminPrincipal(req);
    const input = parseBody(roomCreateSchema, req.body);
    const result = service.runIdempotentMutation(actorForPrincipal(principal), idempotencyKey, 'room.create', hashJson(input), null, () => service.createRoom(input, actorForPrincipal(principal), req.requestId), 201);
    sendData(res, 201, result.data, req.requestId, { configurationRevision: service.getConfigurationRevision(), idempotentReplay: result.idempotentReplay });
  }));
  api.patch('/rooms/:id', adminMutation, asyncHandler(async (req, res) => {
    const idempotencyKey = requireMutationKey(req);
    const principal = getAdminPrincipal(req);
    const roomId = routeParam(req.params['id'], 'id');
    const input = parseBody(roomPatchSchema, req.body);
    const result = service.runIdempotentMutation(actorForPrincipal(principal), idempotencyKey, 'room.update', hashJson(input), roomId, () => service.patchRoom(roomId, input, actorForPrincipal(principal), req.requestId));
    sendData(res, 200, result.data, req.requestId, { configurationRevision: service.getConfigurationRevision(), idempotentReplay: result.idempotentReplay });
  }));
  registerToggleRoutes(api, '/rooms/:id', adminMutation, (req, active) => service.patchRoom(routeParam(req.params['id'], 'id'), { active }, actorForPrincipal(getAdminPrincipal(req)), req.requestId), service, true);

  api.get('/areas', admin, asyncHandler(async (req, res) => {
    sendList(res, service.listAreas(), req.requestId);
  }));
  api.get('/areas/:id', admin, asyncHandler(async (req, res) => {
    sendResource(res, service.getArea(routeParam(req.params['id'], 'id')), req.requestId, 'Area');
  }));
  api.post('/areas', adminMutation, asyncHandler(async (req, res) => {
    const idempotencyKey = requireMutationKey(req);
    const principal = getAdminPrincipal(req);
    const input = parseBody(areaCreateSchema, req.body);
    const result = service.runIdempotentMutation(actorForPrincipal(principal), idempotencyKey, 'area.create', hashJson(input), null, () => service.createArea(input, actorForPrincipal(principal), req.requestId), 201);
    sendData(res, 201, result.data, req.requestId, { configurationRevision: service.getConfigurationRevision(), idempotentReplay: result.idempotentReplay });
  }));
  api.patch('/areas/:id', adminMutation, asyncHandler(async (req, res) => {
    const idempotencyKey = requireMutationKey(req);
    const principal = getAdminPrincipal(req);
    const areaId = routeParam(req.params['id'], 'id');
    const input = parseBody(areaPatchSchema, req.body);
    const result = service.runIdempotentMutation(actorForPrincipal(principal), idempotencyKey, 'area.update', hashJson(input), areaId, () => service.patchArea(areaId, input, actorForPrincipal(principal), req.requestId));
    sendData(res, 200, result.data, req.requestId, { configurationRevision: service.getConfigurationRevision(), idempotentReplay: result.idempotentReplay });
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
    const idempotencyKey = requireMutationKey(req);
    const principal = getAdminPrincipal(req);
    const input = parseBody(serviceCreateSchema, req.body);
    const result = service.runIdempotentMutation(actorForPrincipal(principal), idempotencyKey, 'service.create', hashJson(input), null, () => service.createService(input, actorForPrincipal(principal), req.requestId), 201);
    sendData(res, 201, result.data, req.requestId, { configurationRevision: service.getConfigurationRevision(), idempotentReplay: result.idempotentReplay });
  }));
  api.patch('/services/:id', adminMutation, asyncHandler(async (req, res) => {
    const idempotencyKey = requireMutationKey(req);
    const principal = getAdminPrincipal(req);
    const serviceId = routeParam(req.params['id'], 'id');
    const input = parseBody(servicePatchSchema, req.body);
    const result = service.runIdempotentMutation(actorForPrincipal(principal), idempotencyKey, 'service.update', hashJson(input), serviceId, () => service.patchService(serviceId, input, actorForPrincipal(principal), req.requestId));
    sendData(res, 200, result.data, req.requestId, { configurationRevision: service.getConfigurationRevision(), idempotentReplay: result.idempotentReplay });
  }));
  registerToggleRoutes(api, '/services/:id', adminMutation, (req, active) => service.patchService(routeParam(req.params['id'], 'id'), { active }, actorForPrincipal(getAdminPrincipal(req)), req.requestId), service, true);

  api.get('/devices', admin, asyncHandler(async (req, res) => {
    sendList(res, service.listDevices(), req.requestId);
  }));
  api.get('/devices/:id', admin, asyncHandler(async (req, res) => {
    sendResource(res, service.getDevice(routeParam(req.params['id'], 'id')), req.requestId, 'Device');
  }));
  api.patch('/devices/:id', adminMutation, asyncHandler(async (req, res) => {
    const idempotencyKey = requireMutationKey(req);
    const principal = getAdminPrincipal(req);
    const deviceId = routeParam(req.params['id'], 'id');
    const input = parseBody(devicePatchSchema, req.body);
    const result = service.runIdempotentMutation(actorForPrincipal(principal), idempotencyKey, 'device.update', hashJson(input), deviceId, () => service.patchDevice(principal, deviceId, input, req.requestId));
    sendData(res, 200, result.data, req.requestId, { configurationRevision: service.getConfigurationRevision(), idempotentReplay: result.idempotentReplay });
  }));
  registerToggleRoutes(api, '/devices/:id', adminMutation, (req, active) => service.patchDevice(getAdminPrincipal(req), routeParam(req.params['id'], 'id'), { active }, req.requestId), service, true);
  api.post('/devices/:id/retire', adminSensitiveMutation, asyncHandler(async (req, res) => {
    const result = service.retireDevice(getAdminPrincipal(req), routeParam(req.params['id'], 'id'), requireMutationKey(req), req.requestId);
    sendData(res, 200, result.data, req.requestId, { configurationRevision: result.configurationRevision, idempotentReplay: result.idempotentReplay });
  }));
  api.get('/device/information/images', device, asyncHandler(async (req, res) => {
    sendList(res, service.listInformationImagesForDevice(getDevicePrincipal(req)), req.requestId);
  }));
  api.get('/device/information/images/:id/content', device, asyncHandler(async (req, res) => {
    const content = service.getInformationImageContentForDevice(getDevicePrincipal(req), routeParam(req.params['id'], 'id'), parseOptionalInformationImageVariant(req.query['variant']), parseOptionalInformationImageLanguage(req.query['language']));
    if (content === null) throw notFound('Information image');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Request-Id', req.requestId);
    res.type(content.image.mimeType).send(content.bytes);
  }));
  api.post('/devices/:id/assignment', adminMutation, asyncHandler(async (req, res) => {
    const idempotencyKey = requireMutationKey(req);
    const principal = getAdminPrincipal(req);
    const deviceId = routeParam(req.params['id'], 'id');
    const input = parseBody(deviceAssignmentSchema, req.body);
    const result = service.runIdempotentMutation(actorForPrincipal(principal), idempotencyKey, 'device.assignment', hashJson(input), deviceId, () => service.assignDevice(principal, deviceId, input, req.requestId));
    sendData(res, 200, result.data.device, req.requestId, { configurationRevision: result.data.configurationRevision, idempotentReplay: result.idempotentReplay });
  }));
  api.post('/devices/:id/token-rotation', adminSensitiveMutation, asyncHandler(async (req, res) => {
    const idempotencyKey = requireMutationKey(req);
    const input = parseBody(tokenRotationSchema, req.body);
    const principal = getAdminPrincipal(req);
    const deviceId = routeParam(req.params['id'], 'id');
    const normalizedInput = { gracePeriodMinutes: input.gracePeriodMinutes ?? 30, reason: input.reason };
    const result = service.runIdempotentMutation(actorForPrincipal(principal), idempotencyKey, 'device.tokenRotation.start', hashJson(normalizedInput), deviceId, () => service.startTokenRotation(principal, deviceId, normalizedInput.gracePeriodMinutes, normalizedInput.reason, req.requestId), 202);
    sendData(res, 202, result.data, req.requestId, { configurationRevision: service.getConfigurationRevision(), idempotentReplay: result.idempotentReplay });
  }));
  api.post('/devices/:id/revoke-token', adminSensitiveMutation, asyncHandler(async (req, res) => {
    const idempotencyKey = requireMutationKey(req);
    const principal = getAdminPrincipal(req);
    const deviceId = routeParam(req.params['id'], 'id');
    const result = service.revokeDeviceTokenIdempotent(principal, deviceId, idempotencyKey, req.requestId);
    sendData(res, 200, result.data, req.requestId, { configurationRevision: service.getConfigurationRevision(), idempotentReplay: result.idempotentReplay });
  }));

  api.get('/admins', admin, asyncHandler(async (req, res) => {
    sendList(res, service.listAdmins(), req.requestId);
  }));
  api.get('/admins/:id', admin, asyncHandler(async (req, res) => {
    sendResource(res, service.getAdmin(routeParam(req.params['id'], 'id')), req.requestId, 'Administrator');
  }));
  api.post('/admins', adminMutation, asyncHandler(async (req, res) => {
    const idempotencyKey = requireMutationKey(req);
    const principal = getAdminPrincipal(req);
    const input = parseBody(adminCreateSchema, req.body);
    const result = service.runIdempotentMutation(actorForPrincipal(principal), idempotencyKey, 'admin.create', hashJson(input), null, () => service.createAdmin(input, actorForPrincipal(principal), req.requestId), 201);
    sendData(res, 201, result.data, req.requestId, { idempotentReplay: result.idempotentReplay });
  }));
  api.patch('/admins/:id', adminMutation, asyncHandler(async (req, res) => {
    const idempotencyKey = requireMutationKey(req);
    const principal = getAdminPrincipal(req);
    const adminId = routeParam(req.params['id'], 'id');
    const input = parseBody(adminPatchSchema, req.body);
    const result = service.runIdempotentMutation(actorForPrincipal(principal), idempotencyKey, 'admin.update', hashJson(input), adminId, () => service.patchAdmin(principal, adminId, input, req.requestId));
    sendData(res, 200, result.data, req.requestId, { idempotentReplay: result.idempotentReplay });
  }));
  registerAdminToggleRoutes(api, '/admins/:id', adminMutation, (req, active) => service.patchAdmin(getAdminPrincipal(req), routeParam(req.params['id'], 'id'), { active }, req.requestId), service);
  api.post('/admins/:id/password', adminMutation, asyncHandler(async (req, res) => {
    requireMutationKey(req);
    const input = parseBody(passwordChangeSchema, req.body);
    const data = service.changeAdminPassword(getAdminPrincipal(req), routeParam(req.params['id'], 'id'), input.currentPassword, input.newPassword, req.requestId);
    sendData(res, 200, data, req.requestId);
  }));
  api.post('/admins/:id/revoke-sessions', adminMutation, asyncHandler(async (req, res) => {
    const idempotencyKey = requireMutationKey(req);
    const principal = getAdminPrincipal(req);
    const adminId = routeParam(req.params['id'], 'id');
    const result = service.revokeAdminSessionsIdempotent(principal, adminId, idempotencyKey, req.requestId);
    sendData(res, 200, result.data, req.requestId, { idempotentReplay: result.idempotentReplay });
  }));

  api.get('/audit-log', admin, asyncHandler(async (req, res) => {
    const limit = parseLimitQuery(req.query['limit']);
    sendList(res, service.getAuditLog(limit), req.requestId);
  }));
  api.get('/settings', admin, asyncHandler(async (req, res) => {
    sendList(res, service.listSettings(), req.requestId);
  }));
  api.get('/settings/location-search/availability', admin, asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    sendData(res, 200, { available: geoapifyClient.isConfigured() }, req.requestId);
  }));
  api.get('/settings/location-search', [admin, citySearchRateLimit], asyncHandler(async (req, res) => {
    const query = parseRequiredQuery(req.query['text'], 'text', 120);
    const results = await geoapifyClient.searchCities(query);
    res.set('Cache-Control', 'no-store');
    sendData(res, 200, results, req.requestId);
  }));
  api.patch('/settings', adminMutation, asyncHandler(async (req, res) => {
    const idempotencyKey = requireMutationKey(req);
    const input = parseBody(settingsPatchSchema, req.body);
    const principal = getAdminPrincipal(req);
    const result = service.runIdempotentMutation(actorForPrincipal(principal), idempotencyKey, 'settings.update', hashJson(input.changes), 'settings', () => service.updateSettings(principal, input.changes, req.requestId));
    sendList(res, result.data, req.requestId, { configurationRevision: service.getConfigurationRevision(), idempotentReplay: result.idempotentReplay });
  }));
  api.post('/settings/room-background', ...adminSensitiveMutation, roomBackgroundSourceUpload, asyncHandler(async (req, res) => {
    const idempotencyKey = requireMutationKey(req);
    const sourceBytes = parseRoomBackgroundSourceUpload(req);
    const principal = getAdminPrincipal(req);
    let roomBackground: Awaited<ReturnType<typeof normalizeRoomBackgroundImage>>;
    try {
      roomBackground = await normalizeRoomBackgroundImage(sourceBytes);
    } catch (error) {
      if (error instanceof ImageProcessingError) {
        if (error.code === 'IMAGE_PROCESSOR_UNAVAILABLE' || error.code === 'IMAGE_PROCESSING_TIMEOUT') {
          throw new AppError('INTERNAL_ERROR', error.message, 503, { code: error.code });
        }
        throw validationError(error.message, { code: error.code });
      }
      throw error;
    }

    const requestHash = hashJson({ sourceSha256: crypto.createHash('sha256').update(sourceBytes).digest('hex') });
    const result = service.runIdempotentMutation(
      actorForPrincipal(principal),
      idempotencyKey,
      'settings.room-background.update',
      requestHash,
      'settings',
      () => service.updateSettings(principal, { roomBackground }, req.requestId)
    );
    res.set('Cache-Control', 'no-store');
    sendData(res, 200, { updated: true }, req.requestId, {
      configurationRevision: service.getConfigurationRevision(),
      idempotentReplay: result.idempotentReplay
    });
  }));
  api.get('/information/images', admin, asyncHandler(async (req, res) => {
    sendList(res, service.listInformationImages(), req.requestId);
  }));
  api.get('/information/images/:id/content', admin, asyncHandler(async (req, res) => {
    const content = service.getInformationImageContent(routeParam(req.params['id'], 'id'), parseOptionalInformationImageVariant(req.query['variant']), parseOptionalInformationImageLanguage(req.query['language']));
    if (content === null) throw notFound('Information image');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Request-Id', req.requestId);
    res.type(content.image.mimeType).send(content.bytes);
  }));
  api.post('/information/images', [admin, requireAdminCsrf(service), principalMutationRateLimit, informationImageUpload], asyncHandler(async (req, res) => {
    const idempotencyKey = requireMutationKey(req);
    const upload = parseInformationImageUpload(req);
    const requestHash = hashInformationImageUploads(upload);
    const normalizedUploads = await normalizeInformationUploads(upload, config.informationImageMaxBytes);
    const actor = actorForPrincipal(getAdminPrincipal(req));
    const result = service.runIdempotentMutation(actor, idempotencyKey, 'information.image.create', requestHash, null, () => service.createInformationImageVariants(normalizedUploads, actor, req.requestId), 201);
    sendData(res, 201, result.data, req.requestId, { configurationRevision: service.getConfigurationRevision(), idempotentReplay: result.idempotentReplay });
  }));
  api.post('/information/images/:id/variants', [admin, requireAdminCsrf(service), principalMutationRateLimit, informationImageUpload], asyncHandler(async (req, res) => {
    const idempotencyKey = requireMutationKey(req);
    const upload = parseInformationImageUpload(req);
    const requestHash = hashInformationImageUploads(upload);
    const normalizedUploads = await normalizeInformationUploads(upload, config.informationImageMaxBytes);
    const imageId = routeParam(req.params['id'], 'id');
    const actor = actorForPrincipal(getAdminPrincipal(req));
    const result = service.runIdempotentMutation(actor, idempotencyKey, 'information.image.variants.update', requestHash, imageId, () => service.updateInformationImageVariants(imageId, normalizedUploads, actor, req.requestId));
    sendData(res, 200, result.data, req.requestId, { configurationRevision: service.getConfigurationRevision(), idempotentReplay: result.idempotentReplay });
  }));
  api.patch('/information/images/order', adminMutation, asyncHandler(async (req, res) => {
    requireMutationKey(req);
    const data = service.reorderInformationImages(parseBody(informationImageReorderSchema, req.body).ids, actorForPrincipal(getAdminPrincipal(req)), req.requestId);
    sendList(res, data, req.requestId, { configurationRevision: service.getConfigurationRevision() });
  }));
  api.delete('/information/images/:id', adminMutation, asyncHandler(async (req, res) => {
    requireMutationKey(req);
    service.deleteInformationImage(routeParam(req.params['id'], 'id'), actorForPrincipal(getAdminPrincipal(req)), req.requestId);
    sendData(res, 200, { deleted: true }, req.requestId, { configurationRevision: service.getConfigurationRevision() });
  }));
  api.get('/system/health', asyncHandler(async (req, res) => {
    const health = service.getHealth();
    sendData(res, health.status === 'ready' ? 200 : 503, health, req.requestId);
  }));
  api.get('/system/snapshot', admin, asyncHandler(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
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

function reportWeatherUnavailable(
  sink: (record: WeatherUnavailableLogRecord) => void,
  record: WeatherUnavailableLogRecord
): void {
  try {
    sink(record);
  } catch {
    // Weather is optional; diagnostic failures must not break the device endpoint.
  }
}

function writeWeatherUnavailableLog(record: WeatherUnavailableLogRecord): void {
  console.warn(JSON.stringify(record));
}

function requireAdmin(service: HotelService, allowPasswordChangeRequired = false): RequestHandler {
  return (req, _res, next) => {
    try {
      const credentials = readCredentials(req);
      if (credentials.bearer !== undefined || credentials.cookie === undefined) {
        throw new AppError('AUTH_REQUIRED', 'An administrator session is required.', 401);
      }
      const principal = service.authenticateAdmin(credentials.cookie);
      if (!allowPasswordChangeRequired) assertAdminPasswordChangeComplete(principal);
      req.principal = principal;
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

function requireRotationToken(service: HotelService): RequestHandler {
  return (req, _res, next) => {
    try {
      const rotationTokenPrincipal = service.authenticateRotationToken(readBearerToken(req));
      req.rotationTokenPrincipal = rotationTokenPrincipal;
      req.principal = rotationTokenPrincipal.principal;
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
        const principal = service.authenticateAdmin(credentials.cookie);
        assertAdminPasswordChangeComplete(principal);
        req.principal = principal;
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

function assertAdminPasswordChangeComplete(principal: AdminPrincipal): void {
  if (principal.mustChangePassword === true) {
    throw new AppError('ADMIN_PASSWORD_CHANGE_REQUIRED', 'Change the initial administrator password before continuing.', 403);
  }
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

function getRotationTokenPrincipal(req: Request): RotationTokenPrincipal {
  if (req.rotationTokenPrincipal === undefined) {
    throw new AppError('AUTH_REQUIRED', 'Authentication is required.', 401);
  }
  return req.rotationTokenPrincipal;
}

function getSessionExpiry(service: HotelService, principal: AdminPrincipal): string {
  return service.getAdminSessionExpiry(principal);
}

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw createBodyValidationError(result.error);
  }
  return result.data;
}

/** @internal Exposed so the request-validation log mapping can be unit tested. */
export function createBodyValidationError(error: z.ZodError): AppError {
  const appError = validationError('Request body failed validation.', error.flatten());
  validationLogMetadataByError.set(appError, summarizeValidationIssues(error.issues));
  return appError;
}

type ParsedInformationImageUpload = InformationImageUpload & { contentType?: string };

function parseInformationImageUpload(req: Request): ParsedInformationImageUpload[] {
  if (!Buffer.isBuffer(req.body)) {
    throw validationError('An image upload is required.');
  }
  const contentType = req.get('content-type') ?? '';
  if (contentType.startsWith('multipart/form-data')) {
    return parseMultipartInformationImage(req.body, contentType);
  }
  const uploadContentType = normalizeInformationImageContentType(req.get('content-type'));
  return [{
    bytes: req.body,
    originalName: req.get('x-image-name') ?? 'image',
    ...(uploadContentType === undefined ? {} : { contentType: uploadContentType })
  }];
}

async function normalizeInformationUploads(
  uploads: readonly ParsedInformationImageUpload[],
  maximumBytes: number
): Promise<InformationImageUpload[]> {
  try {
    return await normalizeInformationImageUploads(uploads, maximumBytes);
  } catch (error) {
    if (!(error instanceof ImageProcessingError)) throw error;
    if (error.code === 'IMAGE_PROCESSOR_UNAVAILABLE' || error.code === 'IMAGE_PROCESSING_TIMEOUT') {
      throw new AppError('INTERNAL_ERROR', error.message, 503, { code: error.code });
    }
    throw validationError(error.message, { code: error.code });
  }
}

function parseRoomBackgroundSourceUpload(req: Request): Buffer {
  if (!Buffer.isBuffer(req.body)) {
    throw validationError('An image upload is required.');
  }
  const contentType = req.get('content-type') ?? '';
  if (!/^multipart\/form-data(?:\s*;|$)/i.test(contentType)) return req.body;

  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = (boundaryMatch?.[1] ?? boundaryMatch?.[2])?.trim();
  if (boundary === undefined || boundary.length === 0 || boundary.length > 200) {
    throw validationError('Multipart image upload is missing a valid boundary.');
  }
  const delimiter = Buffer.from(`--${boundary}`, 'ascii');
  const headerSeparator = Buffer.from('\r\n\r\n', 'ascii');
  const body = req.body;
  if (!body.subarray(0, delimiter.length).equals(delimiter) || !hasMultipartBoundarySuffix(body, delimiter.length)) {
    throw validationError('Multipart image upload has an invalid boundary.');
  }

  let imageBytes: Buffer | null = null;
  let cursor = delimiter.length;
  if (isMultipartClosingBoundary(body, cursor)) throw validationError('An image upload is required.');
  if (!hasCrLf(body, cursor)) throw validationError('Multipart image upload has an invalid boundary.');
  cursor += 2;

  while (cursor < body.length) {
    const headerEnd = body.indexOf(headerSeparator, cursor);
    if (headerEnd < 0 || headerEnd - cursor > 16 * 1024) {
      throw validationError('Multipart image upload has invalid headers.');
    }
    const contentStart = headerEnd + headerSeparator.length;
    const nextBoundary = findMultipartBoundary(body, delimiter, contentStart);
    if (nextBoundary < 0) throw validationError('Multipart image upload has an invalid boundary.');
    const headers = body.subarray(cursor, headerEnd).toString('latin1');
    const disposition = /^content-disposition:\s*form-data\s*;([^\r\n]*)$/im.exec(headers)?.[1] ?? '';
    const fieldName = /(?:^|;)\s*name="([^"]+)"/i.exec(disposition)?.[1];
    const fileName = /(?:^|;)\s*filename="([^"]*)"/i.exec(disposition)?.[1];
    if (fieldName !== 'image' || fileName === undefined || imageBytes !== null) {
      throw validationError('Multipart room background upload must include exactly one image file.');
    }

    imageBytes = Buffer.from(body.subarray(contentStart, nextBoundary - 2));
    cursor = nextBoundary + delimiter.length;
    if (isMultipartClosingBoundary(body, cursor)) break;
    if (!hasCrLf(body, cursor)) throw validationError('Multipart image upload has an invalid boundary.');
    cursor += 2;
  }

  if (imageBytes === null) throw validationError('An image upload is required.');
  return imageBytes;
}

function parseMultipartInformationImage(body: Buffer, contentType: string): ParsedInformationImageUpload[] {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = (boundaryMatch?.[1] ?? boundaryMatch?.[2])?.trim();
  if (boundary === undefined || boundary.length === 0) {
    throw validationError('Multipart image upload is missing its boundary.');
  }
  const delimiter = Buffer.from(`--${boundary}`, 'ascii');
  const headerSeparator = Buffer.from('\r\n\r\n', 'ascii');
  if (!body.subarray(0, delimiter.length).equals(delimiter) || !hasMultipartBoundarySuffix(body, delimiter.length)) {
    throw validationError('Multipart image upload has an invalid boundary.');
  }

  const uploads: ParsedInformationImageUpload[] = [];
  let cursor = delimiter.length;
  if (isMultipartClosingBoundary(body, cursor)) return uploads;
  if (!hasCrLf(body, cursor)) {
    throw validationError('Multipart image upload has an invalid boundary.');
  }
  cursor += 2;

  while (cursor < body.length) {
    const headerEnd = body.indexOf(headerSeparator, cursor);
    if (headerEnd < 0) break;
    const contentStart = headerEnd + headerSeparator.length;
    const nextBoundary = findMultipartBoundary(body, delimiter, contentStart);
    if (nextBoundary < 0) break;
    const contentEnd = nextBoundary - 2;
    const headers = body.subarray(cursor, headerEnd).toString('latin1');
    const disposition = /content-disposition:[^\r\n]*\bname="([^"]+)"[^\r\n]*\bfilename="([^"]*)"/i.exec(headers);
    if (disposition !== null) {
      const field = disposition[1]?.toLowerCase() ?? '';
      if (field !== 'image') throw validationError('Information image upload must include exactly one source image file.');
      if (uploads.length > 0) throw validationError('Information image upload must include exactly one source image file.');
      const partContentType = normalizeInformationImageContentType(/^content-type:\s*([^\r\n]*)$/im.exec(headers)?.[1]);
      uploads.push({
        bytes: Buffer.from(body.subarray(contentStart, contentEnd)),
        originalName: disposition[2] ?? 'image',
        ...(partContentType === undefined ? {} : { contentType: partContentType })
      });
    }

    cursor = nextBoundary + delimiter.length;
    if (isMultipartClosingBoundary(body, cursor)) break;
    if (!hasCrLf(body, cursor)) {
      throw validationError('Multipart image upload has an invalid boundary.');
    }
    cursor += 2;
  }
  if (uploads.length !== 1) throw validationError('Multipart image upload must include exactly one source image file.');
  return uploads;
}

function hashInformationImageUploads(uploads: readonly ParsedInformationImageUpload[]): string {
  return hashJson(uploads.map(({ bytes, originalName, language, variant, contentType }) => ({
    language: language ?? null,
    variant: variant ?? 'legacy',
    originalName,
    contentType: contentType ?? null,
    bytes: bytes.toString('base64')
  })));
}

function normalizeInformationImageContentType(value: string | undefined): string | undefined {
  const contentType = value?.trim().toLowerCase();
  return contentType === undefined || contentType.length === 0 ? undefined : contentType;
}

function findMultipartBoundary(body: Buffer, delimiter: Buffer, from: number): number {
  let position = body.indexOf(delimiter, from);
  while (position >= 0) {
    const hasLinePrefix = position >= 2 && body[position - 2] === 0x0d && body[position - 1] === 0x0a;
    if (hasLinePrefix && hasMultipartBoundarySuffix(body, position + delimiter.length)) {
      return position;
    }
    position = body.indexOf(delimiter, position + 1);
  }
  return -1;
}

function hasMultipartBoundarySuffix(body: Buffer, offset: number): boolean {
  return hasCrLf(body, offset) || isMultipartClosingBoundary(body, offset);
}

function isMultipartClosingBoundary(body: Buffer, offset: number): boolean {
  return body[offset] === 0x2d && body[offset + 1] === 0x2d;
}

function hasCrLf(body: Buffer, offset: number): boolean {
  return body[offset] === 0x0d && body[offset + 1] === 0x0a;
}

function parseOptionalInformationImageVariant(value: unknown): InformationImageVariant | undefined {
  const raw = optionalQuery(value, 32);
  if (raw === undefined) return undefined;
  const parsed = informationImageVariantSchema.safeParse(raw);
  if (!parsed.success) throw validationError('Image variant is invalid.', parsed.error.flatten());
  return parsed.data;
}

function parseOptionalInformationImageLanguage(value: unknown): InformationImageLanguage | undefined {
  const raw = queryValue(value);
  if (raw === undefined) return undefined;
  if (raw === 'en' || raw === 'es') return raw;
  throw validationError('The information image language must be en or es.');
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
    throw validationError(name === 'requestId' ? REQUEST_ID_REQUIRED_MESSAGE : `${name} is required.`);
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
    throw new AppError('VALIDATION_ERROR', MUTATION_KEY_VALIDATION_MESSAGE, 422);
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
      if (!requiresKey) {
        const data = update(req, toggle === 'activate');
        sendData(res, 200, data, req.requestId, { configurationRevision: service.getConfigurationRevision() });
        return;
      }
      const idempotencyKey = requireMutationKey(req);
      const principal = getAdminPrincipal(req);
      const resourceId = routeParam(req.params['id'], 'id');
      const input = { active: toggle === 'activate' };
      const result = service.runIdempotentMutation(actorForPrincipal(principal), idempotencyKey, `${route}.${toggle}`, hashJson(input), resourceId, () => update(req, input.active));
      sendData(res, 200, result.data, req.requestId, { configurationRevision: service.getConfigurationRevision(), idempotentReplay: result.idempotentReplay });
    }));
  }
}

function registerAdminToggleRoutes(
  router: Router,
  route: string,
  middleware: RequestHandler[],
  update: (req: Request, active: boolean) => unknown,
  service: HotelService
): void {
  for (const toggle of ['activate', 'deactivate'] as const) {
    router.post(`${route}/${toggle}`, middleware, asyncHandler(async (req, res) => {
      const idempotencyKey = requireMutationKey(req);
      const principal = getAdminPrincipal(req);
      const resourceId = routeParam(req.params['id'], 'id');
      const input = { active: toggle === 'activate' };
      const result = service.runIdempotentMutation(actorForPrincipal(principal), idempotencyKey, `${route}.${toggle}`, hashJson(input), resourceId, () => update(req, input.active));
      sendData(res, 200, result.data, req.requestId, { idempotentReplay: result.idempotentReplay });
    }));
  }
}

function asyncHandler(handler: (req: Request, res: Response, next: NextFunction) => unknown): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export interface HttpErrorLogRecord {
  event: 'http.error';
  requestId: string;
  method: string;
  route: string;
  status: number;
  code: string;
  errorClass: 'AppError' | 'ZodError' | 'PayloadTooLargeError' | 'SyntaxError' | 'TypeError' | 'Error' | 'NonErrorThrown';
  severity: 'warn' | 'error';
  validation?: HttpValidationLogMetadata;
}

interface HttpValidationLogMetadata {
  issueCount: number;
  omittedIssueCount: number;
  issues: Array<{
    fieldPath: 'requestBody' | 'unlistedField' | 'expectedVersion' | 'responsibleName' | 'headers.idempotency-key' | 'routeParams.requestId';
    code: string;
    category: 'type' | 'minimum' | 'maximum' | 'unknown_fields' | 'custom' | 'invalid_value' | 'required' | 'constraint' | 'other';
  }>;
}

const MUTATION_KEY_VALIDATION_MESSAGE = 'Idempotency-Key must contain 1 to 128 characters.';
const REQUEST_ID_REQUIRED_MESSAGE = 'requestId is required.';
const RESPONSIBLE_NAME_REQUIRED_MESSAGE = 'A responsible name is required when starting a request.';
const RESPONSIBLE_NAME_LENGTH_MESSAGE = 'A responsible name must contain between 1 and 120 characters.';
const MAX_LOGGED_VALIDATION_ISSUES = 12;
const SAFE_VALIDATION_FIELD_PATHS = new Set(['expectedVersion', 'responsibleName']);
const SAFE_ZOD_ISSUE_CATEGORIES: Readonly<Record<string, HttpValidationLogMetadata['issues'][number]['category']>> = {
  invalid_type: 'type',
  too_small: 'minimum',
  too_big: 'maximum',
  unrecognized_keys: 'unknown_fields',
  custom: 'custom',
  invalid_literal: 'invalid_value',
  invalid_enum_value: 'invalid_value',
  invalid_union: 'invalid_value',
  invalid_union_discriminator: 'invalid_value',
  invalid_string: 'invalid_value',
  invalid_date: 'invalid_value',
  not_multiple_of: 'invalid_value'
};
const validationLogMetadataByError = new WeakMap<AppError, HttpValidationLogMetadata>();

type HttpErrorLogSink = (record: HttpErrorLogRecord) => void;

const errorHandler = createHttpErrorHandler();

export function createHttpErrorHandler(logError: HttpErrorLogSink = writeHttpErrorLog): ErrorRequestHandler {
  return (error: unknown, req, res, _next) => {
    const requestId = req.requestId;
    const response = describeHttpError(error);
    const record: HttpErrorLogRecord = {
      event: 'http.error',
      requestId,
      method: req.method,
      route: getRouteTemplate(req),
      status: response.statusCode,
      code: response.code,
      errorClass: getSafeErrorClass(error),
      severity: response.statusCode >= 500 ? 'error' : 'warn'
    };
    const validation = getValidationLogMetadata(error);
    if (validation !== undefined) record.validation = validation;
    try {
      logError(record);
    } catch {
      // Diagnostics must not prevent the original HTTP error response.
    }

    if (isAppError(error)) {
      res.status(error.statusCode).json({ error: { code: error.code, message: error.message, details: error.details, requestId } });
      return;
    }
    if (error instanceof z.ZodError) {
      res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'Request validation failed.', details: error.flatten(), requestId } });
      return;
    }
    if (isPayloadTooLargeError(error)) {
      res.status(413).json({ error: { code: 'VALIDATION_ERROR', message: 'Request body is too large.', requestId } });
      return;
    }
    if (error instanceof SyntaxError) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Request body contains invalid JSON.', requestId } });
      return;
    }
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected server error occurred.', requestId } });
  };
}

function describeHttpError(error: unknown): { statusCode: number; code: string } {
  if (isAppError(error)) return { statusCode: error.statusCode, code: error.code };
  if (error instanceof z.ZodError || error instanceof SyntaxError) return { statusCode: error instanceof SyntaxError ? 400 : 422, code: 'VALIDATION_ERROR' };
  if (isPayloadTooLargeError(error)) return { statusCode: 413, code: 'VALIDATION_ERROR' };
  return { statusCode: 500, code: 'INTERNAL_ERROR' };
}

function getValidationLogMetadata(error: unknown): HttpValidationLogMetadata | undefined {
  if (error instanceof z.ZodError) return summarizeValidationIssues(error.issues);
  if (isAppError(error)) {
    return validationLogMetadataByError.get(error) ?? getKnownAppValidationMetadata(error);
  }
  return undefined;
}

function getKnownAppValidationMetadata(error: AppError): HttpValidationLogMetadata | undefined {
  if (error.code !== 'VALIDATION_ERROR') return undefined;
  switch (error.message) {
    case MUTATION_KEY_VALIDATION_MESSAGE:
      return createSingleValidationMetadata('headers.idempotency-key', 'length_1_to_128', 'constraint');
    case REQUEST_ID_REQUIRED_MESSAGE:
      return createSingleValidationMetadata('routeParams.requestId', 'required', 'required');
    case RESPONSIBLE_NAME_REQUIRED_MESSAGE:
      return createSingleValidationMetadata('responsibleName', 'required', 'required');
    case RESPONSIBLE_NAME_LENGTH_MESSAGE:
      return createSingleValidationMetadata('responsibleName', 'length_1_to_120', 'constraint');
    default:
      return undefined;
  }
}

function createSingleValidationMetadata(
  fieldPath: 'responsibleName' | 'headers.idempotency-key' | 'routeParams.requestId',
  code: string,
  category: 'required' | 'constraint'
): HttpValidationLogMetadata {
  return {
    issueCount: 1,
    omittedIssueCount: 0,
    issues: [{ fieldPath, code, category }]
  };
}

function summarizeValidationIssues(issues: readonly z.ZodIssue[]): HttpValidationLogMetadata {
  const loggedIssues = issues.slice(0, MAX_LOGGED_VALIDATION_ISSUES).map((issue) => {
    const category = Object.prototype.hasOwnProperty.call(SAFE_ZOD_ISSUE_CATEGORIES, issue.code)
      ? SAFE_ZOD_ISSUE_CATEGORIES[issue.code] ?? 'other'
      : 'other';
    return {
      fieldPath: getSafeValidationFieldPath(issue.path),
      code: category === 'other' ? 'other' : issue.code,
      category
    };
  });
  return {
    issueCount: issues.length,
    omittedIssueCount: Math.max(0, issues.length - loggedIssues.length),
    issues: loggedIssues
  };
}

function getSafeValidationFieldPath(path: readonly PropertyKey[]): HttpValidationLogMetadata['issues'][number]['fieldPath'] {
  if (path.length === 0) return 'requestBody';
  const root = path[0];
  if (typeof root === 'string' && SAFE_VALIDATION_FIELD_PATHS.has(root)) {
    return root as 'expectedVersion' | 'responsibleName';
  }
  return 'unlistedField';
}

function getSafeErrorClass(error: unknown): HttpErrorLogRecord['errorClass'] {
  if (isAppError(error)) return 'AppError';
  if (error instanceof z.ZodError) return 'ZodError';
  if (isPayloadTooLargeError(error)) return 'PayloadTooLargeError';
  if (error instanceof SyntaxError) return 'SyntaxError';
  if (error instanceof TypeError) return 'TypeError';
  return error instanceof Error ? 'Error' : 'NonErrorThrown';
}

function getRouteTemplate(req: Request): string {
  const route = req.route?.path;
  if (typeof route === 'string') return route;
  if (Array.isArray(route)) return route.join('|');
  return 'unmatched';
}

function writeHttpErrorLog(record: HttpErrorLogRecord): void {
  const line = JSON.stringify(record);
  if (record.severity === 'error') console.error(line);
  else console.warn(line);
}

function isPayloadTooLargeError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.too.large';
}

const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(12).max(256)
}).strict();
