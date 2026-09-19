import type {
  DurableRealtimeEvent,
  RequestCreatedPayload,
  RequestDTO,
  RequestUpdatedPayload
} from '@hotel/shared';
import { describe, expect, it } from 'vitest';
import {
  createNotificationReceiver,
  type DurableCursorStore,
  type RequestNotification
} from '../../packages/notification-receiver/src';

type RequestCreatedEvent = DurableRealtimeEvent<'request.created', RequestCreatedPayload>;
type RequestUpdatedEvent = DurableRealtimeEvent<'request.updated', RequestUpdatedPayload>;

const malformedOptionalRequestFields: Array<[string, (request: RequestDTO) => unknown]> = [
  ['createdByDeviceId', (request) => ({ ...request, createdByDeviceId: 123 })],
  ['room.displayNameVariants', (request) => ({ ...request, room: { ...request.room, displayNameVariants: { en: 123 } } })],
  ['service.displayNameVariants', (request) => ({ ...request, service: { ...request.service, displayNameVariants: { en: false } } })],
  ['responsibleArea.displayNameVariants', (request) => ({ ...request, responsibleArea: { ...request.responsibleArea, displayNameVariants: { en: null } } })]
];

describe('notification receiver core', () => {
  it('delivers assigned request events only after synchronization and advances the durable cursor', async () => {
    const cursor = createCursor();
    const delivered: RequestNotification[] = [];
    const receiver = createNotificationReceiver({
      assignedAreaId: 'area-housekeeping',
      cursor,
      sink: { deliver: (notification) => delivered.push(notification) }
    });
    const created = createRequestCreatedEvent({ eventId: 'event-created', eventSequence: 11, version: 1 });
    const updated = createRequestUpdatedEvent({ eventId: 'event-updated', eventSequence: 12, version: 2 });

    await receiver.handle(created, { synchronized: false });
    expect(delivered).toHaveLength(0);
    expect(cursor.writes).toEqual([]);

    await receiver.handle(created, { synchronized: true });
    await receiver.handle(updated, { synchronized: true });

    expect(delivered.map((notification) => notification.eventName)).toEqual(['request.created', 'request.updated']);
    expect(delivered[1]?.request.version).toBe(2);
    expect(cursor.writes).toEqual([11, 12]);
    expect(cursor.lastSeenEventSequence).toBe(12);
  });

  it('filters requests outside the assigned area without replaying them forever', async () => {
    const cursor = createCursor();
    const delivered: RequestNotification[] = [];
    const receiver = createNotificationReceiver({
      assignedAreaId: 'area-housekeeping',
      cursor,
      sink: { deliver: (notification) => delivered.push(notification) }
    });

    const result = await receiver.handle(
      createRequestCreatedEvent({ eventId: 'event-maintenance', eventSequence: 21, version: 1, areaId: 'area-maintenance' }),
      { synchronized: true }
    );

    expect(result).toMatchObject({ outcome: 'ignored', reason: 'unassigned-area', cursorAdvanced: true });
    expect(delivered).toHaveLength(0);
    expect(cursor.writes).toEqual([21]);
  });

  it('suppresses duplicate, out-of-order, and older aggregate versions', async () => {
    const cursor = createCursor(10);
    const delivered: RequestNotification[] = [];
    const receiver = createNotificationReceiver({
      assignedAreaId: 'area-housekeeping',
      cursor,
      sink: { deliver: (notification) => delivered.push(notification) }
    });

    const current = createRequestCreatedEvent({ eventId: 'event-v2', eventSequence: 12, version: 2 });
    const duplicate = createRequestCreatedEvent({ eventId: 'event-v2', eventSequence: 12, version: 2 });
    const older = createRequestCreatedEvent({ eventId: 'event-v1-replayed', eventSequence: 13, version: 1 });
    const outOfOrder = createRequestCreatedEvent({ eventId: 'event-late', eventSequence: 11, version: 3 });

    await receiver.handle(current, { synchronized: true });
    const duplicateResult = await receiver.handle(duplicate, { synchronized: true });
    const olderResult = await receiver.handle(older, { synchronized: true });
    const outOfOrderResult = await receiver.handle(outOfOrder, { synchronized: true });

    expect(duplicateResult).toMatchObject({ outcome: 'ignored', reason: 'duplicate', cursorAdvanced: false });
    expect(olderResult).toMatchObject({ outcome: 'ignored', reason: 'older-aggregate-version', cursorAdvanced: true });
    expect(outOfOrderResult).toMatchObject({ outcome: 'ignored', reason: 'out-of-order', cursorAdvanced: false });
    expect(delivered.map((notification) => notification.eventId)).toEqual(['event-v2']);
    expect(cursor.writes).toEqual([12, 13]);
  });

  it('does not advance the cursor when the notification sink cannot accept an event', async () => {
    const cursor = createCursor();
    let attempts = 0;
    const receiver = createNotificationReceiver({
      assignedAreaId: 'area-housekeeping',
      cursor,
      sink: {
        deliver: () => {
          attempts += 1;
          if (attempts === 1) throw new Error('sink unavailable');
        }
      }
    });
    const event = createRequestCreatedEvent({ eventId: 'event-retry', eventSequence: 31, version: 1 });

    await expect(receiver.handle(event, { synchronized: true })).rejects.toThrow('sink unavailable');
    expect(cursor.writes).toEqual([]);

    await receiver.handle(event, { synchronized: true });
    expect(cursor.writes).toEqual([31]);
  });

  it('rejects queued later events behind a failed sink event and allows retrying the failed event', async () => {
    const cursor = createCursor();
    const delivered: RequestNotification[] = [];
    const failedEvent = createRequestCreatedEvent({ eventId: 'event-retry-queued', eventSequence: 32, version: 1 });
    const laterEvent = createRequestUpdatedEvent({ eventId: 'event-after-failure', eventSequence: 33, version: 2 });
    let failedEventAttempts = 0;
    const receiver = createNotificationReceiver({
      assignedAreaId: 'area-housekeeping',
      cursor,
      sink: {
        deliver: (notification) => {
          if (notification.eventId === failedEvent.eventId && failedEventAttempts++ === 0) {
            throw new Error('sink unavailable');
          }
          delivered.push(notification);
        }
      }
    });

    const failedAttempt = receiver.handle(failedEvent, { synchronized: true });
    const queuedLaterAttempt = receiver.handle(laterEvent, { synchronized: true });

    await expect(failedAttempt).rejects.toThrow('sink unavailable');
    await expect(queuedLaterAttempt).rejects.toThrow('sink unavailable');
    expect(cursor.writes).toEqual([]);
    expect(delivered).toHaveLength(0);

    await receiver.handle(failedEvent, { synchronized: true });
    await receiver.handle(laterEvent, { synchronized: true });

    expect(delivered.map((notification) => notification.eventId)).toEqual([failedEvent.eventId, laterEvent.eventId]);
    expect(cursor.writes).toEqual([32, 33]);
  });

  it.each(malformedOptionalRequestFields)('rejects malformed optional request field: %s', async (_field, mutateRequest) => {
    const cursor = createCursor();
    const delivered: RequestNotification[] = [];
    const receiver = createNotificationReceiver({
      assignedAreaId: 'area-housekeeping',
      cursor,
      sink: { deliver: (notification) => delivered.push(notification) }
    });
    const event = createRequestCreatedEvent({ eventId: 'event-malformed-request', eventSequence: 35, version: 1 });
    const malformedEvent = {
      ...event,
      payload: { ...event.payload, request: mutateRequest(event.payload.request) }
    };

    const result = await receiver.handle(malformedEvent, { synchronized: true });

    expect(result).toMatchObject({ outcome: 'ignored', reason: 'unsupported-event', cursorAdvanced: false, cursorSequence: 0 });
    expect(delivered).toHaveLength(0);
    expect(cursor.writes).toEqual([]);
  });

  it('advances the cursor for synchronized valid unsupported durable events', async () => {
    const cursor = createCursor();
    const delivered: RequestNotification[] = [];
    const receiver = createNotificationReceiver({
      assignedAreaId: 'area-housekeeping',
      cursor,
      sink: { deliver: (notification) => delivered.push(notification) }
    });

    const event = {
      schemaVersion: 1,
      eventId: 'event-room-update',
      eventSequence: 41,
      name: 'room.updated',
      occurredAt: '2026-09-19T12:00:00.000Z',
      aggregateType: 'ROOM',
      aggregateId: 'room-101',
      payload: { room: {} }
    };
    const result = await receiver.handle(event, { synchronized: true });
    const duplicateResult = await receiver.handle(event, { synchronized: true });
    const outOfOrderResult = await receiver.handle(
      { ...event, eventId: 'event-room-update-late', eventSequence: 40 },
      { synchronized: true }
    );

    expect(result).toMatchObject({ outcome: 'ignored', reason: 'unsupported-event', cursorAdvanced: true });
    expect(duplicateResult).toMatchObject({ outcome: 'ignored', reason: 'duplicate', cursorAdvanced: false });
    expect(outOfOrderResult).toMatchObject({ outcome: 'ignored', reason: 'out-of-order', cursorAdvanced: false });
    expect(delivered).toHaveLength(0);
    expect(cursor.writes).toEqual([41]);
  });
});

