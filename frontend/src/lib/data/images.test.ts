import { describe, expect, it } from 'vitest';

import { hintWithImages, imageMarkdown, imagesPromptBlock, placedImageIds, resolveImageRefs } from './images';
import { imagePreview } from './preview';
import type { ProjectFile } from '@/types/project';

const file = (id: string, name: string, caption: string): ProjectFile =>
  ({ id, name, path: `u/p/${id}-${name}`, preview: imagePreview(name, caption) }) as ProjectFile;
const csv = { id: 'c1', name: 'a.csv', path: 'u/p/c1', preview: { kind: 'table', columns: ['x'], sample: [], rows: 3 } } as unknown as ProjectFile;
const lion = file('11111111-aaaa', 'lion.jpg', 'A lioness at dusk');

describe('images in the work (3 Oct call)', () => {
  it('tells a prompt each image by caption with the exact text that places it', () => {
    const block = imagesPromptBlock([csv, lion]);
    expect(block).toContain('You cannot see them');
    expect(block).toContain('- A lioness at dusk (lion.jpg): ![A lioness at dusk](project-file:11111111-aaaa)');
    expect(block).not.toContain('a.csv');
  });

  it('adds nothing for a project without images', () => {
    expect(imagesPromptBlock([csv])).toBe('');
    expect(hintWithImages('Write the chapter.', [csv])).toBe('Write the chapter.');
  });

  it('keeps the hint within the endpoint limit, dropping whole image lines', () => {
    const many = Array.from({ length: 30 }, (_, i) => file(`${i}`.padStart(8, '0'), `p${i}.png`, 'x'.repeat(150)));
    const hint = hintWithImages('Write it.', many);
    expect(hint.length).toBeLessThanOrEqual(4_000);
    expect(hint.endsWith(')')).toBe(true);
  });

  it('finds and resolves placed images; an unknown one becomes its caption', () => {
    const text = `Intro\n\n${imageMarkdown({ id: '11111111-aaaa', caption: 'A lioness' })}\n\n![Gone](project-file:22222222-bbbb)`;
    expect(placedImageIds(text)).toEqual(['11111111-aaaa', '22222222-bbbb']);
    const out = resolveImageRefs(text, (id) => (id === '11111111-aaaa' ? 'https://x/lion.jpg' : null));
    expect(out).toContain('![A lioness](https://x/lion.jpg)');
    expect(out).toContain('*[Image: Gone]*');
  });
});
