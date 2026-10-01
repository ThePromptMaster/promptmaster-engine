import { describe, expect, it } from 'vitest';

import { BOOK_V1, RESEARCH_V1, projectState } from './index';
import {
  MANUSCRIPT_MAX,
  SUMMARY_MAX,
  buildStageDigest,
  formatManuscript,
  summariseStageContent,
  type StageArtifactBundle,
} from './digest';
import { serializeItems } from './stage-artifact';
import type { WorkflowEvent } from './types';
import type { Artifact, ArtifactVersion, Project } from '@/types/project';

const PROJECT = {
  objective: 'A field guide to governing AI-assisted work.',
  audience: 'Engineering leads',
} as Pick<Project, 'objective' | 'audience'>;

function bundle(content: string, summary: string | null = null): StageArtifactBundle {
  return {
    artifact: { id: 'a', summary } as Artifact,
    versions: [{ id: 'v1', content } as ArtifactVersion],
  };
}

const ev = (type: WorkflowEvent['type'], stage_id: string, to?: string): WorkflowEvent => ({
  type,
  stage_id,
  to_stage_id: to,
  actor: 'user',
  created_at: '2026-09-04T00:00:00Z',
});

describe('summariseStageContent', () => {
  const objective = BOOK_V1.stages[0];
  const audience = BOOK_V1.stages[1];

  it('projects prose down to its opening', () => {
    const long = 'word '.repeat(400);
    expect(summariseStageContent(objective, long).length).toBeLessThanOrEqual(SUMMARY_MAX + 1);
  });

  it('cuts prose at a word boundary rather than mid-word', () => {
    const summary = summariseStageContent(objective, 'alpha '.repeat(200));
    expect(summary.endsWith('…')).toBe(true);
    expect(summary).not.toMatch(/alph…$/);
  });

  it('projects a list to what each row is, not the whole row', () => {
    const summary = summariseStageContent(
      audience,
      serializeItems([
        { id: 'i1', who: 'Engineering leads', prior_knowledge: 'x'.repeat(300) },
        { id: 'i2', who: 'Compliance officers', prior_knowledge: 'y'.repeat(300) },
      ])
    );
    expect(summary).toContain('Engineering leads');
    expect(summary).toContain('Compliance officers');
    expect(summary.length).toBeLessThanOrEqual(SUMMARY_MAX + 1);
  });

  it('keeps a review row’s status, which is the part a later stage acts on', () => {
    const factCheck = BOOK_V1.stages.find((s) => s.id === 'fact_check')!;
    const summary = summariseStageContent(
      factCheck,
      serializeItems([{ id: 'i1', claim: 'Nine in ten agree', status: 'removed' }])
    );
    expect(summary).toContain('[removed]');
  });

  it('is empty for an empty stage rather than noise', () => {
    expect(summariseStageContent(objective, '')).toBe('');
    expect(summariseStageContent(audience, serializeItems([]))).toBe('');
  });
});

describe('buildStageDigest', () => {
  const events = [
    ev('stage_completed', 'objective', 'audience'),
    ev('stage_completed', 'audience', 'positioning'),
  ];
  const state = projectState(BOOK_V1, events);

  const bundles: Record<string, StageArtifactBundle> = {
    objective: bundle('Give teams a defensible way to govern AI-written work.'),
    audience: bundle(serializeItems([{ id: 'i1', who: 'Engineering leads' }])),
  };

  it('carries the objective in full and prior stages as summaries', () => {
    const digest = buildStageDigest(BOOK_V1, state, PROJECT, bundles, 'positioning');
    expect(digest.objective).toBe(PROJECT.objective);
    expect(digest.prior_stages.map((s) => s.stage_id)).toEqual(['objective', 'audience']);
    expect(digest.prior_stages[0].summary).toContain('defensible');
  });

  it('never includes the stage being generated, or anything after it', () => {
    // Feeding a stage its own draft back would have it build on the thing it
    // was asked to replace.
    const digest = buildStageDigest(BOOK_V1, state, PROJECT, bundles, 'audience');
    expect(digest.prior_stages.map((s) => s.stage_id)).toEqual(['objective']);
  });

  it('excludes stages the user skipped', () => {
    // A skipped stage reached no conclusion; feeding one forward would have the
    // model build on something the user walked away from.
    const skipped = projectState(BOOK_V1, [
      ev('stage_skipped', 'objective', 'audience'),
      ev('stage_completed', 'audience', 'positioning'),
    ]);
    const digest = buildStageDigest(BOOK_V1, skipped, PROJECT, bundles, 'positioning');
    expect(digest.prior_stages.map((s) => s.stage_id)).toEqual(['audience']);
  });

  it('prefers the summary stored when the stage completed', () => {
    const withStored = {
      ...bundles,
      objective: bundle('The full artifact text, which is long.', 'Stored conclusion.'),
    };
    const digest = buildStageDigest(BOOK_V1, state, PROJECT, withStored, 'positioning');
    expect(digest.prior_stages[0].summary).toBe('Stored conclusion.');
  });

  it('falls back to projecting the head version when no summary was stored', () => {
    // Projects that predate stored summaries must still produce a digest.
    const digest = buildStageDigest(BOOK_V1, state, PROJECT, bundles, 'positioning');
    expect(digest.prior_stages[0].summary).not.toBe('');
  });

  it('grows with the number of stages, not the length of the book', () => {
    // The size bound the whole design rests on: twelve completed stages, each
    // holding a chapter, still produce a digest measured in hundreds of bytes.
    const chapter = 'word '.repeat(20000);
    const all: Record<string, StageArtifactBundle> = {};
    const completions: WorkflowEvent[] = [];
    BOOK_V1.stages.forEach((s, i) => {
      all[s.id] = bundle(chapter);
      const next = BOOK_V1.stages[i + 1];
      if (next) completions.push(ev('stage_completed', s.id, next.id));
    });

    const full = projectState(BOOK_V1, completions);
    const digest = buildStageDigest(BOOK_V1, full, PROJECT, all, 'final_review');
    const size = JSON.stringify(digest).length;
    expect(digest.prior_stages).toHaveLength(BOOK_V1.stages.length - 1);
    expect(size).toBeLessThan(BOOK_V1.stages.length * (SUMMARY_MAX + 200));
    expect(size).toBeLessThan(chapter.length / 10);
  });

  it('works on Research with no workflow-specific handling', () => {
    const first = RESEARCH_V1.stages[0];
    const second = RESEARCH_V1.stages[1];
    const state2 = projectState(RESEARCH_V1, [ev('stage_completed', first.id, second.id)]);
    const digest = buildStageDigest(
      RESEARCH_V1,
      state2,
      PROJECT,
      { [first.id]: bundle('A conclusion.') },
      second.id
    );
    expect(digest.prior_stages).toHaveLength(1);
  });
});