function createCursor(initialSequence = 0): DurableCursorStore & { writes: number[] } {
  let lastSeenEventSequence = initialSequence;
  const writes: number[] = [];

  return {
    writes,
    get lastSeenEventSequence() {
      return lastSeenEventSequence;
    },
    advanceTo(eventSequence) {
      writes.push(eventSequence);
      lastSeenEventSequence = eventSequence;
    }
  };
}

function createRequestCreatedEvent(options: {
  eventId: string;
  eventSequence: number;
  version: number;
  areaId?: string;
}): RequestCreatedEvent {
  const request = createRequest(options.version, options.areaId);
  return {
    schemaVersion: 1,
    eventId: options.eventId,
    eventSequence: options.eventSequence,
    name: 'request.created',
    occurredAt: '2026-09-19T12:00:00.000Z',
    aggregateType: 'REQUEST',
    aggregateId: request.id,
    aggregateVersion: options.version,
    payload: {
      request,
      alert: { repeatUntil: 'ACCEPTED' }
    }
  };
}

function createRequestUpdatedEvent(options: {
  eventId: string;
  eventSequence: number;
  version: number;
  areaId?: string;
}): RequestUpdatedEvent {
  const request = createRequest(options.version, options.areaId, 'ACCEPTED');
  return {
    schemaVersion: 1,
    eventId: options.eventId,
    eventSequence: options.eventSequence,
    name: 'request.updated',
    occurredAt: '2026-09-19T12:01:00.000Z',
    aggregateType: 'REQUEST',
    aggregateId: request.id,
    aggregateVersion: options.version,
    payload: {
      request,
      transition: {
        from: 'PENDING',
        to: 'ACCEPTED',
        actorType: 'DEVICE',
        actorId: 'device-area'
      }
    }
  };
}

function createRequest(version: number, areaId = 'area-housekeeping', status: RequestDTO['status'] = 'PENDING'): RequestDTO {
  return {
    id: 'request-1',
    roomId: 'room-101',
    serviceId: 'service-towels',
    responsibleAreaId: areaId,
    room: {
      id: 'room-101',
      code: '101',
      displayName: 'Room 101',
      doNotDisturb: false
    },
    service: {
      id: 'service-towels',
      code: 'TOWELS',
      displayName: 'Fresh towels',
      iconKey: 'towels'
    },
    responsibleArea: {
      id: areaId,
      code: areaId === 'area-housekeeping' ? 'HOUSEKEEPING' : 'MAINTENANCE',
      displayName: areaId === 'area-housekeeping' ? 'Housekeeping' : 'Maintenance'
    },
    status,
    version,
    createdAt: '2026-09-19T11:59:00.000Z',
    acceptedAt: status === 'ACCEPTED' ? '2026-09-19T12:01:00.000Z' : null,
    inProgressAt: null,
    completedAt: null,
    updatedAt: '2026-09-19T12:01:00.000Z'
  };
}
