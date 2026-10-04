import { describe, expect, it, vi } from 'vitest';

const getArtifact = vi.hoisted(() => vi.fn());
const saveLongForm = vi.hoisted(() => vi.fn());
const listVersions = vi.hoisted(() => vi.fn());
const ensureOutlineArtifact = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/versions', () => ({ getArtifact, saveLongForm, listVersions }));
vi.mock('@/lib/supabase/outline', () => ({ ensureOutlineArtifact, approveOutlineVersion: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ api: {} }));

import { isOutlineVersion, loadOutline, materialiseOutlineInto } from './actions';
import type { Artifact, ArtifactVersion } from '@/types/project';
import type { OutlineDocument } from '@/types/outline';

const doc = {
  items: [
    { id: 's1', title: 'One', abstract: 'a' },
    { id: 's2', title: 'Two', abstract: 'b' },
  ],
  orphans: [],
} as unknown as OutlineDocument;

const section = (id: string, content: string, status: string) => ({ id, title: id, abstract: '', content, status, word_count: content.split(' ').length });

describe('materialiseOutlineInto (4 Oct)', () => {
  it('merges over the row as it is now, so chapters the queue just wrote are kept', async () => {
    // The caller's copy predates section s1 being written server-side.
    const stale = { id: 'a1', long_form: { outline: [section('s1', '', 'pending')] } } as unknown as Artifact;
    getArtifact.mockResolvedValueOnce({ id: 'a1', long_form: { outline: [section('s1', 'Chapter one prose', 'complete')] } });

    await materialiseOutlineInto(doc, stale);

    const written = saveLongForm.mock.calls.at(-1)![1];
    expect(written.outline[0]).toMatchObject({ id: 's1', content: 'Chapter one prose', status: 'complete' });
    expect(written.outline.map((s: { id: string }) => s.id)).toEqual(['s1', 's2']);
  });
});

describe('the outline ignores prose filed on its row (4 Oct)', () => {
  const v = (content: string) => ({ id: content.slice(0, 3), content }) as ArtifactVersion;

  it('tells an outline version from a manuscript snapshot', () => {
    expect(isOutlineVersion(v('{"items":[]}'))).toBe(true);
    expect(isOutlineVersion(v('  [ {"title":"x"} ]'))).toBe(true);
    expect(isOutlineVersion(v('# The paper\n\n## 1. Intro'))).toBe(false);
  });

  it('loads only outline versions, so "Full draft saved" never becomes the outline\'s head', async () => {
    ensureOutlineArtifact.mockResolvedValueOnce({ id: 'o1', outline_draft: null });
    listVersions.mockResolvedValueOnce([v('{"items":[{"id":"s1","title":"One"}]}'), v('# Paper\n\n## 1. One\n\nProse')]);
    const loaded = await loadOutline({ id: 'p1', user_id: 'u1' }, 'drafting');
    expect(loaded.versions).toHaveLength(1);
    expect(loaded.versions[0].content.startsWith('{')).toBe(true);
  });
});
