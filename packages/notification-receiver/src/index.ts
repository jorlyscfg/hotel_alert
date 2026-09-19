import {
  ACTOR_TYPES,
  REQUEST_STATUSES,
  type DurableRealtimeEvent,
  type RequestCreatedPayload,
  type RequestDTO,
  type RequestUpdatedPayload,
  type RequestStatus
} from '@hotel/shared';

export type RequestNotificationEvent =
  | DurableRealtimeEvent<'request.created', RequestCreatedPayload>
  | DurableRealtimeEvent<'request.updated', RequestUpdatedPayload>;

type DurableRealtimeEnvelope = DurableRealtimeEvent<string, unknown>;

export interface RequestNotification {
  readonly eventName: RequestNotificationEvent['name'];
  readonly eventId: string;
  readonly eventSequence: number;
  readonly occurredAt: string;
  readonly request: RequestDTO;
}

export interface NotificationSink {
  deliver(notification: RequestNotification): void | Promise<void>;
}

export interface DurableCursorStore {
  readonly lastSeenEventSequence: number;
  advanceTo(eventSequence: number): void | Promise<void>;
}

export interface NotificationReceiverOptions {
  assignedAreaId: string;
  cursor: DurableCursorStore;
  sink: NotificationSink;
}

export interface SynchronizedEventContext {
  synchronized: boolean;
}

export type NotificationIgnoreReason =
  | 'unsupported-event'
  | 'not-synchronized'
  | 'unassigned-area'
  | 'duplicate'
  | 'out-of-order'
  | 'older-aggregate-version';

export type NotificationHandleResult =
  | {
      outcome: 'deferred';
      reason: 'not-synchronized';
      cursorSequence: number;
      cursorAdvanced: false;
    }
  | {
      outcome: 'ignored';
      reason: Exclude<NotificationIgnoreReason, 'not-synchronized'>;
      cursorSequence: number;
      cursorAdvanced: boolean;
    }
  | {
      outcome: 'delivered';
      notification: RequestNotification;
      cursorSequence: number;
      cursorAdvanced: true;
    };

export interface NotificationReceiver {
  handle(event: unknown, context: SynchronizedEventContext): Promise<NotificationHandleResult>;
}

const MAX_TRACKED_EVENT_IDS = 2048;
const MAX_TRACKED_AGGREGATES = 2048;

export function createNotificationReceiver(options: NotificationReceiverOptions): NotificationReceiver {
  let lastSeenEventSequence = options.cursor.lastSeenEventSequence;
  const seenEventIds = new Set<string>();
  const aggregateVersions = new Map<string, number>();
  let queue = Promise.resolve();
  let failedEvent: { event: unknown; eventId: string | undefined; error: unknown } | undefined;

  const process = async (event: unknown, context: SynchronizedEventContext): Promise<NotificationHandleResult> => {
    if (!isDurableRealtimeEvent(event)) {
      return ignored('unsupported-event', false, lastSeenEventSequence);
    }
    if (!context.synchronized) {
      return {
        outcome: 'deferred',
        reason: 'not-synchronized',
        cursorSequence: lastSeenEventSequence,
        cursorAdvanced: false
      };
    }
    if (seenEventIds.has(event.eventId)) {
      return ignored('duplicate', false, lastSeenEventSequence);
    }
    if (event.eventSequence <= lastSeenEventSequence) {
      return ignored('out-of-order', false, lastSeenEventSequence);
    }
    if (!isRequestNotificationEvent(event)) {
      if (event.aggregateType === 'REQUEST' && (event.name === 'request.created' || event.name === 'request.updated')) {
        return ignored('unsupported-event', false, lastSeenEventSequence);
      }
      await advanceCursor(event.eventSequence);
      rememberEvent(event.eventId);
      return ignored('unsupported-event', true, lastSeenEventSequence);
    }

    const aggregateKey = `REQUEST:${event.aggregateId}`;
    const aggregateVersion = event.aggregateVersion ?? event.payload.request.version;
    const previousVersion = aggregateVersions.get(aggregateKey);
    const outsideAssignedArea = event.payload.request.responsibleAreaId !== options.assignedAreaId;
    const olderAggregateVersion = previousVersion !== undefined && aggregateVersion <= previousVersion;

    if (outsideAssignedArea || olderAggregateVersion) {
      await advanceCursor(event.eventSequence);
      rememberAcceptedEvent(event, aggregateKey, aggregateVersion);
      return ignored(
        outsideAssignedArea ? 'unassigned-area' : 'older-aggregate-version',
        true,
        lastSeenEventSequence
      );
    }

    const notification: RequestNotification = {
      eventName: event.name,
      eventId: event.eventId,
      eventSequence: event.eventSequence,
      occurredAt: event.occurredAt,
      request: event.payload.request
    };
    await options.sink.deliver(notification);
    await advanceCursor(event.eventSequence);
    rememberAcceptedEvent(event, aggregateKey, aggregateVersion);
    return {
      outcome: 'delivered',
      notification,
      cursorSequence: lastSeenEventSequence,
      cursorAdvanced: true
    };
  };

  const handle = (event: unknown, context: SynchronizedEventContext): Promise<NotificationHandleResult> => {
    if (failedEvent !== undefined) {
      const isRetry = event === failedEvent.event
        || failedEvent.eventId !== undefined && eventIdOf(event) === failedEvent.eventId;
      if (!isRetry) return Promise.reject(failedEvent.error);
      failedEvent = undefined;
      queue = Promise.resolve();
    }

    const result = queue.then(async () => {
      try {
        return await process(event, context);
      } catch (error) {
        failedEvent = { event, eventId: eventIdOf(event), error };
        throw error;
      }
    });
    queue = result.then(() => undefined);
    void queue.catch(() => undefined);
    return result;
  };

  async function advanceCursor(eventSequence: number): Promise<void> {
    await options.cursor.advanceTo(eventSequence);
    lastSeenEventSequence = eventSequence;
  }

  function rememberAcceptedEvent(event: RequestNotificationEvent, aggregateKey: string, aggregateVersion: number): void {
    seenEventIds.add(event.eventId);
    const previousVersion = aggregateVersions.get(aggregateKey);
    if (previousVersion === undefined || aggregateVersion > previousVersion) {
      aggregateVersions.set(aggregateKey, aggregateVersion);
    }
    pruneState();
  }

  function rememberEvent(eventId: string): void {
    seenEventIds.add(eventId);
    pruneState();
  }

  function pruneState(): void {
    while (seenEventIds.size > MAX_TRACKED_EVENT_IDS) {
      const oldestEventId = seenEventIds.values().next().value as string | undefined;
      if (oldestEventId === undefined) break;
      seenEventIds.delete(oldestEventId);
    }
    while (aggregateVersions.size > MAX_TRACKED_AGGREGATES) {
      const oldestAggregateKey = aggregateVersions.keys().next().value as string | undefined;
      if (oldestAggregateKey === undefined) break;
      aggregateVersions.delete(oldestAggregateKey);
    }
  }

  return { handle };
}

