import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { ImageProcessingError, normalizeImage } from '../../apps/server/src/images/image-processor';

const ffmpegAvailable = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
const describeFfmpeg = ffmpegAvailable ? describe : describe.skip;

describe('server image normalization', () => {
  it('rejects empty or oversized input before starting a decoder', async () => {
    await expect(normalizeImage(Buffer.alloc(0), targetOptions)).rejects.toMatchObject({ code: 'IMAGE_EMPTY' });
    await expect(normalizeImage(Buffer.from('12345'), {
      ...targetOptions,
      limits: { maxInputBytes: 4 }
    })).rejects.toMatchObject({ code: 'IMAGE_TOO_LARGE' });
  });

  it('rejects invalid target sizes and limits', async () => {
    await expect(normalizeImage(Buffer.from('not decoded'), {
      ...targetOptions,
      targetWidth: 4097
    })).rejects.toMatchObject({ code: 'IMAGE_INVALID_OPTIONS' });
    await expect(normalizeImage(Buffer.from('not decoded'), {
      ...targetOptions,
      limits: { maxPixels: 24_000_001 }
    })).rejects.toMatchObject({ code: 'IMAGE_INVALID_OPTIONS' });
  });

  it('rejects out-of-range WebP quality and quality on a lossless PNG request', async () => {
    await expect(normalizeImage(Buffer.from('not decoded'), {
      ...targetOptions,
      outputFormat: 'webp',
      quality: 101
    })).rejects.toMatchObject({ code: 'IMAGE_INVALID_OPTIONS' });
    await expect(normalizeImage(Buffer.from('not decoded'), {
      ...targetOptions,
      outputFormat: 'png',
      quality: 80
    })).rejects.toMatchObject({ code: 'IMAGE_INVALID_OPTIONS' });
  });

  it('reports an unavailable FFmpeg executable with a sanitized error', async () => {
    const error = await normalizeImage(ppmFixture(), {
      ...targetOptions,
      ffmpegPath: '/path/that/does/not/exist/ffmpeg'
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ImageProcessingError);
    expect(error).toMatchObject({ code: 'IMAGE_PROCESSOR_UNAVAILABLE' });
    expect((error as Error).message).not.toContain('/path/that/does/not/exist');
  });
});

describeFfmpeg('FFmpeg-backed image normalization', () => {
  it('decodes bytes independent of filename or MIME and emits a fixed-size PNG', async () => {
    const normalized = await normalizeImage(ppmFixture(), {
      targetWidth: 8,
      targetHeight: 8,
      fit: 'cover',
      outputFormat: 'png'
    });

    expect(normalized.mimeType).toBe('image/png');
    expect(normalized.width).toBe(8);
    expect(normalized.height).toBe(8);
    expect(normalized.bytes.subarray(0, 8)).toEqual(Buffer.from('89504e470d0a1a0a', 'hex'));
    expect(normalized.bytes.readUInt32BE(16)).toBe(8);
    expect(normalized.bytes.readUInt32BE(20)).toBe(8);
  });

  it('uses distinct crop and fit behavior for the same target canvas', async () => {
    const source = ppmFixture();
    const crop = await normalizeImage(source, { targetWidth: 8, targetHeight: 8, fit: 'cover', outputFormat: 'png' });
    const fit = await normalizeImage(source, { targetWidth: 8, targetHeight: 8, fit: 'contain', outputFormat: 'png' });

    expect(crop.bytes.equals(fit.bytes)).toBe(false);
    expect(fit.bytes.readUInt32BE(16)).toBe(8);
    expect(fit.bytes.readUInt32BE(20)).toBe(8);
  });

  it('emits a WebP asset with a matching MIME type at the requested quality', async () => {
    const lowerQuality = await normalizeImage(ppmFixture(), {
      targetWidth: 64,
      targetHeight: 64,
      fit: 'cover',
      outputFormat: 'webp',
      quality: 30
    });
    const higherQuality = await normalizeImage(ppmFixture(), {
      targetWidth: 64,
      targetHeight: 64,
      fit: 'cover',
      outputFormat: 'webp',
      quality: 90
    });

    expect(lowerQuality.mimeType).toBe('image/webp');
    expect(lowerQuality.bytes.toString('ascii', 0, 4)).toBe('RIFF');
    expect(lowerQuality.bytes.toString('ascii', 8, 12)).toBe('WEBP');
    expect(lowerQuality.bytes.equals(higherQuality.bytes)).toBe(false);
  });

  it('preserves transparent pixels in lossy WebP output', async () => {
    const normalized = await normalizeImage(rgbaPngFixture(), {
      targetWidth: 2,
      targetHeight: 1,
      fit: 'cover',
      outputFormat: 'webp',
      quality: 75
    });
    const decoded = spawnSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'image2pipe', '-i', 'pipe:0', '-frames:v', '1',
      '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'
    ], { input: normalized.bytes, maxBuffer: 1024 * 1024 });

    expect(normalized.mimeType).toBe('image/webp');
    expect(decoded.status).toBe(0);
    expect(decoded.stdout[3]).toBeGreaterThan(200);
    expect(decoded.stdout[7]).toBeLessThan(10);
  });

  it('applies all JPEG EXIF orientations before resizing', async () => {
    const source = encodeJpegFixture();
    const unrotated = await normalizeImage(withExifOrientation(source, 1), targetOptions);

    for (const orientation of [2, 3, 4, 5, 6, 7, 8]) {
      const oriented = await normalizeImage(withExifOrientation(source, orientation), targetOptions);
      expect(oriented.bytes.equals(unrotated.bytes)).toBe(false);
    }
  });

  it('normalizes the first frame of animated input', async () => {
    const animated = animatedGifFixture();
    const normalized = await normalizeImage(animated, targetOptions);
    const decoded = spawnSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'image2pipe', '-i', 'pipe:0', '-frames:v', '1',
      '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'
    ], { input: normalized.bytes, maxBuffer: 1024 * 1024 });

    expect(decoded.status).toBe(0);
    expect(decoded.stdout.length).toBe(8 * 8 * 3);
    expect(decoded.stdout[0]).toBeGreaterThan(200);
    expect(decoded.stdout[1]).toBeLessThan(50);
    expect(decoded.stdout[2]).toBeLessThan(50);
  });

  it('rejects decoder pixel-limit failures without exposing FFmpeg diagnostics', async () => {
    const error = await normalizeImage(ppmFixture(), {
      ...targetOptions,
      limits: { maxPixels: 7 }
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ImageProcessingError);
    expect(error).toMatchObject({ code: 'IMAGE_INVALID' });
    expect((error as Error).message).not.toMatch(/ffmpeg|pixels|error:/i);
  });

  it('terminates when normalized output exceeds the configured byte cap', async () => {
    await expect(normalizeImage(ppmFixture(), {
      ...targetOptions,
      limits: { maxOutputBytes: 16 }
    })).rejects.toMatchObject({ code: 'IMAGE_OUTPUT_TOO_LARGE' });
  });
});

