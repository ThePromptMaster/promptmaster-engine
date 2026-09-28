import { describe, expect, it, vi } from 'vitest';

import { BOOK_V1 } from './templates/book.v1';
import { LONG_FORM_COMPLETE, completedManuscript, stageContentForSummary, stageEvidence } from './evidence';
import { summariseStageContent, type StageArtifactBundle } from './digest';
import type { Artifact, ArtifactVersion } from '@/types/project';

const stage = (id: string) => BOOK_V1.stages.find((s) => s.id === id)!;
const project = { mode: 'architect' as const };

function manuscript(stageId: string, statuses: ('complete' | 'pending')[], versions: ArtifactVersion[] = []): StageArtifactBundle {
  return {
    artifact: {
      id: `a-${stageId}`,
      stage_id: stageId,
      long_form: {
        outline: statuses.map((status, i) => ({
          id: `s${i}`, title: ['Habitat', 'Diet', 'The long neck'][i], status,
          content: status === 'complete' ? `Chapter ${i + 1} text.` : '',
        })),
      },
    } as unknown as Artifact,
    versions,
  };
}

function prose(stageId: string, content: string): StageArtifactBundle {
  return {
    artifact: { id: `a-${stageId}`, stage_id: stageId, long_form: null } as Artifact,
    versions: [{ id: `v-${stageId}`, content } as ArtifactVersion],
  };
}

describe('stageEvidence: what a stage can show for being complete (A2)', () => {
  it('a prose stage cites its head version, as before', async () => {
    const bundles = { objective: prose('objective', 'Why dogs bark.') };
    await expect(stageEvidence({ template: BOOK_V1, stage: stage('objective'), bundles, project })).resolves.toBe('v-objective');
    // A bundle on another stage's artifact is not this stage's evidence.
    await expect(stageEvidence({ template: BOOK_V1, stage: stage('audience'), bundles, project })).resolves.toBeUndefined();
  });

  it('a long-form stage with sections still unwritten has no evidence yet', async () => {
    const bundles = { drafting: manuscript('drafting', ['complete', 'pending']) };
    const append = vi.fn();
    await expect(
      stageEvidence({ template: BOOK_V1, stage: stage('drafting'), bundles, project, appendStageVersion: append })
    ).resolves.toBeUndefined();
    expect(append).not.toHaveBeenCalled();
    expect(completedManuscript(BOOK_V1, stage('drafting'), bundles)).toBeNull();
  });

  it('a finished manuscript is saved as a version and cited — Drafting no longer completes without evidence', async () => {
    const bundles = { drafting: manuscript('drafting', ['complete', 'complete']) };
    const append = vi.fn(async () => ({ id: 'v-snapshot' }));
    const id = await stageEvidence({ template: BOOK_V1, stage: stage('drafting'), bundles, project, appendStageVersion: append });
    expect(id).toBe('v-snapshot');
    expect(append).toHaveBeenCalledTimes(1);
    const [stageId, name, version] = append.mock.calls[0] as unknown as [string, string, Record<string, unknown>];
    expect(stageId).toBe('drafting');
    expect(name).toBe(stage('drafting').label);
    expect(version.source_operation).toBe(LONG_FORM_COMPLETE);
    expect(version.content).toContain('## 1. Habitat');
    expect(version.content).toContain('## 2. Diet');
    expect(version.change_summary).toMatch(/2 sections/);
  });

  it('completing the same finished manuscript twice cites the one snapshot', async () => {
    const first = manuscript('drafting', ['complete', 'complete']);
    const text = completedManuscript(BOOK_V1, stage('drafting'), { drafting: first })!.text;
    const bundles = {
      drafting: manuscript('drafting', ['complete', 'complete'], [
        { id: 'v-old', content: 'an older snapshot' } as ArtifactVersion,
        { id: 'v-head', content: text } as ArtifactVersion,
      ]),
    };
    const append = vi.fn();
    await expect(
      stageEvidence({ template: BOOK_V1, stage: stage('drafting'), bundles, project, appendStageVersion: append })
    ).resolves.toBe('v-head');
    expect(append).not.toHaveBeenCalled();
  });

  it('a regenerated chapter after a snapshot means a new snapshot, not the stale one', async () => {
    const bundles = {
      drafting: manuscript('drafting', ['complete', 'complete'], [{ id: 'v-stale', content: 'the old text' } as ArtifactVersion]),
    };
    const append = vi.fn(async () => ({ id: 'v-fresh' }));
    await expect(
      stageEvidence({ template: BOOK_V1, stage: stage('drafting'), bundles, project, appendStageVersion: append })
    ).resolves.toBe('v-fresh');
  });

  it("Revision reads Drafting's manuscript and gets a snapshot on its own artifact", async () => {
    const bundles = { drafting: manuscript('drafting', ['complete', 'complete']) };
    const append = vi.fn(async () => ({ id: 'v-revision' }));
    await expect(
      stageEvidence({ template: BOOK_V1, stage: stage('revision'), bundles, project, appendStageVersion: append })
    ).resolves.toBe('v-revision');
    expect((append.mock.calls[0] as unknown as [string])[0]).toBe('revision');
  });

  it('without a way to save, a long-form stage completes plainly rather than lying', async () => {
    const bundles = { drafting: manuscript('drafting', ['complete']) };
    await expect(stageEvidence({ template: BOOK_V1, stage: stage('drafting'), bundles, project })).resolves.toBeUndefined();
  });
});

describe('the stage summary of a manuscript names its sections', () => {
  it('rather than quoting the opening of chapter one', () => {
    const bundles = { drafting: manuscript('drafting', ['complete', 'complete']) };
    const content = stageContentForSummary(BOOK_V1, stage('drafting'), bundles);
    expect(content).toContain('## 1. Habitat');
    expect(summariseStageContent(stage('drafting'), content)).toBe('2 sections: Habitat; Diet');
    // Revision summarises the same manuscript.
    expect(summariseStageContent(stage('revision'), stageContentForSummary(BOOK_V1, stage('revision'), bundles))).toBe('2 sections: Habitat; Diet');
  });

  it('a prose stage still summarises its head version', () => {
    const bundles = { objective: prose('objective', 'Why dogs bark, and what to do about it.') };
    expect(stageContentForSummary(BOOK_V1, stage('objective'), bundles)).toBe('Why dogs bark, and what to do about it.');
  });
});
