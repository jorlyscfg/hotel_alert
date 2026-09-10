import type { ActorType, DeviceAssignmentMode, DevicePresence, RequestStatus } from './domain';
import type { RequestDTO, RoomDTO } from './dto';

export interface DurableRealtimeEvent<TName extends string, TPayload> {
  schemaVersion: 1;
  eventId: string;
  eventSequence: number;
  name: TName;
  occurredAt: string;
  aggregateType: 'REQUEST' | 'DEVICE' | 'ROOM' | 'AREA' | 'SERVICE' | 'SYSTEM';
  aggregateId: string;
  aggregateVersion?: number;
  payload: TPayload;
}

export interface RequestCreatedPayload {
  request: RequestDTO;
  alert: { repeatUntil: 'ACCEPTED' };
}

export interface RequestUpdatedPayload {
  request: RequestDTO;
  transition: {
    from: RequestStatus;
    to: RequestStatus;
    actorType: ActorType;
    actorId: string | null;
  };
}

export interface DeviceConfigChangedPayload {
  deviceId: string;
  configurationRevision: number;
  deviceConfigVersion: number;
  assignmentMode: DeviceAssignmentMode;
  roomId: string | null;
  areaId: string | null;
  reason: 'ASSIGNMENT_CHANGED' | 'TOKEN_ROTATED' | 'DEVICE_ACTIVATED' | 'DEVICE_DEACTIVATED' | 'DEVICE_RETIRED';
}

export interface ServiceCatalogChangedPayload {
  configurationRevision: number;
  changedServiceIds: string[];
}

export interface DevicePresencePayload {
  deviceId: string;
  presence: DevicePresence;
  lastSeenAt: string | null;
}

export interface RoomUpdatedPayload {
  room: RoomDTO;
}

export type ServerToClientEventMap = {
  'connection.ready': {
    serverTime: string;
    currentEventSequence: number;
    sync: 'REPLAY_AVAILABLE' | 'FULL_SNAPSHOT_REQUIRED' | 'UP_TO_DATE';
  };
  'request.created': RequestCreatedPayload;
  'request.updated': RequestUpdatedPayload;
  'device.config.changed': DeviceConfigChangedPayload;
  'device.token.rotation.required': {
    deviceId: string;
    rotationId: string;
    state: 'ROTATION_PENDING';
    graceExpiresAt: string;
    configurationRevision: number;
  };
  'service.catalog.changed': ServiceCatalogChangedPayload;
  'room.updated': RoomUpdatedPayload;
  'device.presence.changed': DevicePresencePayload;
  'sync.required': {
    reason: 'EVENT_GAP' | 'ASSIGNMENT_CHANGED' | 'SERVER_RESTART' | 'DEVICE_CONFIG_MISMATCH';
    lastSeenEventSequence?: number;
    currentEventSequence: number;
  };
  'system.maintenance': { message: string; severity: 'INFO' | 'WARNING' };
};

export interface RealtimeAuth {
  deviceId?: string;
  deviceToken?: string;
  clientInstanceId: string;
  lastSeenEventSequence?: number;
  deviceConfigVersion?: number;
  clientVersion: string;
}

export interface TransportAck {
  ok: boolean;
  eventId?: string;
  errorCode?: string;
  sync?: 'REPLAY_AVAILABLE' | 'FULL_SNAPSHOT_REQUIRED' | 'UP_TO_DATE';
}
