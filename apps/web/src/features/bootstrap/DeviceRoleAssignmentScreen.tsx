import type { AdminSystemSnapshot, AreaDTO, DeviceCreateInput, DeviceAssignmentMode, RoomDTO } from '@hotel/shared';
import { CircleAlert, Monitor, Settings2, ShieldCheck, Tv } from 'lucide-react';
import { useI18n, resolveLocalizedValue } from '../../i18n';

export type DeviceRoleAssignmentTarget = RoomDTO | AreaDTO;

interface DeviceRoleAssignmentScreenProps {
  role: DeviceAssignmentMode;
  snapshot: AdminSystemSnapshot;
  busy: boolean;
  error: string | null;
  onSelect: (target: DeviceRoleAssignmentTarget) => void;
  onAdmin: () => void;
}

export function getAvailableRooms(snapshot: AdminSystemSnapshot): RoomDTO[] {
  const assignedRoomIds = new Set(snapshot.devices
    .filter((device) => device.active && device.assignmentMode === 'ROOM' && device.roomId !== null)
    .map((device) => device.roomId));
  return snapshot.rooms.filter((room) => room.active && !assignedRoomIds.has(room.id));
}

export function getAvailableAreas(snapshot: AdminSystemSnapshot): AreaDTO[] {
  return snapshot.areas.filter((area) => area.active);
}

export function buildDeviceBootstrapInput(installationId: string, role: DeviceAssignmentMode, target: DeviceRoleAssignmentTarget): DeviceCreateInput {
  if (role === 'ROOM') {
    const room = target as RoomDTO;
    return {
      installationId,
      displayName: room.displayName,
      assignmentMode: 'ROOM',
      roomId: room.id,
      areaId: null
    };
  }
  const area = target as AreaDTO;
  return {
    installationId,
    displayName: area.displayName,
    assignmentMode: 'AREA',
    roomId: null,
    areaId: area.id
  };
}

function targetLabel(target: DeviceRoleAssignmentTarget, locale: Parameters<typeof resolveLocalizedValue>[1]): string {
  return resolveLocalizedValue(target.displayName, locale, target.displayNameVariants) ?? target.displayName;
}

export function DeviceRoleAssignmentScreen({ role, snapshot, busy, error, onSelect, onAdmin }: DeviceRoleAssignmentScreenProps) {
  const { locale, t } = useI18n();
  const targets = role === 'ROOM' ? getAvailableRooms(snapshot) : getAvailableAreas(snapshot);
  const isRoom = role === 'ROOM';
  const title = isRoom ? t('stationAssignment.roomTitle') : t('stationAssignment.areaTitle');
  const copy = isRoom ? t('stationAssignment.roomCopy') : t('stationAssignment.areaCopy');
  const emptyCopy = isRoom ? t('stationAssignment.noRooms') : t('stationAssignment.noAreas');

  return (
    <main className="app-frame app-frame--centered station-assignment-screen">
      <section className="surface-card station-assignment-card" aria-labelledby="station-assignment-title">
        <header className="station-assignment-header">
          <div className="station-assignment-card__icon" aria-hidden="true">
            {isRoom ? <Tv size={22} strokeWidth={1.8} /> : <Monitor size={22} strokeWidth={1.8} />}
          </div>
          <div className="station-assignment-header__copy">
            <p className="eyebrow eyebrow--muted">{t('stationAssignment.eyebrow')}</p>
            <h1 id="station-assignment-title">{title}</h1>
            <p className="card-copy">{copy}</p>
          </div>
          <button className="icon-button station-assignment-admin" aria-label={t('stationAssignment.openAdmin')} title={t('stationAssignment.openAdmin')} disabled={busy} onClick={onAdmin} type="button">
            <Settings2 aria-hidden="true" size={20} strokeWidth={1.9} />
          </button>
        </header>
        {error !== null && <div className="inline-alert" role="alert"><span aria-hidden="true"><CircleAlert size={16} strokeWidth={1.8} /></span><span>{error}</span></div>}
        {targets.length === 0 ? (
          <div className="station-assignment-empty" role="status">
            <ShieldCheck size={24} strokeWidth={1.8} aria-hidden="true" />
            <span>{emptyCopy}</span>
          </div>
        ) : (
          <div className="station-assignment-list" role="list" aria-label={title}>
            {targets.map((target) => (
              <button
                className="station-assignment-target"
                data-station-target={target.id}
                disabled={busy}
                key={target.id}
                onClick={() => onSelect(target)}
                type="button"
              >
                <span className="station-assignment-target__copy">
                  <strong>{targetLabel(target, locale)}</strong>
                  <small>{target.code}</small>
                </span>
                <span aria-hidden="true">{busy ? t('stationAssignment.provisioning') : t('stationAssignment.choose')}</span>
              </button>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
