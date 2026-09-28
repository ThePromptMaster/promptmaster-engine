import { describe, expect, it } from 'vitest';
import { BOOK_V1 } from './templates/book.v1';
import { RESEARCH_V1 } from './templates/research.v1';
import { SINGLE_OUTPUT_V1 } from './templates/single-output.v1';
import { buildStageContext, manuscriptArtifactFor } from './context';
import { evaluateStage, completionSummary, projectState } from './engine';
import { serializeItems } from './stage-artifact';
import type { StageArtifactBundle } from './digest';
import type { WorkflowEvent } from './types';
import type { Artifact, ArtifactVersion } from '@/types/project';

const project = { objective: 'A field guide.', audience: 'Owners', constraints: '', manual_checks: {} };

function bundle(content: string, extra: Partial<Artifact> = {}): StageArtifactBundle {
  return {
    artifact: { id: `a-${extra.stage_id ?? 'x'}`, long_form: null, ...extra } as Artifact,
    versions: content ? [{ id: `v-${extra.stage_id ?? 'x'}`, content } as ArtifactVersion] : [],
  };
}

function rows(items: Record<string, string>[]): string {
  return serializeItems(items.map((r, i) => ({ id: `i${i}`, ...r })));
}

function manuscript(stageId: string, statuses: ('complete' | 'pending')[]): StageArtifactBundle {
  return {
    artifact: {
      id: `a-${stageId}`,
      stage_id: stageId,
      long_form: {
        outline: statuses.map((status, i) => ({ id: `s${i}`, title: `Chapter ${i + 1}`, status, content: '' })),
      },
    } as unknown as Artifact,
    versions: [],
  };
}

const approved: WorkflowEvent = {
  type: 'outline_approved',
  stage_id: 'outline',
  actor: 'user',
  created_at: '2026-09-28T00:00:00Z',
  payload: { outline_version_id: 'ov1' },
};

/** A Book in Critique: three chapters written, two continuity findings triaged, two critique findings not. */
const book: Record<string, StageArtifactBundle> = {
  objective: bundle('Why dogs bark.', { stage_id: 'objective' }),
  drafting: manuscript('drafting', ['complete', 'complete', 'complete']),
  continuity: bundle(
    rows([
      { finding: 'Ch 3 repeats Ch 1', where: 'Ch 3', severity: 'high', status: 'accepted' },
      { finding: 'Terminology', where: 'Ch 2', severity: 'low', status: 'rejected', reason: 'Fine' },
    ]),
    { stage_id: 'continuity' }
  ),
  critique: bundle(
    rows([
      { finding: 'Weak opening', why_it_matters: 'Readers leave', suggested_change: 'Cut it' },
      { finding: 'No examples', why_it_matters: 'Abstract', suggested_change: 'Add two' },
    ]),
    { stage_id: 'critique' }
  ),
};

describe('buildStageContext is right for every stage at once', () => {
  const context = buildStageContext({ template: BOOK_V1, project, bundles: book, events: [approved] });

  it('reports Drafting as fully written and Critique as untriaged from the same object', () => {
    // The skew Sean hit: Go evaluated Drafting with a context built for the
    // stage he was viewing, and read "no sections yet" on a finished book.
    const drafting = evaluateStage(BOOK_V1, 'drafting', context);
    expect(drafting.criteria.find((c) => c.id === 'draft.allsections')?.satisfied).toBe(true);

    const critique = evaluateStage(BOOK_V1, 'critique', context);
    const triaged = critique.criteria.find((c) => c.id === 'crit.triaged');
    expect(triaged?.satisfied).toBe(false);
    expect(triaged?.detail).toBe('2 untriaged');

    // Continuity's findings are its own: fully triaged, and never counted on Critique.
    expect(context.findings.continuity).toEqual({ total: 2, triaged: 2 });
    expect(context.findings.critique).toEqual({ total: 2, triaged: 0 });
  });

  it('lets Revision and Editing read the manuscript Drafting wrote', () => {
    expect(context.sections.drafting).toEqual({ total: 3, complete: 3 });
    expect(context.sections.revision).toEqual({ total: 3, complete: 3 });
    expect(context.sections.editing).toEqual({ total: 3, complete: 3 });
    expect(manuscriptArtifactFor(BOOK_V1, BOOK_V1.stages.find((s) => s.id === 'revision')!, book)?.id).toBe('a-drafting');
  });

  it('keeps a stage with its own manuscript on its own manuscript', () => {
    const own = { ...book, revision: manuscript('revision', ['complete', 'pending']) };
    const ctx = buildStageContext({ template: BOOK_V1, project, bundles: own, events: [approved] });
    expect(ctx.sections.revision).toEqual({ total: 2, complete: 1 });
    expect(ctx.sections.drafting).toEqual({ total: 3, complete: 3 });
  });

  it('reads outline approval from the event log, not from drafting state', () => {
    expect(context.outlineApproved).toBe(true);
    const unapproved = buildStageContext({ template: BOOK_V1, project, bundles: book, events: [] });
    expect(unapproved.outlineApproved).toBe(false);
    expect(evaluateStage(BOOK_V1, 'outline_approval', unapproved).canAdvance).toBe(false);
  });

  it('feeds completionSummary without a second, hand-built deliverable object', () => {
    const state = projectState(BOOK_V1, [], 'critique');
    expect(completionSummary(BOOK_V1, state, context).deliverableDone).toBe(true);
    const partial = { ...book, drafting: manuscript('drafting', ['complete', 'pending', 'pending']) };
    const ctx = buildStageContext({ template: BOOK_V1, project, bundles: partial, events: [approved] });
    expect(completionSummary(BOOK_V1, state, ctx).deliverableDone).toBe(false);
  });

  it('prefers a live outline count from a mounted panel over the saved outline', () => {
    const ctx = buildStageContext({
      template: BOOK_V1, project, bundles: book, events: [approved], outlineCounts: { outline: 4 },
    });
    expect(ctx.itemCounts.outline).toBe(4);
    expect(evaluateStage(BOOK_V1, 'outline', ctx).criteria.find((c) => c.id === 'out.sections')?.satisfied).toBe(true);
    expect(context.itemCounts.outline).toBe(0);
  });
});

describe('buildStageContext on the other workflows', () => {
  it('Research drafting reads its own manuscript (derived outline, no separate drafting stage)', () => {
    const bundles = { drafting: manuscript('drafting', ['complete', 'complete']) };
    const ctx = buildStageContext({ template: RESEARCH_V1, project, bundles, events: [] });
    expect(ctx.sections.drafting).toEqual({ total: 2, complete: 2 });
    expect(ctx.sections.revision).toEqual({ total: 2, complete: 2 });
  });

  it('single output reads the project-level artifact for stages with no bundle', () => {
    const versions = [{ id: 'v1', content: 'The answer.' } as ArtifactVersion];
    const ctx = buildStageContext({
      template: SINGLE_OUTPUT_V1, project, bundles: {}, projectVersions: versions, events: [],
    });
    expect(ctx.artifactNonEmpty.output).toBe(true);
    expect(evaluateStage(SINGLE_OUTPUT_V1, 'output', ctx).canAdvance).toBe(true);
    const empty = buildStageContext({ template: SINGLE_OUTPUT_V1, project, bundles: {}, events: [] });
    expect(empty.artifactNonEmpty.output).toBe(false);
  });
});
