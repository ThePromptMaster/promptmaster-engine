import { describe, expect, it } from 'vitest';

import { fitWithin, isHeic, normalizeImage } from './normalize-image';
import { rejectReason } from './preview';

describe('iPhone photos (U1; Sean, 7 Oct)', () => {
  it('knows a HEIC photo by its name or its type', () => {
    expect(isHeic({ name: 'IMG_1234.HEIC', type: '' })).toBe(true);
    expect(isHeic({ name: 'photo', type: 'image/heif' })).toBe(true);
    expect(isHeic({ name: 'IMG_1234.JPG', type: 'image/jpeg' })).toBe(false);
  });

  it('a HEIC photo is no longer "not an image"', () => {
    expect(rejectReason('IMG_1234.HEIC', 2_000_000, [])).toBeNull();
  });

  it('scales the longest side to 4096 and keeps the shape', () => {
    expect(fitWithin(8064, 6048)).toEqual({ width: 4096, height: 3072 });
    expect(fitWithin(1200, 800)).toEqual({ width: 1200, height: 800 });
  });

  it('a small image in a format the project takes comes back unchanged', async () => {
    const file = new File([new Uint8Array(10)], 'chart.png', { type: 'image/png' });
    const out = await normalizeImage(file);
    expect(out).toEqual({ file, note: '' });
  });

  it('a HEIC this browser cannot convert says what to do', async () => {
    const out = await normalizeImage(new File([new Uint8Array(10)], 'IMG_1.HEIC', { type: 'image/heic' }));
    expect(out).toMatchObject({ error: expect.stringContaining('share it as JPEG') });
  });
});
