import { isLegalRequestTransition } from '@hotel/shared';
import type { RequestStatus } from '@hotel/shared';
import { AppError } from '../errors';
import type { DevicePrincipal, Principal } from '../security/principal';

export interface RequestScope {
  roomId: string;
  responsibleAreaId: string;
  status: RequestStatus;
}

export function assertLegalRequestTransition(from: RequestStatus, to: RequestStatus): void {
  if (!isLegalRequestTransition(from, to)) {
    throw new AppError('REQUEST_INVALID_TRANSITION', `Cannot transition a ${from} request to ${to}.`, 409, { fromStatus: from, targetStatus: to });
  }
}

export function canReadRequest(principal: Principal, request: RequestScope): boolean {
  if (principal.kind === 'ADMIN' || principal.kind === 'SYSTEM') {
    return true;
  }
  return principal.assignmentMode === 'ROOM'
    ? principal.roomId === request.roomId
    : principal.areaId === request.responsibleAreaId;
}

export function canTransitionRequest(principal: Principal, request: RequestScope): boolean {
  return isAreaPrincipal(principal) && principal.areaId === request.responsibleAreaId;
}

function isAreaPrincipal(principal: Principal): principal is DevicePrincipal {
  return principal.kind === 'DEVICE' && principal.assignmentMode === 'AREA';
}
