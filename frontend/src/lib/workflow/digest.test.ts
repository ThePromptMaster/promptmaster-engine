import { describe, expect, it } from 'vitest';

import { BOOK_V1, RESEARCH_V1, projectState } from './index';
import { SUMMARY_MAX, buildStageDigest, summariseStageContent, type StageArtifactBundle } from './digest';
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