const targetOptions = { targetWidth: 8, targetHeight: 8, fit: 'cover' as const, outputFormat: 'png' as const };

function ppmFixture(): Buffer {
  const header = Buffer.from('P6\n4 2\n255\n', 'ascii');
  const pixels = Buffer.from([
    255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0,
    0, 255, 255, 255, 0, 255, 128, 128, 128, 255, 255, 255
  ]);
  return Buffer.concat([header, pixels]);
}

function encodeJpegFixture(): Buffer {
  const encoded = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'image2pipe', '-i', 'pipe:0',
    '-frames:v', '1', '-c:v', 'mjpeg', '-q:v', '2',
    '-f', 'image2pipe', 'pipe:1'
  ], { input: ppmFixture(), maxBuffer: 1024 * 1024 });
  if (encoded.status !== 0 || encoded.stdout.length === 0) {
    throw new Error('Unable to create the JPEG test fixture.');
  }
  return encoded.stdout;
}

function withExifOrientation(jpeg: Buffer, orientation: number): Buffer {
  const tiff = Buffer.alloc(26);
  tiff.write('II', 0, 'ascii');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x0112, 10);
  tiff.writeUInt16LE(3, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt16LE(orientation, 18);
  const exif = Buffer.concat([Buffer.from('Exif\0\0', 'ascii'), tiff]);
  const app1 = Buffer.alloc(4 + exif.length);
  app1[0] = 0xff;
  app1[1] = 0xe1;
  app1.writeUInt16BE(exif.length + 2, 2);
  exif.copy(app1, 4);
  return Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]);
}

function animatedGifFixture(): Buffer {
  const frames = Buffer.concat([solidPpmFixture([255, 0, 0]), solidPpmFixture([0, 255, 0])]);
  const encoded = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', '1', '-i', 'pipe:0',
    '-loop', '0', '-f', 'gif', 'pipe:1'
  ], { input: frames, maxBuffer: 1024 * 1024 });
  if (encoded.status !== 0 || encoded.stdout.length === 0) {
    throw new Error('Unable to create the animated image test fixture.');
  }
  return encoded.stdout;
}

function solidPpmFixture(color: readonly [number, number, number]): Buffer {
  const pixels = Buffer.from([...color, ...color, ...color, ...color]);
  return Buffer.concat([Buffer.from('P6\n2 2\n255\n', 'ascii'), pixels]);
}

function rgbaPngFixture(): Buffer {
  const rgba = Buffer.from([255, 0, 0, 255, 0, 255, 0, 0]);
  const encoded = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', '2x1', '-i', 'pipe:0',
    '-frames:v', '1', '-pix_fmt', 'rgba', '-c:v', 'png',
    '-f', 'image2pipe', 'pipe:1'
  ], { input: rgba, maxBuffer: 1024 * 1024 });
  if (encoded.status !== 0 || encoded.stdout.length === 0) {
    throw new Error('Unable to create the transparent PNG test fixture.');
  }
  return encoded.stdout;
}
