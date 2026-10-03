import { spawnSync } from 'node:child_process';
import { isRoomBackgroundValue, MAX_ROOM_BACKGROUND_LENGTH } from '@hotel/shared';
import { describe, expect, it } from 'vitest';
import { normalizeRoomBackgroundImage } from '../../apps/server/src/images/room-background-normalizer';

const ffmpegAvailable = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
const describeFfmpeg = ffmpegAvailable ? describe : describe.skip;

describeFfmpeg('ROOM background image normalization', () => {
  it('returns bounded square and tablet WebP data URLs from image bytes', async () => {
    const normalized = await normalizeRoomBackgroundImage(ppmFixture());

    expect(isRoomBackgroundValue(normalized)).toBe(true);
    expect(normalized.square480).toMatch(/^data:image\/webp;base64,/);
    expect(normalized.tablet).toMatch(/^data:image\/webp;base64,/);
    expect(normalized.square480.length + normalized.tablet.length).toBeLessThan(MAX_ROOM_BACKGROUND_LENGTH);
    expect(webpBytes(normalized.square480).toString('ascii', 0, 4)).toBe('RIFF');
    expect(webpBytes(normalized.tablet).toString('ascii', 8, 12)).toBe('WEBP');
  });

  it('rejects undecodable image content with a sanitized decoder error', async () => {
    await expect(normalizeRoomBackgroundImage(Buffer.from('not an image'))).rejects.toMatchObject({
      code: 'IMAGE_INVALID',
      message: 'The image is invalid, unsupported, or exceeds the supported dimensions.'
    });
  });
});

function ppmFixture(): Buffer {
  return Buffer.concat([
    Buffer.from('P6\n2 1\n255\n', 'ascii'),
    Buffer.from([220, 80, 30, 10, 120, 220])
  ]);
}

function webpBytes(value: string): Buffer {
  return Buffer.from(value.slice('data:image/webp;base64,'.length), 'base64');
}
