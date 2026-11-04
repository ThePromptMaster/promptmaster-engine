import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Artifact } from '@/types/project';
import { BOOK_V1 } from './templates/book.v1';
import type { StageArtifactBundle } from './digest';
import { ManuscriptMissing, withFreshManuscript } from './fresh-manuscript';

const getArtifact = vi.fn<(id: string) => Promise<Artifact | null>>();
const listArtifacts = vi.fn<(projectId: string) => Promise<Artifact[]>>();
vi.mock('@/lib/supabase/versions', () => ({ getArtifact: (id: string) => getArtifact(id), listArtifacts: (id: string) => listArtifacts(id) }));

const stage = (id: string) => BOOK_V1.stages.find((s) => s.id === id)!;
const drafting = BOOK_V1.stages.find((s) => s.renderer === 'long_form')!;
const artifact = (content: string) =>
  ({ id: 'a1', long_form: { outline: [{ id: 's1', title: 'One', content, status: content ? 'complete' : 'pending' }] } }) as unknown as Artifact;
const bundles = (content: string): Record<string, StageArtifactBundle> => ({ [drafting.id]: { artifact: artifact(content), versions: [] } });

beforeEach(() => {
  getArtifact.mockReset();
  listArtifacts.mockReset();
});

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

describe('the chapters are found when the page has none (25 Oct, Sean: Continuity, Critique and Fact-check said no draft text again)', () => {
  const after = BOOK_V1.stages[BOOK_V1.stages.indexOf(drafting) + 1];
  const onStage = (id: string, content: string, kind = 'manuscript') =>
    ({ id, stage_id: drafting.id, kind, long_form: { outline: [{ id: 's1', title: 'One', content, status: 'complete' }] } }) as unknown as Artifact;

  it('reads the drafting artifact from the database when the page holds no artifact for it', async () => {
    listArtifacts.mockResolvedValue([onStage('a9', 'Chapter one, in the database.')]);
    const out = await withFreshManuscript(BOOK_V1, after, {}, 'p1');
    expect(out[drafting.id].artifact?.long_form?.outline?.[0].content).toBe('Chapter one, in the database.');
    expect(getArtifact).not.toHaveBeenCalled();
  });

  it('takes the artifact on that stage that holds chapters, not the empty one the page points at', async () => {
    getArtifact.mockResolvedValue(artifact(''));
    listArtifacts.mockResolvedValue([onStage('outline', 'The chapters, on the outline row.', 'outline'), onStage('a1', '')]);
    const out = await withFreshManuscript(BOOK_V1, after, bundles(''), 'p1');
    expect(out[drafting.id].artifact?.long_form?.outline?.[0].content).toBe('The chapters, on the outline row.');
  });

  it('still refuses when nothing on the stage has text', async () => {
    listArtifacts.mockResolvedValue([onStage('a1', '')]);
    await expect(withFreshManuscript(BOOK_V1, after, {}, 'p1')).rejects.toBeInstanceOf(ManuscriptMissing);
  });
});

describe('a check is never written about work that has no saved text (4 Nov, Sean)', () => {
  // "A downstream stage should receive the current artifact and report when a required input is missing."
  const memo = {
    ...BOOK_V1,
    key: 'custom_memo',
    stages: [
      { ...BOOK_V1.stages[0], id: 'draft', label: 'Draft decision memo', renderer: 'prose' as const },
      { ...BOOK_V1.stages.find((s) => s.renderer === 'review')!, id: 'check', label: 'Check memo against brief' },
      { ...BOOK_V1.stages[0], id: 'final', label: 'Final decision memo', renderer: 'prose' as const },
    ],
  };
  const version = (content: string) => ({ versions: [{ id: 'v1', content }] }) as unknown as StageArtifactBundle;

  it('the check reads the nearest written stage before it', async () => {
    const { checkedStageFor } = await import('./fresh-manuscript');
    expect(checkedStageFor(memo, memo.stages[1])?.id).toBe('draft');
    // A written stage is not a check, and Book's checks read the manuscript instead.
    expect(checkedStageFor(memo, memo.stages[2])).toBeNull();
    expect(checkedStageFor(BOOK_V1, BOOK_V1.stages[BOOK_V1.stages.indexOf(drafting) + 1])).toBeNull();
  });

  it('refuses, naming the stage it needs, while that stage is empty', async () => {
    const { InputMissing } = await import('./fresh-manuscript');
    await expect(withFreshManuscript(memo, memo.stages[1], {})).rejects.toBeInstanceOf(InputMissing);
    await expect(withFreshManuscript(memo, memo.stages[1], { draft: version('  ') })).rejects.toThrow(
      'There is nothing in Draft decision memo yet, so this check has nothing to read. Write Draft decision memo first.'
    );
    const ready = { draft: version('# Memo\nText.') };
    await expect(withFreshManuscript(memo, memo.stages[1], ready)).resolves.toBe(ready);
    expect(getArtifact).not.toHaveBeenCalled();
  });

  it('a missing manuscript is still a missing input', async () => {
    const { InputMissing } = await import('./fresh-manuscript');
    expect(new ManuscriptMissing('Drafting')).toBeInstanceOf(InputMissing);
  });
});
