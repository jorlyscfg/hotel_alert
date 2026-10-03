import type { InformationImageVariant } from '@hotel/shared';
import type { InformationImageUpload } from '../domain/hotel-service';
import { ImageProcessingError, MAX_IMAGE_INPUT_BYTES, MAX_IMAGE_OUTPUT_BYTES, normalizeImage } from './image-processor';

const INFORMATION_IMAGE_TARGETS: ReadonlyArray<{ variant: InformationImageVariant; width: number; height: number }> = [
  { variant: 'square480', width: 480, height: 480 },
  { variant: 'wide', width: 1280, height: 720 }
];

/** Build both shared display assets from one source before the caller persists either. */
export async function normalizeInformationImageUploads(
  uploads: readonly InformationImageUpload[],
  maximumBytes: number
): Promise<InformationImageUpload[]> {
  const source = uploads[0];
  if (uploads.length !== 1 || source === undefined || source.language !== undefined || source.variant !== undefined) {
    throw new ImageProcessingError('IMAGE_INVALID');
  }

  const normalizedUploads: InformationImageUpload[] = [];
  const maxInputBytes = Math.min(maximumBytes, MAX_IMAGE_INPUT_BYTES);
  const maxOutputBytes = Math.min(maximumBytes, MAX_IMAGE_OUTPUT_BYTES);

  for (const target of INFORMATION_IMAGE_TARGETS) {
    const normalized = await normalizeImage(source.bytes, {
      targetWidth: target.width,
      targetHeight: target.height,
      fit: 'cover',
      outputFormat: 'webp',
      quality: 90,
      limits: { maxInputBytes, maxOutputBytes }
    });
    normalizedUploads.push({ bytes: normalized.bytes, originalName: source.originalName, variant: target.variant });
  }

  return normalizedUploads;
}
