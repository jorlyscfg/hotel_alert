import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AdminSystemSnapshot } from '@hotel/shared';
import { I18nProvider } from '../../apps/web/src/i18n';
import {
  DeviceRoleAssignmentScreen,
  buildDeviceBootstrapInput,
  getAvailableAreas,
  getAvailableRooms,
  type DeviceRoleAssignmentTarget
} from '../../apps/web/src/features/bootstrap/DeviceRoleAssignmentScreen';

const snapshot: AdminSystemSnapshot = {
  configurationRevision: 1,
  rooms: [
    { id: 'room-1', code: '101', displayName: 'Room 101', floor: '1', displayOrder: 1, active: true, doNotDisturb: false, createdAt: '', updatedAt: '' },
    { id: 'room-2', code: '102', displayName: 'Room 102', floor: '1', displayOrder: 2, active: true, doNotDisturb: false, createdAt: '', updatedAt: '' },
    { id: 'room-off', code: '103', displayName: 'Room 103', floor: '1', displayOrder: 3, active: false, doNotDisturb: false, createdAt: '', updatedAt: '' }
  ],
  areas: [
    { id: 'area-1', code: 'front-desk', displayName: 'Front desk', description: null, displayOrder: 1, active: true, createdAt: '', updatedAt: '' },
    { id: 'area-off', code: 'inactive', displayName: 'Inactive', description: null, displayOrder: 2, active: false, createdAt: '', updatedAt: '' }
  ],
  services: [],
  devices: [{ id: 'device-1', installationId: 'other', displayName: 'Existing', assignmentMode: 'ROOM', roomId: 'room-1', areaId: null, active: true, deviceConfigVersion: 1, lastHeartbeatAt: null, presence: 'OFFLINE' }],
  requests: [],
  admins: [],
  settings: [],
  auditLog: [],
  outboxBacklog: 0,
  warnings: []
};

describe('device role onboarding', () => {
  it('keeps only active rooms without an active ROOM device', () => {
    expect(getAvailableRooms(snapshot).map((room) => room.id)).toEqual(['room-2']);
  });

  it('keeps active areas available for area consoles', () => {
    expect(getAvailableAreas(snapshot).map((area) => area.id)).toEqual(['area-1']);
  });

  it('builds an exact bootstrap payload for a selected target', () => {
    const target = snapshot.rooms[1];
    expect(buildDeviceBootstrapInput('install-1', 'ROOM', target)).toEqual({
      installationId: 'install-1',
      displayName: 'Room 102',
      assignmentMode: 'ROOM',
      roomId: 'room-2',
      areaId: null
    });
  });

  it('builds an area bootstrap payload without a room target', () => {
    const target = snapshot.areas[0];
    expect(buildDeviceBootstrapInput('install-2', 'AREA', target)).toEqual({
      installationId: 'install-2',
      displayName: 'Front desk',
      assignmentMode: 'AREA',
      roomId: null,
      areaId: 'area-1'
    });
  });

  it('renders a touch-friendly target list instead of a modal form', () => {
    const target: DeviceRoleAssignmentTarget = snapshot.rooms[1];
    const markup = renderToStaticMarkup(createElement(I18nProvider, {
      children: createElement(DeviceRoleAssignmentScreen, {
        role: 'ROOM',
        snapshot,
        busy: false,
        error: null,
        onSelect: () => undefined,
        onAdmin: () => undefined
      })
    }));

    expect(markup).toContain('Room 102');
    expect(markup).not.toContain('Room 101');
    expect(markup).toContain('data-station-target="room-2"');
    expect(target.id).toBe('room-2');
  });
});
