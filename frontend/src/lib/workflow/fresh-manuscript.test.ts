import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Artifact } from '@/types/project';
import { BOOK_V1 } from './templates/book.v1';
import type { StageArtifactBundle } from './digest';
import { ManuscriptMissing, withFreshManuscript } from './fresh-manuscript';

const getArtifact = vi.fn<(id: string) => Promise<Artifact | null>>();
vi.mock('@/lib/supabase/versions', () => ({ getArtifact: (id: string) => getArtifact(id) }));

const stage = (id: string) => BOOK_V1.stages.find((s) => s.id === id)!;
const drafting = BOOK_V1.stages.find((s) => s.renderer === 'long_form')!;
const artifact = (content: string) =>
  ({ id: 'a1', long_form: { outline: [{ id: 's1', title: 'One', content, status: content ? 'complete' : 'pending' }] } }) as unknown as Artifact;
const bundles = (content: string): Record<string, StageArtifactBundle> => ({ [drafting.id]: { artifact: artifact(content), versions: [] } });

beforeEach(() => getArtifact.mockReset());

describe('a stage after drafting reads the chapters as saved (Sean, 10 Oct, email 6.2)', () => {
  const after = BOOK_V1.stages[BOOK_V1.stages.indexOf(drafting) + 1];

  it('uses the database copy when the page has not caught up', async () => {
    getArtifact.mockResolvedValue(artifact('Chapter one, written by the job queue.'));
    const out = await withFreshManuscript(BOOK_V1, after, bundles(''));
    expect(out[drafting.id].artifact?.long_form?.outline?.[0].content).toBe('Chapter one, written by the job queue.');
  });

  it('refuses when no chapter has text, rather than reviewing a draft it was not given', async () => {
    getArtifact.mockResolvedValue(artifact(''));
    await expect(withFreshManuscript(BOOK_V1, after, bundles(''))).rejects.toBeInstanceOf(ManuscriptMissing);
  });

  it('falls back to the page copy when the database has no row', async () => {
    getArtifact.mockResolvedValue(null);
    const out = await withFreshManuscript(BOOK_V1, after, bundles('Page copy.'));
    expect(out[drafting.id].artifact?.long_form?.outline?.[0].content).toBe('Page copy.');
  });

  it('a stage before drafting is not touched', async () => {
    const out = await withFreshManuscript(BOOK_V1, stage(BOOK_V1.stages[0].id), bundles(''));
    expect(getArtifact).not.toHaveBeenCalled();
    expect(out[drafting.id].artifact?.long_form?.outline?.[0].content).toBe('');
  });
});
