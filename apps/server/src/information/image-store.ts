import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const MAX_INFORMATION_IMAGE_BYTES = 10 * 1024 * 1024;

export type InformationImageMimeType = 'image/png' | 'image/jpeg' | 'image/webp';

export interface StoredInformationImage {
  storageName: string;
  mimeType: InformationImageMimeType;
  byteSize: number;
}

export interface StagedInformationImageDeletion {
  storageName: string;
  stagedStorageName: string;
}

export class InformationImageStoreError extends Error {
  public readonly code: 'IMAGE_EMPTY' | 'IMAGE_TOO_LARGE' | 'IMAGE_UNSUPPORTED';

  public constructor(code: InformationImageStoreError['code'], message: string) {
    super(message);
    this.name = 'InformationImageStoreError';
    this.code = code;
  }
}

export class InformationImageStore {
  public constructor(
    private readonly directory: string,
    private readonly maximumBytes = MAX_INFORMATION_IMAGE_BYTES
  ) {
    fs.mkdirSync(directory, { recursive: true });
  }

  public write(bytes: Buffer, _originalName: string): StoredInformationImage {
    if (bytes.length === 0) {
      throw new InformationImageStoreError('IMAGE_EMPTY', 'The image file is empty.');
    }
    if (bytes.length > this.maximumBytes) {
      throw new InformationImageStoreError('IMAGE_TOO_LARGE', `The image file must be at most ${this.maximumBytes} bytes.`);
    }
    const mimeType = detectInformationImageMimeType(bytes);
    if (mimeType === null) {
      throw new InformationImageStoreError('IMAGE_UNSUPPORTED', 'Only PNG, JPEG, and WebP images are supported.');
    }

    const extension = extensionForMimeType(mimeType);
    const storageName = `information_${crypto.randomUUID()}.${extension}`;
    const temporaryName = `.${storageName}.tmp`;
    const temporaryPath = path.join(this.directory, temporaryName);
    const targetPath = path.join(this.directory, storageName);
    fs.writeFileSync(temporaryPath, bytes, { flag: 'wx', mode: 0o600 });
    try {
      fs.renameSync(temporaryPath, targetPath);
    } catch (error) {
      fs.rmSync(temporaryPath, { force: true });
      throw error;
    }
    return { storageName, mimeType, byteSize: bytes.length };
  }

  public read(storageName: string): Buffer | null {
    const filePath = this.safePath(storageName);
    if (filePath === null) return null;
    try {
      return fs.readFileSync(filePath);
    } catch (error) {
      if (isFileNotFound(error)) return null;
      throw error;
    }
  }

  public delete(storageName: string): boolean {
    const filePath = this.safePath(storageName);
    if (filePath === null) return false;
    try {
      fs.unlinkSync(filePath);
      return true;
    } catch (error) {
      if (isFileNotFound(error)) return false;
      throw error;
    }
  }

  public stageDelete(storageNames: readonly string[]): StagedInformationImageDeletion[] {
    const staged: StagedInformationImageDeletion[] = [];
    try {
      for (const storageName of new Set(storageNames)) {
        const filePath = this.safePath(storageName);
        if (filePath === null) continue;
        const stagedStorageName = `.${storageName}.${crypto.randomUUID()}.deleting`;
        const stagedPath = this.safeStagedPath(stagedStorageName);
        if (stagedPath === null) continue;
        try {
          fs.renameSync(filePath, stagedPath);
          staged.push({ storageName, stagedStorageName });
        } catch (error) {
          if (isFileNotFound(error)) continue;
          throw error;
        }
      }
      return staged;
    } catch (error) {
      try {
        this.restoreStagedDeletes(staged);
      } catch (restoreError) {
        throw new AggregateError([error, restoreError], 'Unable to restore staged information image files.');
      }
      throw error;
    }
  }

  public restoreStagedDeletes(staged: readonly StagedInformationImageDeletion[]): void {
    for (const deletion of staged) {
      const filePath = this.safePath(deletion.storageName);
      const stagedPath = this.safeStagedPath(deletion.stagedStorageName);
      if (filePath === null || stagedPath === null) continue;
      try {
        fs.renameSync(stagedPath, filePath);
      } catch (error) {
        if (isFileNotFound(error)) continue;
        throw error;
      }
    }
  }

  public finalizeStagedDeletes(staged: readonly StagedInformationImageDeletion[]): void {
    for (const deletion of staged) {
      const stagedPath = this.safeStagedPath(deletion.stagedStorageName);
      if (stagedPath === null) continue;
      try {
        fs.unlinkSync(stagedPath);
      } catch (error) {
        if (isFileNotFound(error)) continue;
        throw error;
      }
    }
  }

  private safePath(storageName: string): string | null {
    if (!/^information_[a-f0-9-]+\.(?:png|jpg|webp)$/.test(storageName)) return null;
    return path.join(this.directory, storageName);
  }

  private safeStagedPath(stagedStorageName: string): string | null {
    if (!/^\.information_[a-f0-9-]+\.(?:png|jpg|webp)\.[a-f0-9-]+\.deleting$/.test(stagedStorageName)) return null;
    return path.join(this.directory, stagedStorageName);
  }
}

export function detectInformationImageMimeType(bytes: Buffer): InformationImageMimeType | null {
  if (bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function extensionForMimeType(mimeType: InformationImageMimeType): 'png' | 'jpg' | 'webp' {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/jpeg') return 'jpg';
  return 'webp';
}

function isFileNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
