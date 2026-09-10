import type { ActorType, DeviceAssignmentMode } from '@hotel/shared';

export interface AdminPrincipal {
  kind: 'ADMIN';
  actorType: 'ADMIN';
  adminId: string;
  username: string;
  sessionId: string;
  csrfTokenHash: string;
}

export interface DevicePrincipal {
  kind: 'DEVICE';
  actorType: 'DEVICE';
  deviceId: string;
  assignmentMode: DeviceAssignmentMode;
  roomId: string | null;
  areaId: string | null;
}

export interface SystemPrincipal {
  kind: 'SYSTEM';
  actorType: 'SYSTEM';
  actorId: null;
}

export type Principal = AdminPrincipal | DevicePrincipal | SystemPrincipal;
export type Actor = Pick<Principal, 'actorType'> & { actorId: string | null };

export function actorForPrincipal(principal: Principal): Actor {
  if (principal.kind === 'ADMIN') {
    return { actorType: 'ADMIN', actorId: principal.adminId };
  }
  if (principal.kind === 'DEVICE') {
    return { actorType: 'DEVICE', actorId: principal.deviceId };
  }
  return { actorType: 'SYSTEM', actorId: null };
}

export function actorTypeFor(value: Principal): ActorType {
  return value.actorType;
}
