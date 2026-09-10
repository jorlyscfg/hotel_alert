import { adminCreateSchema, deviceCreateSchema, idempotencyKeySchema, roomCreateSchema, roomDoNotDisturbSchema, roomPatchSchema } from '@hotel/shared';

describe('input validation', () => {
  it('requires a strong administrator password and rejects unknown fields', () => {
    expect(adminCreateSchema.safeParse({ username: 'admin', password: 'short' }).success).toBe(false);
    expect(adminCreateSchema.safeParse({ username: 'admin', password: 'correct horse battery', extra: true }).success).toBe(false);
  });

  it('rejects a device that supplies both assignment identities', () => {
    expect(deviceCreateSchema.safeParse({
      installationId: 'install-1',
      displayName: 'Tablet',
      assignmentMode: 'ROOM',
      roomId: 'room-1',
      areaId: 'area-1'
    }).success).toBe(false);

    expect(deviceCreateSchema.safeParse({
      installationId: 'install-1',
      displayName: 'Tablet',
      assignmentMode: 'AREA',
      areaId: 'area-1'
    }).success).toBe(true);
  });

  it('bounds idempotency keys', () => {
    expect(idempotencyKeySchema.safeParse('').success).toBe(false);
    expect(idempotencyKeySchema.safeParse('room-intent-1').success).toBe(true);
    expect(idempotencyKeySchema.safeParse('x'.repeat(129)).success).toBe(false);
  });

  it('accepts a boolean do-not-disturb room field and rejects non-boolean values', () => {
    expect(roomCreateSchema.safeParse({ code: '101', displayName: 'Room 101', doNotDisturb: true }).success).toBe(true);
    expect(roomPatchSchema.safeParse({ doNotDisturb: false }).success).toBe(true);
    expect(roomDoNotDisturbSchema.safeParse({ doNotDisturb: true }).success).toBe(true);
    expect(roomDoNotDisturbSchema.safeParse({ doNotDisturb: 'true' }).success).toBe(false);
  });
});
