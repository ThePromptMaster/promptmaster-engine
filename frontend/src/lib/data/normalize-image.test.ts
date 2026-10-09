import { afterEach, describe, expect, it, vi } from 'vitest';

import { decodeThroughElement, fitWithin, isHeic, normalizeImage } from './normalize-image';
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

describe('a photo the browser will not decode directly (U5; iPad, 9 Oct)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is decoded through an image element, drawn at the size kept', async () => {
    const drawn: number[][] = [];
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined }));
    vi.stubGlobal('Image', class {
      naturalWidth = 8064; naturalHeight = 6048; decoding = ''; src = '';
      decode() { return Promise.resolve(); }
    });
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: (_img: unknown, _x: number, _y: number, w: number, h: number) => drawn.push([w, h]),
    } as never);
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 4096, height: 3072, close() {} })));
    const bitmap = await decodeThroughElement(new Blob([new Uint8Array(10)]));
    expect(bitmap).toMatchObject({ width: 4096, height: 3072 });
    expect(drawn).toEqual([[4096, 3072]]);
    getContext.mockRestore();
  });

  it('reports nothing it could not read, rather than throwing', async () => {
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined }));
    vi.stubGlobal('Image', class { decode() { return Promise.reject(new Error('EncodingError')); } });
    expect(await decodeThroughElement(new Blob([new Uint8Array(10)]))).toBeNull();
  });
});
