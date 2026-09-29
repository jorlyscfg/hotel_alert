import { describe, expect, it } from 'vitest';
import { assertLegalRequestTransition, canReadRequest, canTransitionRequest } from '../../apps/server/src/domain/policies';
import { assertIdempotencyKeyMatches, validateIdempotencyKey } from '../../apps/server/src/domain/idempotency';
import type { DevicePrincipal } from '../../apps/server/src/security/principal';
import type { AdminPrincipal } from '../../apps/server/src/security/principal';

const roomPrincipal: DevicePrincipal = {
  kind: 'DEVICE', actorType: 'DEVICE', deviceId: 'dev-room', assignmentMode: 'ROOM', roomId: 'room-1', areaId: null
};
const areaPrincipal: DevicePrincipal = {
  kind: 'DEVICE', actorType: 'DEVICE', deviceId: 'dev-area', assignmentMode: 'AREA', roomId: null, areaId: 'area-1'
};
const adminPrincipal: AdminPrincipal = {
  kind: 'ADMIN', actorType: 'ADMIN', adminId: 'admin-1'
};

describe('server authorization and request policy', () => {
  it('allows direct processing and rejects backward request transitions', () => {
    expect(() => assertLegalRequestTransition('PENDING', 'IN_PROGRESS')).not.toThrow();
    expect(() => assertLegalRequestTransition('COMPLETED', 'PENDING')).toThrowError(/Cannot transition/);
    expect(() => assertLegalRequestTransition('PENDING', 'ACCEPTED')).not.toThrow();
  });

  it('isolates room reads and area transitions to their assigned scope', () => {
    const request = { roomId: 'room-1', responsibleAreaId: 'area-1', status: 'PENDING' as const };
    expect(canReadRequest(roomPrincipal, request)).toBe(true);
    expect(canTransitionRequest(roomPrincipal, request)).toBe(false);
    expect(canTransitionRequest(areaPrincipal, request)).toBe(true);
    expect(canTransitionRequest(adminPrincipal, request)).toBe(false);
    expect(canReadRequest({ ...areaPrincipal, areaId: 'area-2' }, request)).toBe(false);
  });

  it('accepts a stable key only for the original operation and body hash', () => {
    expect(() => validateIdempotencyKey('room-intent-1')).not.toThrow();
    expect(() => validateIdempotencyKey('')).toThrowError(/Idempotency-Key/);
    expect(() => assertIdempotencyKeyMatches('create-request', 'hash-a', 'create-request', 'hash-a')).not.toThrow();
    expect(() => assertIdempotencyKeyMatches('create-request', 'hash-a', 'accept-request', 'hash-a')).toThrowError(/reuse/);
    expect(() => assertIdempotencyKeyMatches('create-request', 'hash-a', 'create-request', 'hash-b')).toThrowError(/reuse/);
  });
});
