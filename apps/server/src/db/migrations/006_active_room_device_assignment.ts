import type { SqliteDatabase } from '../connection';

export function applyActiveRoomDeviceAssignmentMigration(database: SqliteDatabase): void {
  const migrationTimestamp = new Date().toISOString();
  database.prepare(`
    UPDATE devices
    SET active = 0,
        retired_at = ?,
        updated_at = ?
    WHERE id IN (
      SELECT id
      FROM (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY room_id
                 ORDER BY
                   COALESCE(last_heartbeat_at, last_seen_at, updated_at, created_at) DESC,
                   updated_at DESC,
                   created_at DESC,
                   id DESC
               ) AS device_rank
        FROM devices
        WHERE assignment_mode = 'ROOM'
          AND room_id IS NOT NULL
          AND active = 1
          AND retired_at IS NULL
      )
      WHERE device_rank > 1
    )
  `).run(migrationTimestamp, migrationTimestamp);
  database.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_room_device ON devices(room_id) WHERE assignment_mode = 'ROOM' AND active = 1 AND retired_at IS NULL");
}
