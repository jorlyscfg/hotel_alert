import type { SqliteDatabase } from '../connection';

interface DefaultArea {
  id: string;
  code: string;
  displayName: string;
  description: string;
  displayOrder: number;
}

interface DefaultService {
  id: string;
  code: string;
  displayName: string;
  description: string;
  iconKey: string;
  areaId: string;
  displayOrder: number;
}

const DEFAULT_AREAS: ReadonlyArray<DefaultArea> = [
  { id: 'area_default_front-desk', code: 'front-desk', displayName: 'Front Desk', description: 'Reception and general guest assistance', displayOrder: 10 },
  { id: 'area_default_housekeeping', code: 'housekeeping', displayName: 'Housekeeping', description: 'Room cleaning and guest-room amenities', displayOrder: 20 },
  { id: 'area_default_maintenance', code: 'maintenance', displayName: 'Maintenance', description: 'Repairs and technical issues', displayOrder: 30 },
  { id: 'area_default_concierge', code: 'concierge', displayName: 'Concierge', description: 'Guest assistance, arrivals, and local arrangements', displayOrder: 40 },
  { id: 'area_default_food-beverage', code: 'food-beverage', displayName: 'Food & Beverage', description: 'Room service and refreshments', displayOrder: 50 }
];

const DEFAULT_SERVICES: ReadonlyArray<DefaultService> = [
  { id: 'svc_default_front-desk-assistance', code: 'front-desk-assistance', displayName: 'Front desk assistance', description: 'Reception and general guest assistance', iconKey: 'bell', areaId: 'area_default_front-desk', displayOrder: 10 },
  { id: 'svc_default_wake-up-call', code: 'wake-up-call', displayName: 'Wake-up call', description: 'Scheduled wake-up call', iconKey: 'bell', areaId: 'area_default_front-desk', displayOrder: 20 },
  { id: 'svc_default_fresh-towels', code: 'fresh-towels', displayName: 'Fresh towels', description: 'Fresh bath towels', iconKey: 'towels', areaId: 'area_default_housekeeping', displayOrder: 30 },
  { id: 'svc_default_room-cleaning', code: 'room-cleaning', displayName: 'Room cleaning', description: 'Guest room cleaning', iconKey: 'housekeeping', areaId: 'area_default_housekeeping', displayOrder: 40 },
  { id: 'svc_default_extra-room-amenities', code: 'extra-room-amenities', displayName: 'Extra room amenities', description: 'Additional room amenities', iconKey: 'housekeeping', areaId: 'area_default_housekeeping', displayOrder: 50 },
  { id: 'svc_default_room-repair', code: 'room-repair', displayName: 'Room repair', description: 'Repairs and technical issues', iconKey: 'maintenance', areaId: 'area_default_maintenance', displayOrder: 60 },
  { id: 'svc_default_air-conditioning', code: 'air-conditioning', displayName: 'Air conditioning issue', description: 'Air conditioning issue', iconKey: 'maintenance', areaId: 'area_default_maintenance', displayOrder: 70 },
  { id: 'svc_default_plumbing-issue', code: 'plumbing-issue', displayName: 'Plumbing issue', description: 'Plumbing issue', iconKey: 'maintenance', areaId: 'area_default_maintenance', displayOrder: 80 },
  { id: 'svc_default_concierge-assistance', code: 'concierge-assistance', displayName: 'Concierge assistance', description: 'Guest assistance and local arrangements', iconKey: 'concierge', areaId: 'area_default_concierge', displayOrder: 90 },
  { id: 'svc_default_bell-service', code: 'bell-service', displayName: 'Bell service', description: 'Luggage and bell service', iconKey: 'bell', areaId: 'area_default_concierge', displayOrder: 100 },
  { id: 'svc_default_room-service', code: 'room-service', displayName: 'Room service', description: 'Food and beverages delivered to the room', iconKey: 'food', areaId: 'area_default_food-beverage', displayOrder: 110 },
  { id: 'svc_default_breakfast-request', code: 'breakfast-request', displayName: 'Breakfast request', description: 'Breakfast request', iconKey: 'food', areaId: 'area_default_food-beverage', displayOrder: 120 },
  { id: 'svc_default_drinks-and-ice', code: 'drinks-and-ice', displayName: 'Drinks and ice', description: 'Drinks and ice', iconKey: 'drink', areaId: 'area_default_food-beverage', displayOrder: 130 }
];

export function applyDefaultCatalogMigration(database: SqliteDatabase): void {
  const now = new Date().toISOString();
  let changed = false;
  const insertedAreaIds: string[] = [];

  const insertArea = database.prepare('INSERT OR IGNORE INTO areas(id, code, display_name, description, display_order, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)');
  for (const area of DEFAULT_AREAS) {
    const result = insertArea.run(area.id, area.code, area.displayName, area.description, area.displayOrder, now, now);
    if (result.changes > 0) {
      changed = true;
      insertedAreaIds.push(area.id);
    }
  }

  const activeDefaultAreaIds = new Set(
    DEFAULT_AREAS.flatMap((area) => {
      const row = database.prepare('SELECT code, active FROM areas WHERE id = ?').get(area.id) as { code: string; active: number } | undefined;
      return row !== undefined && row.active === 1 && row.code.toLowerCase() === area.code.toLowerCase() ? [area.id] : [];
    })
  );
  const insertService = database.prepare('INSERT OR IGNORE INTO services(id, code, display_name, description, icon_key, area_id, display_order, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)');
  const insertedServiceIds: string[] = [];
  for (const service of DEFAULT_SERVICES) {
    if (!activeDefaultAreaIds.has(service.areaId)) {
      continue;
    }
    const result = insertService.run(service.id, service.code, service.displayName, service.description, service.iconKey, service.areaId, service.displayOrder, now, now);
    if (result.changes > 0) {
      changed = true;
      insertedServiceIds.push(service.id);
    }
  }

  if (!changed) {
    return;
  }

  database.prepare('UPDATE configuration_state SET configuration_revision = configuration_revision + 1, updated_at = ? WHERE singleton_id = 1').run(now);
  const revision = (database.prepare('SELECT configuration_revision FROM configuration_state WHERE singleton_id = 1').get() as { configuration_revision: number }).configuration_revision;
  const metadata = JSON.stringify({ areaIds: insertedAreaIds, serviceIds: insertedServiceIds, configurationRevision: revision });
  database.prepare('INSERT INTO audit_log(actor_type, actor_id, action, entity_type, entity_id, request_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    'SYSTEM', null, 'DEFAULT_CATALOG_APPLIED', 'SYSTEM', 'catalog', null, metadata, now
  );
  database.prepare('INSERT OR IGNORE INTO outbox_events(event_id, event_name, aggregate_type, aggregate_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    'evt_migration_default-catalog-v2',
    'service.catalog.changed',
    'SERVICE',
    insertedServiceIds[0] ?? 'catalog',
    JSON.stringify({ configurationRevision: revision, changedServiceIds: insertedServiceIds }),
    now
  );
}
