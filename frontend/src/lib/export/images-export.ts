/**
 * The project's images, made ready for an export (3 Oct call: photos in the work).
 *
 * A Word file embeds each placed image; a Markdown file links to it for a
 * week. The text itself keeps `project-file:<id>`, so nothing about the work
 * depends on a link that expires.
 */

import { placedImageIds, projectImages, resolveImageRefs } from '@/lib/data/images';
import { signedFileUrls } from '@/lib/supabase/project-files';
import type { DocImage } from './docx-export';
import type { ProjectFile } from '@/types/project';

const WEEK = 7 * 24 * 3600;

/** Markdown with each placed image as a link that works for a week. */
export async function markdownWithImageLinks(markdown: string, files: readonly ProjectFile[] | undefined): Promise<string> {
  const placed = new Set(placedImageIds(markdown));
  if (!placed.size) return markdown;
  const images = projectImages(files).filter((f) => placed.has(f.id));
  const urls = await signedFileUrls(images, WEEK).catch(() => ({}) as Record<string, string>);
  return resolveImageRefs(markdown, (id) => urls[id] ?? null);
}

function wordType(contentType: string, name: string): DocImage['type'] {
  const t = `${contentType} ${name}`.toLowerCase();
  if (/png/.test(t)) return 'png';
  if (/jpe?g/.test(t)) return 'jpg';
  if (/gif/.test(t)) return 'gif';
  return null; // WebP: Word cannot hold it; the export captions it instead.
}

/** The bytes of every image the text places, for the Word export. */
export async function imagesForDocx(markdown: string, files: readonly ProjectFile[] | undefined): Promise<Record<string, DocImage>> {
  const placed = new Set(placedImageIds(markdown));
  const images = projectImages(files).filter((f) => placed.has(f.id));
  if (!images.length) return {};
  const urls = await signedFileUrls(images, 600).catch(() => ({}) as Record<string, string>);
  const out: Record<string, DocImage> = {};
  await Promise.all(
    images.map(async (f) => {
      const url = urls[f.id];
      if (!url) return;
      try {
        const res = await fetch(url);
        if (!res.ok) return;
        out[f.id] = {
          data: await res.arrayBuffer(),
          type: wordType(f.content_type, f.name),
          width: f.preview.width ?? 0,
          height: f.preview.height ?? 0,
        };
      } catch {
        // Left out: the export captions it rather than failing.
      }
    })
  );
  return out;
}
