import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdminLoginResult, DeviceSyncSnapshot } from '@hotel/shared';
import {
  buildDeviceAssignmentPayload,
  buildLocalDeviceSyncState,
  completeDeviceTokenRotation,
  parseAdminSession,
  DEVICE_PENDING_TOKEN_ROTATION_STORAGE_KEY,
  ADMIN_SESSION_STORAGE_KEY,
  DEVICE_TOKEN_STORAGE_KEY,
  formatElapsed,
  formatElapsedWithAgo,
  getDeviceMode,
  getOrCreateInstallationId,
  makeMutationKey,
  mutationSucceeded,
  parseLocalDeviceSyncState,
  parseLocalDeviceSnapshot,
  readLocalDeviceSnapshot,
  resolveStartupRetryDelayMs,
  serializeLocalDeviceSnapshot,
  serializeLocalDeviceSyncState,
  serializeAdminSession,
  shouldRetryStartup
} from '../../apps/web/src/app-model';

describe('web application model helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('formats request age for operational cards', () => {
    const now = new Date('2026-08-31T12:05:00.000Z');

    expect(formatElapsed('2026-08-31T12:05:00.000Z', now)).toBe('just now');
    expect(formatElapsed('2026-08-31T12:03:00.000Z', now)).toBe('2m');
    expect(formatElapsed('2026-08-31T10:00:00.000Z', now)).toBe('2h 5m');
  });

  it('places localized elapsed-time suffixes naturally', () => {
    const now = new Date('2026-08-31T12:05:00.000Z');

    expect(formatElapsedWithAgo('2026-08-31T12:05:00.000Z', now, 'en', 'ago')).toBe('just now');
    expect(formatElapsedWithAgo('2026-08-31T12:03:00.000Z', now, 'en', 'ago')).toBe('2m ago');
    expect(formatElapsedWithAgo('2026-08-31T12:03:00.000Z', now, 'es', 'hace')).toBe('hace 2 min');
  });

  it('derives the operational mode from the authoritative assignment', () => {
    expect(getDeviceMode({ assignmentMode: 'ROOM' })).toBe('ROOM');
    expect(getDeviceMode({ assignmentMode: 'AREA' })).toBe('AREA');
  });

  it('creates opaque mutation keys with an operation prefix', () => {
    const key = makeMutationKey('request');

    expect(key).toMatch(/^request-/);
    expect(key.length).toBeGreaterThan(20);
  });

  it('uses Web Crypto randomness when randomUUID is unavailable', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string): string | null => values.get(key) ?? null,
      setItem: (key: string, value: string): void => { values.set(key, value); },
      removeItem: (key: string): void => { values.delete(key); }
    });
    vi.stubGlobal('crypto', {
      getRandomValues: (target: Uint8Array): Uint8Array => {
        target.set(Uint8Array.from({ length: target.length }, (_, index) => index));
        return target;
      }
    });

    expect(getOrCreateInstallationId()).toBe('install-00010203-0405-4607-8809-0a0b0c0d0e0f');
    expect(makeMutationKey('logout')).toBe('logout-00010203-0405-4607-8809-0a0b0c0d0e0f');
  });

  it('builds an assignment payload with only the selected target', () => {
    expect(buildDeviceAssignmentPayload({ deviceConfigVersion: 3 }, {
      assignmentMode: 'AREA',
      roomId: 'room-1',
      areaId: 'area-2',
      reason: 'Move the console'
    })).toEqual({
      assignmentMode: 'AREA',
      roomId: null,
      areaId: 'area-2',
      expectedDeviceConfigVersion: 3,
      reason: 'Move the console'
    });
  });

  it('only treats a completed API mutation as successful', () => {
    expect(mutationSucceeded(null)).toBe(false);
    expect(mutationSucceeded({ data: undefined })).toBe(true);
  });

  it('serializes only the non-cookie portion of an admin session for browser-session persistence', () => {
    const session: { result: AdminLoginResult; installationId: string | null } = {
      result: {
        admin: { id: 'admin-1', username: 'admin', expiresAt: '2026-09-01T00:00:00.000Z' },
        csrfToken: 'csrf-token'
      },
      installationId: 'installation-1'
    };

    const raw = serializeAdminSession(session);

    expect(ADMIN_SESSION_STORAGE_KEY).toBe('hotel-local-admin-session');
    expect(parseAdminSession(raw)).toEqual(session);
    expect(parseAdminSession('{"result":{"csrfToken":""}}')).toBeNull();
    expect(parseAdminSession('{"result":{"admin":{"id":"admin-1","username":"admin","expiresAt":"2026-09-01T00:00:00.000Z"},"csrfToken":"csrf-token"},"installationId":42}')).toBeNull();
  });

  it('persists a pending station role while onboarding survives a reload', () => {
    const session = {
      result: {
        admin: { id: 'admin-1', username: 'admin', expiresAt: '2026-09-01T00:00:00.000Z' },
        csrfToken: 'csrf-token'
      },
      installationId: 'installation-1',
      pendingStationRole: 'AREA'
    } as Parameters<typeof serializeAdminSession>[0] & { pendingStationRole: 'AREA' };

    expect(parseAdminSession(serializeAdminSession(session))).toEqual(session);
    expect(parseAdminSession(`${serializeAdminSession(session).slice(0, -1)},"pendingStationRole":"ADMIN"}`)).toBeNull();
  });

  it('continues automatic startup retries with capped exponential delays', () => {
    expect(resolveStartupRetryDelayMs(0)).toBe(250);
    expect(resolveStartupRetryDelayMs(1)).toBe(500);
    expect(resolveStartupRetryDelayMs(2)).toBe(1000);
    expect(resolveStartupRetryDelayMs(20)).toBe(10_000);
    expect(shouldRetryStartup(0)).toBe(true);
    expect(shouldRetryStartup(1)).toBe(true);
    expect(shouldRetryStartup(2)).toBe(true);
    expect(shouldRetryStartup(20)).toBe(true);
    expect(shouldRetryStartup(-1)).toBe(false);
    expect(shouldRetryStartup(1.5)).toBe(false);
    expect(shouldRetryStartup(Number.NaN)).toBe(false);
    expect(shouldRetryStartup(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('serializes and validates the latest authoritative device cursor', () => {
    const state = buildLocalDeviceSyncState('device-1', {
      lastSeenEventSequence: 19,
      configurationRevision: 7,
      deviceConfigVersion: 4
    });

    expect(JSON.parse(serializeLocalDeviceSyncState(state))).toEqual(state);
    expect(parseLocalDeviceSyncState(serializeLocalDeviceSyncState(state), 'device-1')).toEqual(state);
    expect(parseLocalDeviceSyncState(serializeLocalDeviceSyncState(state), 'device-2')).toBeNull();
    expect(parseLocalDeviceSyncState('{"deviceId":"device-1"}', 'device-1')).toBeNull();
  });

  it('serializes and validates a cached device snapshot for offline startup', () => {
    const snapshot: DeviceSyncSnapshot = {
      snapshotSequence: 19,
      currentEventSequence: 19,
      configurationRevision: 7,
      deviceConfigVersion: 4,
      serverTime: '2026-08-31T12:05:00.000Z',
      device: {
        id: 'device-1',
        installationId: 'installation-1',
        displayName: 'Room 101 tablet',
        assignmentMode: 'ROOM',
        roomId: 'room-1',
        areaId: null,
        active: true,
        deviceConfigVersion: 4,
        lastHeartbeatAt: null,
        presence: 'OFFLINE'
      },
       config: {
         mode: 'ROOM',
          room: { id: 'room-1', code: '101', displayName: 'Room 101', doNotDisturb: false },
         area: null,
         hotelName: 'Hotel Local',
         hotelLogo: null,
         roomBackground: null,
         clockFormat: '12h',
         services: [],
        offlineQueueTtlHours: 48,
        heartbeatIntervalMs: 15000,
        heartbeatStaleAfterMs: 45000,
        heartbeatOfflineAfterMs: 90000,
        pendingAlertIntervalMs: 5000
      },
      activeRequests: [],
      pendingTokenRotation: null
    };

    const raw = serializeLocalDeviceSnapshot(snapshot);
    const storage = { getItem: (key: string): string | null => key === 'hotel-local-device-snapshot' ? raw : null };

    expect(parseLocalDeviceSnapshot(raw, 'device-1')).toEqual(snapshot);
    expect(parseLocalDeviceSnapshot(raw, 'device-2')).toBeNull();
    expect(parseLocalDeviceSnapshot('{"device":{"id":"device-1"}}', 'device-1')).toBeNull();

    const activeDoNotDisturbRooms = [{ id: 'room-2', code: '202', displayName: 'Room 202', doNotDisturb: true }];
    const legacyDoNotDisturbSnapshot = { ...snapshot, activeDoNotDisturbRooms };
    expect(parseLocalDeviceSnapshot(JSON.stringify(legacyDoNotDisturbSnapshot), 'device-1')?.activeDoNotDisturbRooms)
      .toEqual(activeDoNotDisturbRooms);
    expect(parseLocalDeviceSnapshot(JSON.stringify({
      ...snapshot,
      activeDoNotDisturbRooms: [{ ...activeDoNotDisturbRooms[0], doNotDisturbActivatedAt: null }]
    }), 'device-1')?.activeDoNotDisturbRooms?.[0]?.doNotDisturbActivatedAt).toBeNull();
    expect(parseLocalDeviceSnapshot(JSON.stringify({
      ...snapshot,
      activeDoNotDisturbRooms: [{ ...activeDoNotDisturbRooms[0], doNotDisturbActivatedAt: '2026-08-31T11:00:00.000Z' }]
    }), 'device-1')?.activeDoNotDisturbRooms?.[0]?.doNotDisturbActivatedAt).toBe('2026-08-31T11:00:00.000Z');
    expect(parseLocalDeviceSnapshot(JSON.stringify({
      ...snapshot,
      activeDoNotDisturbRooms: [{ ...activeDoNotDisturbRooms[0], doNotDisturbActivatedAt: 1_788_184_800_000 }]
    }), 'device-1')).toBeNull();

    const missingRoomBackground = {
      ...snapshot,
      config: Object.fromEntries(Object.entries(snapshot.config).filter(([key]) => key !== 'roomBackground'))
    };
    expect(parseLocalDeviceSnapshot(JSON.stringify(missingRoomBackground), 'device-1')).toBeNull();

    const cachedResponsiveBackground = JSON.stringify({
      ...snapshot,
      config: {
        ...snapshot.config,
        roomBackground: {
          square480: 'data:image/webp;base64,SQUARE',
          tablet: 'data:image/webp;base64,TABLET'
        }
      }
    });
    expect(parseLocalDeviceSnapshot(cachedResponsiveBackground, 'device-1')).not.toBeNull();

    expect(readLocalDeviceSnapshot(storage, 'device-1')).toEqual(snapshot);
    expect(readLocalDeviceSnapshot(storage, null)).toBeNull();

    const missingDoNotDisturb = {
      ...snapshot,
      config: { ...snapshot.config, room: { id: 'room-1', code: '101', displayName: 'Room 101' } }
    };
    expect(parseLocalDeviceSnapshot(JSON.stringify(missingDoNotDisturb), 'device-1')).toBeNull();

    const missingServiceIcon = {
      ...snapshot,
      activeRequests: [{
        id: 'request-1',
        roomId: 'room-1',
        serviceId: 'service-1',
        responsibleAreaId: 'area-1',
        room: { id: 'room-1', code: '101', displayName: 'Room 101', doNotDisturb: false },
        service: { id: 'service-1', code: 'towels', displayName: 'Fresh towels' },
        responsibleArea: { id: 'area-1', code: 'housekeeping', displayName: 'Housekeeping' },
        status: 'PENDING',
        version: 1,
        createdAt: '2026-08-31T12:05:00.000Z',
        acceptedAt: null,
        inProgressAt: null,
        completedAt: null,
        updatedAt: '2026-08-31T12:05:00.000Z'
      }]
    };
    expect(parseLocalDeviceSnapshot(JSON.stringify(missingServiceIcon), 'device-1')).toBeNull();

    const namedAreas = {
      ...snapshot,
      config: {
        ...snapshot.config,
        areas: [{ id: 'area-1', code: 'housekeeping', displayName: 'Housekeeping' }]
      }
    };
    expect(parseLocalDeviceSnapshot(JSON.stringify(namedAreas), 'device-1')?.config.areas).toEqual(namedAreas.config.areas);

    const malformedAreas = {
      ...namedAreas,
      config: {
        ...namedAreas.config,
        areas: [{ id: 'area-1', code: 'housekeeping', displayName: '' }]
      }
    };
    expect(parseLocalDeviceSnapshot(JSON.stringify(malformedAreas), 'device-1')).toBeNull();
  });

  it('persists a claimed replacement before acknowledging the rotation', async () => {
    const values = new Map<string, string>([[DEVICE_TOKEN_STORAGE_KEY, 'old-token']]);
    const storage = {
      getItem: (key: string): string | null => values.get(key) ?? null,
      setItem: (key: string, value: string): void => { values.set(key, value); },
      removeItem: (key: string): void => { values.delete(key); }
    };
    const calls: string[] = [];
    const replacement = { rotationId: 'rotation-1', deviceToken: 'new-token' };

    const result = await completeDeviceTokenRotation({ rotationId: 'rotation-1' }, 'old-token', {
      claim: async (rotationId, token) => {
        calls.push(`claim:${rotationId}:${token}`);
        return replacement;
      },
      acknowledge: async (rotationId, token) => {
        calls.push(`acknowledge:${rotationId}:${token}`);
        expect(storage.getItem(DEVICE_PENDING_TOKEN_ROTATION_STORAGE_KEY)).toBe(JSON.stringify(replacement));
      }
    }, storage, async (token) => { calls.push(`stage-native:${token}`); });

    expect(result).toBe('new-token');
    expect(calls).toEqual(['claim:rotation-1:old-token', 'stage-native:new-token', 'acknowledge:rotation-1:new-token']);
    expect(values.get(DEVICE_TOKEN_STORAGE_KEY)).toBe('new-token');
    expect(values.has(DEVICE_PENDING_TOKEN_ROTATION_STORAGE_KEY)).toBe(false);
  });

  it('reuses a persisted replacement when acknowledgement is retried', async () => {
    const replacement = { rotationId: 'rotation-1', deviceToken: 'new-token' };
    const values = new Map<string, string>([
      [DEVICE_TOKEN_STORAGE_KEY, 'old-token'],
      [DEVICE_PENDING_TOKEN_ROTATION_STORAGE_KEY, JSON.stringify(replacement)]
    ]);
    const storage = {
      getItem: (key: string): string | null => values.get(key) ?? null,
      setItem: (key: string, value: string): void => { values.set(key, value); },
      removeItem: (key: string): void => { values.delete(key); }
    };
    let claimed = false;

    const result = await completeDeviceTokenRotation({ rotationId: 'rotation-1' }, 'old-token', {
      claim: async () => {
        claimed = true;
        return replacement;
      },
      acknowledge: async (_rotationId, token) => {
        expect(token).toBe('new-token');
      }
    }, storage);

    expect(result).toBe('new-token');
    expect(claimed).toBe(false);
    expect(values.get(DEVICE_TOKEN_STORAGE_KEY)).toBe('new-token');
    expect(values.has(DEVICE_PENDING_TOKEN_ROTATION_STORAGE_KEY)).toBe(false);
  });

  it('keeps the old token and pending replacement when acknowledgement fails', async () => {
    const values = new Map<string, string>([[DEVICE_TOKEN_STORAGE_KEY, 'old-token']]);
    const storage = {
      getItem: (key: string): string | null => values.get(key) ?? null,
      setItem: (key: string, value: string): void => { values.set(key, value); },
      removeItem: (key: string): void => { values.delete(key); }
    };

    await expect(completeDeviceTokenRotation({ rotationId: 'rotation-1' }, 'old-token', {
      claim: async () => ({ rotationId: 'rotation-1', deviceToken: 'new-token' }),
      acknowledge: async () => { throw new Error('acknowledgement failed'); }
    }, storage)).rejects.toThrow('acknowledgement failed');

    expect(values.get(DEVICE_TOKEN_STORAGE_KEY)).toBe('old-token');
    expect(values.get(DEVICE_PENDING_TOKEN_ROTATION_STORAGE_KEY)).toBe(JSON.stringify({ rotationId: 'rotation-1', deviceToken: 'new-token' }));
  });

  it('does not acknowledge a rotation until the native ROOM replacement is staged', async () => {
    const values = new Map<string, string>([[DEVICE_TOKEN_STORAGE_KEY, 'old-token']]);
    const storage = {
      getItem: (key: string): string | null => values.get(key) ?? null,
      setItem: (key: string, value: string): void => { values.set(key, value); },
      removeItem: (key: string): void => { values.delete(key); }
    };
    const acknowledge = vi.fn(async () => undefined);

    await expect(completeDeviceTokenRotation({ rotationId: 'rotation-1' }, 'old-token', {
      claim: async () => ({ rotationId: 'rotation-1', deviceToken: 'new-token' }),
      acknowledge
    }, storage, async () => { throw new Error('native secure store unavailable'); })).rejects.toThrow('native secure store unavailable');

    expect(acknowledge).not.toHaveBeenCalled();
    expect(values.get(DEVICE_TOKEN_STORAGE_KEY)).toBe('old-token');
    expect(values.get(DEVICE_PENDING_TOKEN_ROTATION_STORAGE_KEY)).toBe(JSON.stringify({ rotationId: 'rotation-1', deviceToken: 'new-token' }));
  });
});
