/**
 * Photos as a phone hands them over, made into images a project can store
 * (U1, 8 Oct).
 *
 * Sean, 7 Oct: "I'm just adding from my photos on my iPhone so wasn't sure if
 * it was my end or PromptMaster that it couldn't read it." An iPhone photo is
 * HEIC, or a JPEG of 3–12 MB; the project took PNG, JPEG, WebP and GIF up to
 * 5 MB, and said only that the file was the wrong kind or too large. Now a
 * HEIC/HEIF photo is converted to JPEG in the browser (Safari decodes it
 * natively; elsewhere a converter is loaded on demand), and a photo too large
 * or too big to store is scaled down to fit. Nothing is uploaded first: the
 * stored file is the converted one.
 */

import { MAX_FILE_BYTES, extensionOf } from './preview';

/** Longest side kept: far more than any page or export shows. */
export const MAX_IMAGE_SIDE = 4096;
const QUALITIES = [0.85, 0.75, 0.65, 0.5];

export function isHeic(file: Pick<File, 'name' | 'type'>): boolean {
  return ['.heic', '.heif'].includes(extensionOf(file.name)) || /image\/hei[cf]/i.test(file.type);
}

const baseName = (name: string) => (name.lastIndexOf('.') > 0 ? name.slice(0, name.lastIndexOf('.')) : name);

/** The size an image is drawn at so its longest side is at most `max`. */
export function fitWithin(width: number, height: number, max = MAX_IMAGE_SIDE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export interface NormalizedImage {
  file: File;
  /** What was done, in a sentence for the user; '' when nothing was needed. */
  note: string;
}

async function decode(file: Blob): Promise<ImageBitmap | null> {
  try {
    return await createImageBitmap(file);
  } catch {
    return null;
  }
}

async function heicToJpeg(file: File): Promise<Blob> {
  const { default: heic2any } = await import('heic2any');
  const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
  return Array.isArray(out) ? out[0] : out;
}

async function encode(bitmap: ImageBitmap, width: number, height: number, quality: number): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, width, height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', quality));
}

/**
 * The image as it should be stored, or an error the user can act on. A file
 * already small enough, in a format the project takes, comes back unchanged.
 */
export async function normalizeImage(file: File): Promise<NormalizedImage | { error: string }> {
  const heic = isHeic(file);
  if (!heic && file.size <= MAX_FILE_BYTES) {
    const bitmap = await decode(file);
    const fits = !bitmap || Math.max(bitmap.width, bitmap.height) <= MAX_IMAGE_SIDE;
    bitmap?.close();
    if (fits) return { file, note: '' };
  }

  // Safari decodes HEIC itself; Chrome and Firefox need the converter.
  let bitmap = await decode(file);
  if (!bitmap && heic) {
    try {
      bitmap = await decode(await heicToJpeg(file));
    } catch {
      return { error: `${file.name} is an iPhone photo (HEIC) this browser could not convert. In the Photos app, share it as JPEG ("Most Compatible") and attach that.` };
    }
  }
  if (!bitmap) return { error: `${file.name} could not be read as an image.` };

  const { width, height } = fitWithin(bitmap.width, bitmap.height);
  try {
    for (const q of QUALITIES) {
      const blob = await encode(bitmap, width, height, q);
      if (blob && blob.size <= MAX_FILE_BYTES) {
        const out = new File([blob], `${baseName(file.name)}.jpg`, { type: 'image/jpeg' });
        const what = [
          heic ? 'converted from HEIC to JPEG' : '',
          width < bitmap.width ? `scaled to ${width}×${height}` : '',
          file.size > MAX_FILE_BYTES ? `reduced from ${(file.size / 1_000_000).toFixed(1)} MB to ${(blob.size / 1_000_000).toFixed(1)} MB` : '',
        ].filter(Boolean);
        return { file: out, note: `${file.name} was ${what.join(', ') || 'saved as JPEG'}.` };
      }
    }
  } finally {
    bitmap.close();
  }
  return { error: `${file.name} is too large to store even when scaled down.` };
}