describe('the manuscript in the digest', () => {
  const chapters = [
    { title: 'Define the finding', content: 'CHAPTER-ONE prose.', status: 'complete' as const },
    { title: 'Support it', content: 'CHAPTER-TWO prose.', status: 'complete' as const },
    { title: 'Not yet written', content: '', status: 'pending' as const },
  ];
  const drafted: Record<string, StageArtifactBundle> = {
    drafting: {
      artifact: { id: 'm', summary: null, long_form: { outline: chapters } } as unknown as Artifact,
      versions: [],
    },
  };
  const state = projectState(BOOK_V1, []);

  it('is what the stages after drafting review, not a summary of it', () => {
    // Continuity said "the draft material provided is incomplete" and
    // fact-checked the objective, because all it had was 320 characters.
    for (const stageId of ['continuity', 'critique', 'fact_check', 'final_review']) {
      const digest = buildStageDigest(BOOK_V1, state, PROJECT, drafted, stageId);
      expect(digest.manuscript).toContain('CHAPTER-ONE prose.');
      expect(digest.manuscript).toContain('## 2. Support it');
      expect(digest.manuscript).not.toContain('Not yet written');
    }
  });

  it('is not sent before drafting, or to the long-form stages that rewrite it', () => {
    for (const stageId of ['positioning', 'outline', 'drafting', 'revision', 'editing']) {
      expect(buildStageDigest(BOOK_V1, state, PROJECT, drafted, stageId).manuscript).toBe('');
    }
  });

  it('is bounded, and says where it cut', () => {
    const long = Array.from({ length: 10 }, (_, i) => ({
      title: `Chapter ${i + 1}`,
      content: 'word '.repeat(10_000),
      status: 'complete' as const,
    }));
    const text = formatManuscript(long);
    expect(text.length).toBeLessThanOrEqual(MANUSCRIPT_MAX);
    // Every chapter is represented, each marked as cut rather than silently ending.
    expect(text.match(/^## \d+\./gm)).toHaveLength(10);
    expect(text.match(/omitted to fit the review budget/g)).toHaveLength(10);
  });
});

describe('establishedFigures: what later stages are told to quote (1 Oct, item 32)', () => {
  const version = (id: string) => ({ id, content: 'x' }) as never;
  const bundle = (versionId: string, figuresFor: string) => ({
    artifact: { id: 'a', key_figures: { version_id: figuresFor, figures: [{ name: 'Churn after', value: '9.4%', context: '' }] } } as never,
    versions: [version('v1'), version(versionId)],
  });
  const done = { status: 'complete' as const };

  it('passes on a done stage\'s figures, with the stage they came from', async () => {
    const { establishedFigures } = await import('./digest');
    const { BOOK_V1 } = await import('./templates/book.v1');
    const state = { current_stage_id: 'positioning', project_status: 'active', stages: { objective: done, audience: done } } as never;
    const figures = establishedFigures(BOOK_V1, state, { objective: bundle('v2', 'v2') }, 'positioning');
    expect(figures).toEqual([{ stage: 'Objective and purpose', name: 'Churn after', value: '9.4%', context: '' }]);
  });

  it('drops figures read from a version that is no longer the head, and stages that are not done', async () => {
    const { establishedFigures } = await import('./digest');
    const { BOOK_V1 } = await import('./templates/book.v1');
    const state = { current_stage_id: 'positioning', project_status: 'active', stages: { objective: done, audience: { status: 'in_progress', left_open: true } } } as never;
    expect(establishedFigures(BOOK_V1, state, { objective: bundle('v3', 'v2') }, 'positioning')).toEqual([]);
    expect(establishedFigures(BOOK_V1, state, { audience: bundle('v2', 'v2') }, 'positioning')).toEqual([]);
  });

  it('never passes a stage its own figures or a later stage\'s', async () => {
    const { establishedFigures } = await import('./digest');
    const { BOOK_V1 } = await import('./templates/book.v1');
    const state = { current_stage_id: 'objective', project_status: 'active', stages: { objective: done, audience: done } } as never;
    expect(establishedFigures(BOOK_V1, state, { objective: bundle('v2', 'v2'), audience: bundle('v2', 'v2') }, 'objective')).toEqual([]);
  });
});
