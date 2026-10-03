import { isRoomBackgroundValue, MAX_ROOM_BACKGROUND_LENGTH, type RoomBackgroundVariants } from '@hotel/shared';
import { ImageProcessingError, normalizeImage } from './image-processor';

const ROOM_BACKGROUND_QUALITIES = [86, 76, 66, 56, 46, 36, 26, 16, 8] as const;

/** Decode an uploaded source image and produce the bounded ROOM display variants. */
export async function normalizeRoomBackgroundImage(inputBytes: Buffer): Promise<RoomBackgroundVariants> {
  for (const quality of ROOM_BACKGROUND_QUALITIES) {
    const [square, tablet] = await Promise.all([
      normalizeImage(inputBytes, {
        targetWidth: 480,
        targetHeight: 480,
        fit: 'cover',
        outputFormat: 'webp',
        quality
      }),
      normalizeImage(inputBytes, {
        targetWidth: 1024,
        targetHeight: 768,
        fit: 'cover',
        outputFormat: 'webp',
        quality
      })
    ]);
    const variants = {
      square480: toWebpDataUrl(square.bytes),
      tablet: toWebpDataUrl(tablet.bytes)
    };

    if (variants.square480.length + variants.tablet.length < MAX_ROOM_BACKGROUND_LENGTH
      && isRoomBackgroundValue(variants)) {
      return variants;
    }
  }

  throw new ImageProcessingError('IMAGE_OUTPUT_TOO_LARGE');
}

function toWebpDataUrl(bytes: Buffer): string {
  return `data:image/webp;base64,${bytes.toString('base64')}`;
}
