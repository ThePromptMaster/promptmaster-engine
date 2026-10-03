/**
 * Images attached to a project, as the work refers to them. Pure.
 *
 * An image is placed in a draft as `![caption](project-file:<id>)`. The id is
 * stable, unlike a signed URL, so the text keeps working after the link that
 * displays it expires; `markdown-output` resolves it when it is drawn and the
 * exports when they are made.
 */

import type { ProjectFile } from '@/types/project';

export const IMAGE_SCHEME = 'project-file:';
const REF = /!\[([^\]]*)\]\(project-file:([0-9a-f-]{8,})\)/gi;

export interface ImageBrief {
  id: string;
  name: string;
  caption: string;
}

export function projectImages(files: readonly ProjectFile[] | undefined): ProjectFile[] {
  return (files ?? []).filter((f) => f.preview?.kind === 'image');
}

export function imageBriefs(files: readonly ProjectFile[] | undefined): ImageBrief[] {
  return projectImages(files).map((f) => ({ id: f.id, name: f.name, caption: f.preview.caption ?? f.name }));
}

export function imageMarkdown(image: Pick<ImageBrief, 'id' | 'caption'>): string {
  return `![${image.caption.replace(/[[\]]/g, '')}](${IMAGE_SCHEME}${image.id})`;
}

/**
 * What a prompt is told about the images: their captions and the exact text
 * that places each one. Empty when there are none, so a project without images
 * gets exactly the prompt it had.
 */
export function imagesPromptBlock(files: readonly ProjectFile[] | undefined): string {
  const images = imageBriefs(files);
  if (!images.length) return '';
  return [
    'IMAGES THE USER UPLOADED. You cannot see them; you know only what each caption says. Where one',
    'genuinely helps the reader, place it on a line of its own using exactly the text given, and refer to',
    'it in the prose. Never invent an image, and do not place one that does not fit:',
    ...images.map((i) => `- ${i.caption} (${i.name}): ${imageMarkdown(i)}`),
  ].join('\n');
}

/** The longest hint the section endpoint accepts (`stage_hint`, 4,000). */
const HINT_MAX = 4_000;

/** A stage's hint with the images block after it, kept within the endpoint's limit. */
export function hintWithImages(hint: string | undefined, files: readonly ProjectFile[] | undefined): string {
  const base = (hint ?? '').trim();
  const block = imagesPromptBlock(files);
  if (!block) return base;
  const joined = base ? `${base}\n\n${block}` : block;
  if (joined.length <= HINT_MAX) return joined;
  // Drop whole image lines from the end rather than cut one mid-reference.
  const lines = joined.split('\n');
  while (lines.join('\n').length > HINT_MAX && lines.length > 1) lines.pop();
  return lines.join('\n');
}

/** Every image id a text places, in order of first appearance. */
export function placedImageIds(text: string): string[] {
  const seen: string[] = [];
  for (const m of text.matchAll(REF)) if (!seen.includes(m[2])) seen.push(m[2]);
  return seen;
}

/** Replace each placed image's reference with `resolve(id)`; unknown ids become their caption. */
export function resolveImageRefs(text: string, resolve: (id: string) => string | null): string {
  return text.replace(REF, (_m, alt: string, id: string) => {
    const url = resolve(id);
    return url ? `![${alt}](${url})` : `*[Image: ${alt}]*`;
  });
}
