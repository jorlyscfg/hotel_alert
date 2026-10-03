import { spawn } from 'node:child_process';

export const MAX_IMAGE_INPUT_BYTES = 50 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 24_000_000;
export const MAX_IMAGE_OUTPUT_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 4096;
export const MAX_IMAGE_PROCESSING_TIMEOUT_MS = 15_000;
export const DEFAULT_WEBP_QUALITY = 80;
export const MAX_WEBP_QUALITY = 100;

export type ImageFitMode = 'cover' | 'contain';
export type ImageOutputFormat = 'png' | 'webp';

export interface ImageProcessingLimits {
  maxInputBytes?: number;
  maxPixels?: number;
  maxOutputBytes?: number;
  timeoutMs?: number;
}

export interface NormalizeImageOptions {
  targetWidth: number;
  targetHeight: number;
  fit: ImageFitMode;
  outputFormat?: ImageOutputFormat;
  quality?: number;
  ffmpegPath?: string;
  limits?: ImageProcessingLimits;
}

export interface NormalizedImage {
  bytes: Buffer;
  mimeType: 'image/png' | 'image/webp';
  width: number;
  height: number;
}

export type ImageProcessingErrorCode =
  | 'IMAGE_EMPTY'
  | 'IMAGE_TOO_LARGE'
  | 'IMAGE_INVALID_OPTIONS'
  | 'IMAGE_INVALID'
  | 'IMAGE_PROCESSOR_UNAVAILABLE'
  | 'IMAGE_PROCESSING_TIMEOUT'
  | 'IMAGE_OUTPUT_TOO_LARGE';

const SAFE_MESSAGES: Record<ImageProcessingErrorCode, string> = {
  IMAGE_EMPTY: 'The image file is empty.',
  IMAGE_TOO_LARGE: 'The image file exceeds the supported size.',
  IMAGE_INVALID_OPTIONS: 'The image processing options are invalid.',
  IMAGE_INVALID: 'The image is invalid, unsupported, or exceeds the supported dimensions.',
  IMAGE_PROCESSOR_UNAVAILABLE: 'Image processing is temporarily unavailable.',
  IMAGE_PROCESSING_TIMEOUT: 'Image processing took too long.',
  IMAGE_OUTPUT_TOO_LARGE: 'The processed image exceeds the supported size.'
};

export class ImageProcessingError extends Error {
  public readonly code: ImageProcessingErrorCode;

  public constructor(code: ImageProcessingErrorCode) {
    super(SAFE_MESSAGES[code]);
    this.name = 'ImageProcessingError';
    this.code = code;
  }
}

/** Decode untrusted image bytes and return a bounded PNG or lossy WebP display asset. */
export async function normalizeImage(
  inputBytes: Buffer,
  options: NormalizeImageOptions
): Promise<NormalizedImage> {
  if (!Buffer.isBuffer(inputBytes) || inputBytes.length === 0) {
    throw new ImageProcessingError('IMAGE_EMPTY');
  }

  const limits = resolveLimits(options?.limits);
  if (inputBytes.length > limits.maxInputBytes) {
    throw new ImageProcessingError('IMAGE_TOO_LARGE');
  }

  validateTarget(options);
  const output = resolveOutputFormat(options);
  const ffmpegPath = options.ffmpegPath ?? process.env['FFMPEG_PATH'] ?? 'ffmpeg';
  if (typeof ffmpegPath !== 'string' || ffmpegPath.trim().length === 0) {
    throw new ImageProcessingError('IMAGE_INVALID_OPTIONS');
  }

  const exifOrientation = readJpegExifOrientation(inputBytes);
  const bytes = await runFfmpeg(inputBytes, options, ffmpegPath, limits, exifOrientation, output);
  return {
    bytes,
    mimeType: output.format === 'webp' ? 'image/webp' : 'image/png',
    width: options.targetWidth,
    height: options.targetHeight
  };
}

interface ResolvedLimits {
  maxInputBytes: number;
  maxPixels: number;
  maxOutputBytes: number;
  timeoutMs: number;
}

interface ResolvedOutputFormat {
  format: ImageOutputFormat;
  quality: number;
}