export function isRequestNotificationEvent(value: unknown): value is RequestNotificationEvent {
  if (!isDurableRealtimeEvent(value) || value['aggregateType'] !== 'REQUEST') {
    return false;
  }

  const name = value['name'];
  const payload = value['payload'];
  if (!isRecord(payload) || !isRequestDTO(payload['request'])) return false;
  if (name === 'request.created') {
    return isRecord(payload['alert']) && payload['alert']['repeatUntil'] === 'ACCEPTED';
  }
  if (name !== 'request.updated' || !isRecord(payload['transition'])) return false;
  const transition = payload['transition'];
  return isRequestStatus(transition['from'])
    && isRequestStatus(transition['to'])
    && isActorType(transition['actorType'])
    && (transition['actorId'] === null || typeof transition['actorId'] === 'string');
}

function isRequestDTO(value: unknown): value is RequestDTO {
  if (!isRecord(value)
    || !isNonEmptyString(value['id'])
    || !isNonEmptyString(value['roomId'])
    || !isNonEmptyString(value['serviceId'])
    || !isNonEmptyString(value['responsibleAreaId'])
    || !isRequestStatus(value['status'])
    || !isNonNegativeInteger(value['version'])
    || !isNonEmptyString(value['createdAt'])
    || !isNonEmptyString(value['updatedAt'])
    || !isNullableString(value['acceptedAt'])
    || !isNullableString(value['inProgressAt'])
    || !isNullableString(value['completedAt'])) {
    return false;
  }
  if (value['createdByDeviceId'] !== undefined && typeof value['createdByDeviceId'] !== 'string') return false;

  const room = value['room'];
  const service = value['service'];
  const responsibleArea = value['responsibleArea'];
  return isRecord(room)
    && isNonEmptyString(room['id'])
    && isNonEmptyString(room['code'])
    && isNonEmptyString(room['displayName'])
    && isLocalizedTextVariants(room['displayNameVariants'])
    && typeof room['doNotDisturb'] === 'boolean'
    && isRecord(service)
    && isNonEmptyString(service['id'])
    && isNonEmptyString(service['code'])
    && isNonEmptyString(service['displayName'])
    && isLocalizedTextVariants(service['displayNameVariants'])
    && (service['iconKey'] === null || typeof service['iconKey'] === 'string')
    && isRecord(responsibleArea)
    && isNonEmptyString(responsibleArea['id'])
    && isNonEmptyString(responsibleArea['code'])
    && isNonEmptyString(responsibleArea['displayName'])
    && isLocalizedTextVariants(responsibleArea['displayNameVariants']);
}

function isDurableRealtimeEvent(value: unknown): value is DurableRealtimeEnvelope {
  return isRecord(value)
    && value['schemaVersion'] === 1
    && isNonEmptyString(value['eventId'])
    && isNonNegativeInteger(value['eventSequence'])
    && isNonEmptyString(value['name'])
    && isNonEmptyString(value['occurredAt'])
    && isDurableAggregateType(value['aggregateType'])
    && isNonEmptyString(value['aggregateId'])
    && 'payload' in value
    && (value['aggregateVersion'] === undefined || isNonNegativeInteger(value['aggregateVersion']));
}

function isDurableAggregateType(value: unknown): value is DurableRealtimeEnvelope['aggregateType'] {
  return value === 'REQUEST'
    || value === 'DEVICE'
    || value === 'ROOM'
    || value === 'AREA'
    || value === 'SERVICE'
    || value === 'SYSTEM';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function eventIdOf(value: unknown): string | undefined {
  return isRecord(value) && typeof value['eventId'] === 'string' ? value['eventId'] : undefined;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isLocalizedTextVariants(value: unknown): boolean {
  return value === undefined
    || isRecord(value) && Object.values(value).every((variant) => typeof variant === 'string');
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isRequestStatus(value: unknown): value is RequestStatus {
  return typeof value === 'string' && REQUEST_STATUSES.includes(value as RequestStatus);
}

function isActorType(value: unknown): boolean {
  return typeof value === 'string' && ACTOR_TYPES.includes(value as (typeof ACTOR_TYPES)[number]);
}

function ignored(
  reason: Exclude<NotificationIgnoreReason, 'not-synchronized'>,
  cursorAdvanced: boolean,
  cursorSequence: number
): NotificationHandleResult {
  return { outcome: 'ignored', reason, cursorAdvanced, cursorSequence };
}
