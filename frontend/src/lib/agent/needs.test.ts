import { describe, expect, it } from 'vitest';

import { BOOK_V1 } from '@/lib/workflow/templates/book.v1';
import { initialState, projectState } from '@/lib/workflow/engine';
import type { StageEvaluation, WorkflowEvent } from '@/lib/workflow/types';
import { describeNeed, needsUser } from './needs';

const stage = (id: string) => BOOK_V1.stages.find((s) => s.id === id)!;
const evaluation = (id: string, unmet: StageEvaluation['unmet'] = []): StageEvaluation => ({ stageId: id, canAdvance: unmet.every((c) => !c.blocking), criteria: [], unmet });
const label = (id: string) => stage(id).short_label;
const base = { state: initialState(BOOK_V1), policy: 'guided' as const, outlineStageId: 'outline', allowed: [] as string[] };
const outline = (namedSections: number, headApproved: boolean, unsavedDraft = false) => ({
  outline: { artifact: { id: 'o' }, doc: { schema: 1, items: [], orphans: [] }, head: namedSections ? { id: 'v1', version_number: 1 } : null, headApproved, approved: headApproved, namedSections, unsavedDraft },
}) as never;
const manuscript = (over: Record<string, unknown>) => ({
  manuscript: { artifact: { id: 'm' }, holderStageId: 'drafting', outline: [], total: 3, complete: 0, jobs: [], pendingJobs: [], stopped: [], approvedOutlineVersionId: 'ov', brief: null, revisedInStage: 0, ...over },
}) as never;

describe('needsUser: the moves that are the user\'s (B4)', () => {
  it('an unapproved outline that exists needs approving — not generating, not moving on', () => {
    const need = needsUser({ ...base, stage: stage('outline'), facts: outline(3, false), stageEvaluation: evaluation('outline'), allowed: ['advance_stage'] });
    expect(need).toEqual({ kind: 'approve_outline', stageId: 'outline', versionNumber: 1, unsavedDraft: false });
    expect(describeNeed(need!, label)).toEqual({ message: 'I need your approval of outline version 1 before I can continue.', action: 'Approve the outline' });
  });

  it('an empty outline stage needs nothing from the user: Go can generate', () => {
    expect(needsUser({ ...base, stage: stage('outline'), facts: outline(0, false), stageEvaluation: evaluation('outline'), allowed: ['generate_outline'] })).toBeNull();
  });

  it('unsaved outline edits cannot be approved from here', () => {
    const need = needsUser({ ...base, stage: stage('outline'), facts: outline(3, false, true), stageEvaluation: evaluation('outline') });
    expect(describeNeed(need!, label).action).toBeNull();
  });

  it('the approval stage and an unbound drafting stage both point at the outline stage', () => {
    const approval = needsUser({
      ...base, stage: stage('outline_approval'), facts: {},
      stageEvaluation: evaluation('outline_approval', [{ id: 'appr.approved', label: 'Outline approved', satisfied: false, blocking: true }]),
    });
    expect(approval).toMatchObject({ kind: 'approve_outline', stageId: 'outline' });
    const drafting = needsUser({ ...base, stage: stage('drafting'), facts: manuscript({ approvedOutlineVersionId: null }), stageEvaluation: evaluation('drafting') });
    expect(drafting).toMatchObject({ kind: 'approve_outline', stageId: 'outline' });
  });

  it('a blocked stage needs unblocking, whatever else is true', () => {
    const events: WorkflowEvent[] = [{ type: 'stage_blocked', stage_id: 'objective', actor: 'user', reason: 'Waiting on the survey.', payload: { block_kind: 'data_missing' }, created_at: '2026-09-29T00:00:00Z' }];
    const state = projectState(BOOK_V1, events);
    const need = needsUser({ ...base, state, stage: stage('objective'), facts: {}, stageEvaluation: evaluation('objective') });
    expect(need).toEqual({ kind: 'unblock_stage', stageId: 'objective', reason: 'Waiting on the survey.', blockKind: 'data_missing' });
    expect(describeNeed(need!, label)).toEqual({ message: 'Objective is marked blocked: Waiting on the survey. I need it unblocked before I can continue.', action: 'Unblock and resume' });
  });

  it('a stage whose only open requirements are manual boxes, with no work left, needs a tick', () => {
    const unmet = [{ id: 'pos.differentiator', label: 'One-sentence differentiator', satisfied: false, blocking: true, manual: true }];
    const need = needsUser({ ...base, stage: stage('positioning'), facts: {}, stageEvaluation: evaluation('positioning', unmet), allowed: ['evaluate_stage', 'advance_stage'] });
    expect(need).toMatchObject({ kind: 'tick_criterion', criterionId: 'pos.differentiator' });
    expect(describeNeed(need!, label).action).toBe('Confirm and resume');
    // With work still possible (a draft to write), the planner decides first.
    expect(needsUser({ ...base, stage: stage('positioning'), facts: {}, stageEvaluation: evaluation('positioning', unmet), allowed: ['draft_stage'] })).toBeNull();
    // An auto requirement among the open ones is the planner's, not a tick.
    const mixed = [...unmet, { id: 'x', label: 'Auto thing', satisfied: false, blocking: true }];
    expect(needsUser({ ...base, stage: stage('positioning'), facts: {}, stageEvaluation: evaluation('positioning', mixed) })).toBeNull();
  });

  it('a large drafting run under Autonomous is the user\'s spend to confirm, once', () => {
    const facts = manuscript({ total: 14, complete: 0 });
    const need = needsUser({ ...base, policy: 'autonomous', stage: stage('drafting'), facts, stageEvaluation: evaluation('drafting'), allowed: ['draft_sections'] });
    expect(need).toEqual({ kind: 'large_job', stageId: 'drafting', sections: 14 });
    expect(needsUser({ ...base, policy: 'autonomous', stage: stage('drafting'), facts, stageEvaluation: evaluation('drafting'), allowed: ['draft_sections'], largeJobAcknowledged: 14 })).toBeNull();
    expect(needsUser({ ...base, policy: 'checkpoint', stage: stage('drafting'), facts, stageEvaluation: evaluation('drafting'), allowed: ['draft_sections'] })).toBeNull();
  });

  it('says the window and the wait in the user\'s terms', () => {
    expect(describeNeed({ kind: 'continue_budget', budgetSteps: 12 }, label)).toEqual({ message: 'This window of 12 steps is used up and the work is not done.', action: 'Continue for 12 more steps' });
    expect(describeNeed({ kind: 'wait_for_jobs', stageId: 'drafting', pending: 2, complete: 1, total: 3 }, label).action).toBe('Keep waiting');
  });
});
