import { describe, expect, it } from 'vitest';

import { BOOK_V1 } from '@/lib/workflow/templates/book.v1';
import { initialState, projectState } from '@/lib/workflow/engine';
import type { StageEvaluation, WorkflowEvent } from '@/lib/workflow/types';
import { buildStageContext } from '@/lib/workflow/context';
import { evaluateStage } from '@/lib/workflow/engine';
import type { OutlineSection } from '@/types';
import type { Artifact } from '@/types/project';
import { buildAgentState } from './digest';
import { contextWithFacts, type ManuscriptFacts, type StageFacts } from './facts';

const stage = (id: string) => BOOK_V1.stages.find((s) => s.id === id)!;
const evaluation = (id: string, unmet: StageEvaluation['unmet'] = []): StageEvaluation => ({
  stageId: id, canAdvance: unmet.every((c) => !c.blocking), criteria: unmet, unmet,
});
const event = (over: Partial<WorkflowEvent>): WorkflowEvent => ({
  stage_id: 'objective', type: 'stage_marked_complete', actor: 'user', created_at: '2026-09-29T00:00:00Z', ...over,
});

describe('buildAgentState: what the planner is told it cannot act on', () => {
  it('marks an optional criterion as optional, and a manual one as the user\'s', () => {
    const digest = buildAgentState({
      template: BOOK_V1, state: initialState(BOOK_V1), stage: stage('outline'), bundles: {}, steps: [],
      stageEvaluation: evaluation('outline', [
        { id: 'out.needs', label: 'Every audience need maps to a section', satisfied: false, blocking: false, manual: true },
        { id: 'out.sections', label: 'At least 3 sections', satisfied: false, blocking: true },
      ]),
    });
    expect(digest.criteria_unmet[0]).toBe(
      'Every audience need maps to a section (ticked by the user when satisfied — revising cannot satisfy it; optional — moving on does not need it; do not ask about it)'
    );
    expect(digest.criteria_unmet[1]).toBe('At least 3 sections');
  });

  it('says a left-open earlier stage is the user\'s to close', () => {
    const state = projectState(BOOK_V1, [
      event({ stage_id: 'objective', to_stage_id: 'audience' }),
      event({ stage_id: 'audience', to_stage_id: 'positioning' }),
      event({ stage_id: 'positioning', type: 'stage_advanced', to_stage_id: 'research' }),
    ]);
    const digest = buildAgentState({ template: BOOK_V1, state, stage: stage('research'), bundles: {}, steps: [], stageEvaluation: evaluation('research') });
    expect(digest.prior_stages).toEqual([
      'Objective and purpose: complete',
      'Audience: complete',
      'Positioning: left open (moved past; only the user can close it — nothing for you to do there)',
    ]);
  });
});

const section = (id: string, over: Partial<OutlineSection> = {}): OutlineSection => ({
  id, title: `Chapter ${id}`, abstract: '', status: 'complete', content: `Text of ${id}.`, revision: 1,
  finish_reason: null, error: null, generated_at: null, ...over,
});
const manuscript = (outline: OutlineSection[], over: Partial<ManuscriptFacts> = {}): ManuscriptFacts => ({
  artifact: { id: 'a-drafting', stage_id: 'drafting', long_form: { outline } } as unknown as Artifact,
  holderStageId: 'drafting', outline, total: outline.length,
  complete: outline.filter((s) => s.status === 'complete').length,
  jobs: [], pendingJobs: [], stopped: [], approvedOutlineVersionId: 'ov1', brief: null, revisedInStage: 0, ...over,
});

describe('buildAgentState: the planner reads what the loop just read (1 Oct, item 1)', () => {
  it('shows the written chapters from the fresh read when the store has none', () => {
    const facts: StageFacts = { outlineApproved: true, manuscript: manuscript([section('1'), section('2'), section('3')]) };
    const digest = buildAgentState({
      template: BOOK_V1, state: initialState(BOOK_V1), stage: stage('drafting'), bundles: {}, steps: [],
      stageEvaluation: evaluation('drafting'), facts,
    });
    expect(digest.manuscript).toMatchObject({ total: 3, complete: 3, unwritten: [] });
    expect(digest.artifact_excerpt).toContain('Text of 2.');
  });

  it('counts a section that holds text as written, and says when its last write failed', () => {
    const facts: StageFacts = { manuscript: manuscript([section('1'), section('2', { status: 'error' }), section('3', { status: 'pending', content: '' })]) };
    const digest = buildAgentState({
      template: BOOK_V1, state: initialState(BOOK_V1), stage: stage('drafting'), bundles: {}, steps: [],
      stageEvaluation: evaluation('drafting'), facts,
    });
    expect(digest.manuscript?.complete).toBe(2);
    expect(digest.manuscript?.written[1]).toBe('2. Chapter 2 (text kept; last write error)');
    expect(digest.manuscript?.unwritten).toEqual(['3. Chapter 3']);
  });

  it('shows the approved outline on the stage whose work is approving it', () => {
    const approval = BOOK_V1.stages.find((s) => s.exit_criteria.some((c) => c.rule?.type === 'outline_approved') && s.renderer !== 'long_form')!;
    const digest = buildAgentState({
      template: BOOK_V1, state: initialState(BOOK_V1), stage: approval, bundles: {}, steps: [],
      stageEvaluation: evaluation(approval.id), facts: { outlineApproved: true },
      approvedOutline: [section('1', { title: 'Why cats scratch' }), section('2', { title: 'What to do' })],
    });
    expect(digest.artifact_excerpt).toBe('The approved outline:\n1. Why cats scratch\n2. What to do');
    expect(digest.outline).toMatchObject({ named_count: 2, approved: true });
  });
});

describe('contextWithFacts: requirements judged against the same read', () => {
  it('"every section is written" follows the fresh manuscript, not the stale store', () => {
    const drafting = stage('drafting');
    const stale = buildStageContext({ template: BOOK_V1, project: { objective: 'o', audience: 'a', constraints: '', manual_checks: {} }, bundles: {}, events: [] });
    const rule = drafting.exit_criteria.find((c) => c.rule?.type === 'all_sections_complete')!;
    const unmetBefore = evaluateStage(BOOK_V1, 'drafting', stale).unmet.map((c) => c.id);
    expect(unmetBefore).toContain(rule.id);

    const fresh = contextWithFacts(stale, drafting, { outlineApproved: true, manuscript: manuscript([section('1'), section('2')]) });
    expect(evaluateStage(BOOK_V1, 'drafting', fresh).unmet.map((c) => c.id)).not.toContain(rule.id);
    expect(fresh.artifactNonEmpty.drafting).toBe(true);
    expect(fresh.outlineApproved).toBe(true);
    // Other stages are untouched.
    expect(fresh.sections.revision).toEqual(stale.sections.revision);
  });
});
