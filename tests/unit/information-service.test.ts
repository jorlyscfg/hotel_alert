import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig, type ServerConfig } from '../../apps/server/src/config/env';
import { closeDatabase, openDatabase, runMigrations, type SqliteDatabase } from '../../apps/server/src/db/connection';
import { HotelService } from '../../apps/server/src/domain/hotel-service';
import type { Actor } from '../../apps/server/src/security/principal';

const systemActor: Actor = { actorType: 'SYSTEM', actorId: null };

describe('HotelService information images', () => {
  let database: SqliteDatabase;
  let temporaryDirectory: string;
  let config: ServerConfig;
  let service: HotelService;

  beforeEach(() => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'information-service-'));
    config = loadConfig({
      nodeEnv: 'test',
      databasePath: path.join(temporaryDirectory, 'hotel.sqlite'),
      informationImageDirectory: path.join(temporaryDirectory, 'images'),
      sessionSecret: 'session-secret',
      tokenPepper: 'token-pepper'
    });
    database = openDatabase(config);
    runMigrations(database);
    service = new HotelService(database, config);
  });

  afterEach(() => {
    closeDatabase(database);
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it('persists ordered image metadata and removes the stored bytes when deleted', () => {
    const first = service.createInformationImage(pngBytes('first'), 'first.png', systemActor, 'image-1');
    const second = service.createInformationImage(pngBytes('second'), 'second.png', systemActor, 'image-2');

    expect(service.listInformationImages().map((image) => image.id)).toEqual([first.id, second.id]);
    expect(service.getInformationImageContent(first.id)?.bytes).toEqual(pngBytes('first'));

    service.reorderInformationImages([second.id, first.id], systemActor, 'image-reorder');
    expect(service.listInformationImages().map((image) => image.id)).toEqual([second.id, first.id]);

    service.deleteInformationImage(first.id, systemActor, 'image-delete');
    expect(service.getInformationImage(first.id)).toBeNull();
    expect(service.getInformationImageContent(first.id)).toBeNull();
    expect(service.listInformationImages().map((image) => image.id)).toEqual([second.id]);
  });

  it('rejects uploads whose bytes are not a supported image signature', () => {
    expect(() => service.createInformationImage(Buffer.from('not an image'), 'promo.png', systemActor, 'image-invalid')).toThrow(/PNG, JPEG, and WebP/);
    expect(service.listInformationImages()).toEqual([]);
  });

  it('persists typed image variants and falls back to the available variant', () => {
    const image = service.createInformationImageVariants([
      { bytes: pngBytes('square'), originalName: 'square.png', variant: 'square480' },
      { bytes: pngBytes('wide'), originalName: 'wide.png', variant: 'wide' }
    ], systemActor, 'image-variants');

    expect(image.originalName).toBe('wide.png');
    expect(image.variants).toEqual([
      { variant: 'wide', originalName: 'wide.png', mimeType: 'image/png', byteSize: 12 },
      { variant: 'square480', originalName: 'square.png', mimeType: 'image/png', byteSize: 14 }
    ]);
    expect(service.getInformationImageContent(image.id, 'square480')?.bytes).toEqual(pngBytes('square'));
    expect(service.getInformationImageContent(image.id, 'wide')?.bytes).toEqual(pngBytes('wide'));

    const onlyWide = service.createInformationImageVariants([
      { bytes: pngBytes('fallback'), originalName: 'fallback.png', variant: 'wide' }
    ], systemActor, 'image-fallback');
    expect(service.getInformationImageContent(onlyWide.id, 'square480')?.bytes).toEqual(pngBytes('fallback'));
  });

  it('serves explicit language and size variants, falls back within that language, and repairs them without changing legacy artwork', () => {
    const image = service.createInformationImageVariants([
      { bytes: pngBytes('english wide'), originalName: 'welcome-en.png', language: 'en', variant: 'wide' },
      { bytes: pngBytes('spanish wide'), originalName: 'welcome-es.png', language: 'es', variant: 'wide' }
    ], systemActor, 'image-localized');

    expect(image.variants).toEqual([
      { language: 'es', variant: 'wide', originalName: 'welcome-es.png', mimeType: 'image/png', byteSize: 20 },
      { language: 'en', variant: 'wide', originalName: 'welcome-en.png', mimeType: 'image/png', byteSize: 20 }
    ]);
    expect(service.getInformationImageContent(image.id, 'square480', 'en')?.bytes).toEqual(pngBytes('english wide'));
    expect(service.getInformationImageContent(image.id, 'wide', 'es')?.bytes).toEqual(pngBytes('spanish wide'));

    const repaired = service.updateInformationImageVariants(image.id, [
      { bytes: pngBytes('new English'), originalName: 'welcome-en-updated.png', language: 'en', variant: 'wide' }
    ], systemActor, 'image-localized-repair');

    expect(repaired.variants?.find((variant) => variant.language === 'en')?.originalName).toBe('welcome-en-updated.png');
    expect(service.getInformationImageContent(image.id, 'wide', 'en')?.bytes).toEqual(pngBytes('new English'));
    expect(service.getInformationImageContent(image.id, 'wide', 'es')?.bytes).toEqual(pngBytes('spanish wide'));
  });

  it('keeps the Spanish canonical hotel name and adds a configured English ROOM variant', () => {
    const admin = service.createAdmin({ username: 'settings-admin', password: 'correct-horse-battery-staple' }, systemActor, 'setup-settings-admin');
    database.prepare('UPDATE system_settings SET value_json = ?, updated_by_admin_id = ? WHERE key = ?').run(JSON.stringify('Aurora Hotel'), admin.id, 'hotelNameEn');
    const room = service.createRoom({ code: '101', displayName: 'Room 101' }, systemActor, 'setup-room-hotel-name');
    const device = service.bootstrapDevice({ installationId: 'room-hotel-name', displayName: 'Room display', assignmentMode: 'ROOM', roomId: room.id }, systemActor, 'setup-room-hotel-device');
    const snapshot = service.getDeviceSnapshot(service.authenticateDeviceToken(device.deviceToken).principal);

    expect(snapshot.config.hotelName).toBe('Hotel Local');
    expect(snapshot.config.hotelNameVariants).toEqual({ en: 'Aurora Hotel', es: 'Hotel Local' });
  });

  it('removes primary and variant files when image metadata is deleted', () => {
    const image = service.createInformationImageVariants([
      { bytes: pngBytes('square'), originalName: 'square.png', variant: 'square480' },
      { bytes: pngBytes('wide'), originalName: 'wide.png', variant: 'wide' }
    ], systemActor, 'image-delete-variants');
    const storedFiles = informationImageFiles();

    expect(storedFiles).toHaveLength(2);
    service.deleteInformationImage(image.id, systemActor, 'image-delete-variants-request');

    expect(service.getInformationImage(image.id)).toBeNull();
    expect(informationImageFiles()).toEqual([]);
  });

  it('treats missing primary and variant files as already deleted', () => {
    const image = service.createInformationImageVariants([
      { bytes: pngBytes('square'), originalName: 'square.png', variant: 'square480' },
      { bytes: pngBytes('wide'), originalName: 'wide.png', variant: 'wide' }
    ], systemActor, 'image-delete-missing');
    informationImageFiles().forEach((file) => fs.unlinkSync(path.join(config.informationImageDirectory, file)));

    expect(() => service.deleteInformationImage(image.id, systemActor, 'image-delete-missing-request')).not.toThrow();
    expect(service.getInformationImage(image.id)).toBeNull();
  });

  it('keeps metadata and restores earlier files when staging a variant deletion fails', () => {
    const image = service.createInformationImageVariants([
      { bytes: pngBytes('square'), originalName: 'square.png', variant: 'square480' },
      { bytes: pngBytes('wide'), originalName: 'wide.png', variant: 'wide' }
    ], systemActor, 'image-delete-filesystem-failure');
    const storedFiles = informationImageFiles();
    const originalRenameSync = fs.renameSync;
    let stageAttempts = 0;
    const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
      if (path.basename(String(source)).startsWith('information_')) {
        stageAttempts += 1;
        if (stageAttempts === 2) throw new Error('staging filesystem failure');
      }
      return originalRenameSync.call(fs, source, destination);
    });

    let thrown: unknown;
    try {
      service.deleteInformationImage(image.id, systemActor, 'image-delete-filesystem-failure-request');
    } catch (error) {
      thrown = error;
    } finally {
      renameSpy.mockRestore();
    }

    expect(thrown).toEqual(new Error('staging filesystem failure'));
    expect(service.getInformationImage(image.id)).not.toBeNull();
    expect(informationImageFiles()).toEqual(storedFiles);
  });

  it('restores staged files when the database deletion rolls back', () => {
    const image = service.createInformationImageVariants([
      { bytes: pngBytes('square'), originalName: 'square.png', variant: 'square480' },
      { bytes: pngBytes('wide'), originalName: 'wide.png', variant: 'wide' }
    ], systemActor, 'image-delete-rollback');
    const storedFiles = informationImageFiles();
    database.exec(`
      CREATE TRIGGER information_image_delete_failure
      BEFORE DELETE ON information_images
      BEGIN
        SELECT RAISE(ABORT, 'information image deletion blocked');
      END;
    `);

    expect(() => service.deleteInformationImage(image.id, systemActor, 'image-delete-rollback-request')).toThrow(/information image deletion blocked/);
    expect(service.getInformationImage(image.id)).not.toBeNull();
    expect(informationImageFiles()).toEqual(storedFiles);
  });

  function informationImageFiles(): string[] {
    return fs.readdirSync(config.informationImageDirectory).sort();
  }
});

function pngBytes(label: string): Buffer {
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from(label)]);
}
