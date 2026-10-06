import { adminCreateSchema, deviceCreateSchema, idempotencyKeySchema, requestStartSchema, requestTransitionSchema, roomCreateSchema, roomDoNotDisturbSchema, roomPatchSchema, settingsPatchSchema } from '@hotel/shared';

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

  it('accepts decimal coordinates and a time-zone identifier in the settings patch contract', () => {
    expect(settingsPatchSchema.safeParse({
      changes: {
        timeZone: 'America/Cancun',
        weatherLocationName: 'Playa del Carmen',
        weatherLatitude: 20.6275,
        weatherLongitude: -87.0799
      }
    }).success).toBe(true);
  });

  it('accepts a boolean do-not-disturb room field and rejects non-boolean values', () => {
    expect(roomCreateSchema.safeParse({ code: '101', displayName: 'Room 101', doNotDisturb: true }).success).toBe(true);
    expect(roomPatchSchema.safeParse({ doNotDisturb: false }).success).toBe(true);
    expect(roomDoNotDisturbSchema.safeParse({ doNotDisturb: true }).success).toBe(true);
    expect(roomDoNotDisturbSchema.safeParse({ doNotDisturb: 'true' }).success).toBe(false);
  });

  it('requires a trimmed, bounded responsible name only for request starts', () => {
    expect(requestStartSchema.safeParse({ expectedVersion: 2, responsibleName: '  Ana López  ' })).toMatchObject({
      success: true,
      data: { expectedVersion: 2, responsibleName: 'Ana López' }
    });
    expect(requestStartSchema.safeParse({ expectedVersion: 2 }).success).toBe(false);
    expect(requestStartSchema.safeParse({ expectedVersion: 2, responsibleName: '   ' }).success).toBe(false);
    expect(requestStartSchema.safeParse({ expectedVersion: 2, responsibleName: 'x'.repeat(121) }).success).toBe(false);
    expect(requestTransitionSchema.safeParse({ expectedVersion: 2 }).success).toBe(true);
    expect(requestTransitionSchema.safeParse({ expectedVersion: 2, responsibleName: 'Ana' }).success).toBe(false);
  });
});
