import type { InformationImageVariant } from '@hotel/shared';
import type { InformationImageUpload } from '../domain/hotel-service';
import { MAX_IMAGE_INPUT_BYTES, MAX_IMAGE_OUTPUT_BYTES, normalizeImage } from './image-processor';

const INFORMATION_IMAGE_TARGETS: Record<InformationImageVariant | 'legacy', { width: number; height: number }> = {
  square480: { width: 480, height: 480 },
  wide: { width: 1280, height: 720 },
  legacy: { width: 1280, height: 720 }
};

/** Normalize every submitted source before the caller persists any of them. */
export async function normalizeInformationImageUploads(
  uploads: readonly InformationImageUpload[],
  maximumBytes: number
): Promise<InformationImageUpload[]> {
  const normalizedUploads: InformationImageUpload[] = [];
  const maxInputBytes = Math.min(maximumBytes, MAX_IMAGE_INPUT_BYTES);
  const maxOutputBytes = Math.min(maximumBytes, MAX_IMAGE_OUTPUT_BYTES);

  for (const upload of uploads) {
    const target = INFORMATION_IMAGE_TARGETS[upload.variant ?? 'legacy'];
    const normalized = await normalizeImage(upload.bytes, {
      targetWidth: target.width,
      targetHeight: target.height,
      fit: 'contain',
      outputFormat: 'webp',
      quality: 90,
      limits: { maxInputBytes, maxOutputBytes }
    });
    normalizedUploads.push({ ...upload, bytes: normalized.bytes });
  }

  return normalizedUploads;
}
