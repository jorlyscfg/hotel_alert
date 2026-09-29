import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { InformationImageStore, detectInformationImageMimeType } from '../../apps/server/src/information/image-store';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('information image storage', () => {
  it('detects supported image types from file signatures instead of trusting headers', () => {
    expect(detectInformationImageMimeType(Buffer.from('89504e470d0a1a0a', 'hex'))).toBe('image/png');
    expect(detectInformationImageMimeType(Buffer.from('ffd8ffe000', 'hex'))).toBe('image/jpeg');
    expect(detectInformationImageMimeType(Buffer.concat([Buffer.from('52494646', 'hex'), Buffer.alloc(4), Buffer.from('57454250', 'hex')]))).toBe('image/webp');
    expect(detectInformationImageMimeType(Buffer.from('<svg></svg>'))).toBeNull();
  });

  it('stores bytes under a generated safe name and reads them back', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'information-images-'));
    temporaryDirectories.push(directory);
    const store = new InformationImageStore(directory);
    const bytes = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('image')]);

    const stored = store.write(bytes, 'guest room.png');

    expect(stored.mimeType).toBe('image/png');
    expect(stored.storageName).toMatch(/^information_[a-f0-9-]+\.png$/);
    expect(store.read(stored.storageName)).toEqual(bytes);
    expect(store.read('guest room.png')).toBeNull();
    expect(store.delete(stored.storageName)).toBe(true);
    expect(store.read(stored.storageName)).toBeNull();
  });
});