function resolveLimits(limits: ImageProcessingLimits | undefined): ResolvedLimits {
  return {
    maxInputBytes: boundedLimit(limits?.maxInputBytes, MAX_IMAGE_INPUT_BYTES),
    maxPixels: boundedLimit(limits?.maxPixels, MAX_IMAGE_PIXELS),
    maxOutputBytes: boundedLimit(limits?.maxOutputBytes, MAX_IMAGE_OUTPUT_BYTES),
    timeoutMs: boundedLimit(limits?.timeoutMs, MAX_IMAGE_PROCESSING_TIMEOUT_MS)
  };
}

function boundedLimit(value: number | undefined, ceiling: number): number {
  const limit = value ?? ceiling;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > ceiling) {
    throw new ImageProcessingError('IMAGE_INVALID_OPTIONS');
  }
  return limit;
}

function resolveOutputFormat(options: NormalizeImageOptions): ResolvedOutputFormat {
  const format = options.outputFormat ?? 'webp';
  if (format !== 'png' && format !== 'webp') {
    throw new ImageProcessingError('IMAGE_INVALID_OPTIONS');
  }
  if (format === 'png') {
    if (options.quality !== undefined) throw new ImageProcessingError('IMAGE_INVALID_OPTIONS');
    return { format, quality: DEFAULT_WEBP_QUALITY };
  }

  const quality = options.quality ?? DEFAULT_WEBP_QUALITY;
  if (!Number.isSafeInteger(quality) || quality < 1 || quality > MAX_WEBP_QUALITY) {
    throw new ImageProcessingError('IMAGE_INVALID_OPTIONS');
  }
  return { format, quality };
}

function validateTarget(options: NormalizeImageOptions): void {
  if (typeof options !== 'object' || options === null
    || !Number.isSafeInteger(options.targetWidth)
    || !Number.isSafeInteger(options.targetHeight)
    || options.targetWidth < 1
    || options.targetHeight < 1
    || options.targetWidth > MAX_IMAGE_DIMENSION
    || options.targetHeight > MAX_IMAGE_DIMENSION
    || options.targetWidth * options.targetHeight > MAX_IMAGE_PIXELS
    || (options.fit !== 'cover' && options.fit !== 'contain')) {
    throw new ImageProcessingError('IMAGE_INVALID_OPTIONS');
  }
}

function buildFilter(options: NormalizeImageOptions, exifOrientation: number | null): string {
  const { targetWidth: width, targetHeight: height } = options;
  const orientationFilter = exifOrientation === null ? null : jpegOrientationFilter(exifOrientation);
  const resizeFilter = options.fit === 'cover'
    ? `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1`
    : `scale=${width}:${height}:force_original_aspect_ratio=decrease,format=rgba,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black@0,setsar=1`;
  return orientationFilter === null ? resizeFilter : `${orientationFilter},${resizeFilter}`;
}

function jpegOrientationFilter(orientation: number): string | null {
  switch (orientation) {
    case 1: return null;
    case 2: return 'hflip';
    case 3: return 'hflip,vflip';
    case 4: return 'vflip';
    case 5: return 'transpose=clock,hflip';
    case 6: return 'transpose=clock';
    case 7: return 'transpose=clock,vflip';
    case 8: return 'transpose=cclock';
    default: return null;
  }
}

function readJpegExifOrientation(bytes: Buffer): number | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return null;
    const marker = bytes[offset] ?? 0;
    offset += 1;

    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 2 > bytes.length) return null;

    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2) return null;
    const segmentStart = offset + 2;
    const segmentEnd = offset + segmentLength;
    if (segmentEnd > bytes.length) return null;
    if (marker === 0xe1 && segmentEnd - segmentStart >= 14
      && bytes.toString('ascii', segmentStart, segmentStart + 6) === 'Exif\0\0') {
      const orientation = readTiffOrientation(bytes, segmentStart + 6, segmentEnd);
      if (orientation !== null) return orientation;
    }
    offset = segmentEnd;
  }
  return null;
}

function readTiffOrientation(bytes: Buffer, tiffStart: number, tiffEnd: number): number | null {
  if (tiffStart + 8 > tiffEnd) return null;
  const byteOrder = bytes.toString('ascii', tiffStart, tiffStart + 2);
  const littleEndian = byteOrder === 'II';
  if (!littleEndian && byteOrder !== 'MM') return null;
  const read16 = (offset: number): number => littleEndian ? bytes.readUInt16LE(offset) : bytes.readUInt16BE(offset);
  const read32 = (offset: number): number => littleEndian ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset);
  if (read16(tiffStart + 2) !== 42) return null;

  const ifdOffset = read32(tiffStart + 4);
  const ifdStart = tiffStart + ifdOffset;
  if (ifdStart + 2 > tiffEnd) return null;
  const entryCount = read16(ifdStart);
  for (let index = 0; index < entryCount; index += 1) {
    const entryStart = ifdStart + 2 + index * 12;
    if (entryStart + 12 > tiffEnd) return null;
    if (read16(entryStart) !== 0x0112) continue;
    const fieldType = read16(entryStart + 2);
    const valueCount = read32(entryStart + 4);
    if (fieldType !== 3 || valueCount < 1) return null;
    const valueOffset = valueCount <= 2 ? entryStart + 8 : tiffStart + read32(entryStart + 8);
    if (valueOffset + 2 > tiffEnd) return null;
    const orientation = read16(valueOffset);
    return orientation >= 1 && orientation <= 8 ? orientation : null;
  }
  return null;
}

function runFfmpeg(
  inputBytes: Buffer,
  options: NormalizeImageOptions,
  ffmpegPath: string,
  limits: ResolvedLimits,
  exifOrientation: number | null,
  output: ResolvedOutputFormat
): Promise<Buffer> {
  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-nostdin',
    '-threads', '1',
    '-probesize', '1M',
    '-analyzeduration', '1000000',
    '-max_pixels', String(limits.maxPixels),
    exifOrientation === null ? '-autorotate' : '-noautorotate',
    '-f', 'image2pipe',
    '-i', 'pipe:0',
    '-map', '0:v:0',
    '-frames:v', '1',
    '-vf', buildFilter(options, exifOrientation),
    '-map_metadata', '-1',
    '-map_chapters', '-1',
    '-threads', '1',
    '-pix_fmt', output.format === 'webp' ? 'bgra' : 'rgba',
    '-c:v', output.format === 'webp' ? 'libwebp' : 'png',
    ...(output.format === 'webp' ? ['-lossless', '0', '-quality', String(output.quality)] : []),
    '-f', 'image2pipe',
    'pipe:1'
  ];

  return new Promise<Buffer>((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(ffmpegPath, args, { stdio: ['pipe', 'pipe', 'ignore'], shell: false, windowsHide: true });
    } catch {
      reject(new ImageProcessingError('IMAGE_PROCESSOR_UNAVAILABLE'));
      return;
    }
    const stdout = child.stdout;
    const stdin = child.stdin;
    if (stdout === null || stdin === null) {
      child.kill('SIGKILL');
      reject(new ImageProcessingError('IMAGE_PROCESSOR_UNAVAILABLE'));
      return;
    }

    const chunks: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    let failure: ImageProcessingError | undefined;
    const timeout = setTimeout(() => {
      fail(new ImageProcessingError('IMAGE_PROCESSING_TIMEOUT'));
    }, limits.timeoutMs);
    timeout.unref?.();

    const rejectOnce = (error: ImageProcessingError): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    };

    const fail = (error: ImageProcessingError): void => {
      if (failure !== undefined || settled) return;
      failure = error;
      child.kill('SIGKILL');
    };

    stdout.on('data', (chunk: Buffer) => {
      if (failure !== undefined || settled) return;
      if (outputBytes + chunk.length > limits.maxOutputBytes) {
        fail(new ImageProcessingError('IMAGE_OUTPUT_TOO_LARGE'));
        return;
      }
      chunks.push(chunk);
      outputBytes += chunk.length;
    });

    // The decoder may exit early for malformed data; EPIPE is handled via the close event.
    stdin.on('error', () => undefined);

    child.once('error', () => {
      rejectOnce(new ImageProcessingError('IMAGE_PROCESSOR_UNAVAILABLE'));
    });

    child.once('close', (exitCode) => {
      if (failure !== undefined) {
        rejectOnce(failure);
        return;
      }
      if (exitCode !== 0 || outputBytes === 0) {
        rejectOnce(new ImageProcessingError('IMAGE_INVALID'));
        return;
      }
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(Buffer.concat(chunks, outputBytes));
    });

    stdin.end(inputBytes);
  });
}
