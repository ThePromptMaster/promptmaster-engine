import { approvalsAskedFor } from './needs';
import { describe, expect, it } from 'vitest';

import { BOOK_V1 } from '@/lib/workflow/templates/book.v1';
import { initialState, projectState } from '@/lib/workflow/engine';
import type { StageEvaluation, WorkflowEvent } from '@/lib/workflow/types';
import { describeNeed, needIsDecidedOnStage, needStillHolds, needsUser, requiredWork, type NeedsUser } from './needs';

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

  it('unsaved outline edits are saved and approved by the card\'s own button', () => {
    const need = needsUser({ ...base, stage: stage('outline'), facts: outline(3, false, true), stageEvaluation: evaluation('outline') });
    expect(describeNeed(need!, label).action).toBe('Save and approve the outline');
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
    // Whether anything changed since is not on record: the card does not claim either way.
    expect(describeNeed(need!, label)).toEqual({
      message: 'Objective is marked stuck: Waiting on the survey. I need that cleared before I can continue.',
      action: 'Add the missing data',
      options: [{ id: 'add_data', label: 'Add the missing data' }, { id: 'clear', label: 'Continue this stage by hand' }],
      footer: undefined,
    });
  });

  it('a stuck stage says whether anything changed, and never calls a retry "continue" (2 Oct, item 9)', () => {
    const need = { kind: 'unblock_stage' as const, stageId: 'objective', reason: 'The source extracts are missing.', blockKind: 'data_missing' };
    const unchanged = describeNeed(need, label, { blockInputs: { changed: false, what: [] }, canSkip: true });
    expect(unchanged.message).toBe(
      'Objective is marked stuck: The source extracts are missing. Nothing in the project has changed since, so trying again will most likely stop at the same place.'
    );
    // At most three ways forward (2 Oct screenshots): the one that fits the
    // situation, skipping where allowed, and carrying on by hand.
    expect(unchanged.options).toEqual([
      { id: 'add_data', label: 'Add the missing data' },
      { id: 'skip', label: 'Skip Objective for now' },
      { id: 'clear', label: 'Continue this stage by hand' },
    ]);

    const changed = describeNeed(need, label, { blockInputs: { changed: true, what: ['a data file was added'] }, canSkip: true });
    expect(changed.message).toBe('Objective is marked stuck: The source extracts are missing. Since then, a data file was added.');
    expect(changed.options).toEqual([
      { id: 'resume', label: 'Resume with what has changed' },
      { id: 'skip', label: 'Skip Objective for now' },
      { id: 'clear', label: 'Continue this stage by hand' },
    ]);

    // A decision, not data: there is nothing to attach, so trying again leads.
    const decision = describeNeed({ ...need, blockKind: 'needs_decision' }, label, { blockInputs: { changed: false, what: [] } });
    expect(decision.options).toEqual([{ id: 'retry', label: 'Try again' }, { id: 'clear', label: 'Continue this stage by hand' }]);
    for (const d of [unchanged, changed, decision]) {
      expect(JSON.stringify(d)).not.toMatch(/Continue the stage/);
      expect(d.options!.length).toBeLessThanOrEqual(3);
    }
  });

  it('the card points to the stage bar\'s own button, in its exact words, or to nothing (2 Oct screenshots)', () => {
    const need = { kind: 'unblock_stage' as const, stageId: 'objective', reason: 'No data.', blockKind: 'data_missing' };
    // The menu read "Continue to Audience" while the card said to use "Override and continue".
    expect(describeNeed(need, label, { advanceControl: 'Continue to Audience' }).footer).toBe(
      'To move on with this still open, use “Continue to Audience” under More at the bottom of the stage; it asks for your reason.'
    );
    expect(describeNeed(need, label, { advanceControl: 'Override and continue to Audience' }).footer).toContain('“Override and continue to Audience”');
    expect(describeNeed(need, label, { advanceControl: null }).footer).toBeUndefined();
  });

  it('a stage whose only open requirements are manual boxes, with no work left, needs a tick', () => {
    const unmet = [{ id: 'pos.differentiator', label: 'One-sentence differentiator', satisfied: false, blocking: true, manual: true }];
    const need = needsUser({ ...base, stage: stage('positioning'), facts: {}, stageEvaluation: evaluation('positioning', unmet), allowed: ['evaluate_stage', 'advance_stage'] });
    expect(need).toMatchObject({ kind: 'tick_criterion', criterionId: 'pos.differentiator' });
    expect(describeNeed(need!, label).action).toBe('Approve and resume');
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

describe('B3: the findings that change the work are the user\'s', () => {
  const review = (routine: number, material: number) => ({
    review: {
      items: [], schema: { itemLabel: 'finding', fields: [], minItems: 1, maxItems: 9 },
      routine: Array.from({ length: routine }, (_, i) => ({ id: `r${i}` })),
      material: Array.from({ length: material }, (_, i) => ({ id: `m${i}` })),
    },
  }) as never;

  it('with routine rows left, the planner decides them first', () => {
    expect(needsUser({ ...base, stage: stage('continuity'), facts: review(2, 1), stageEvaluation: evaluation('continuity'), allowed: ['triage_findings'] })).toBeNull();
  });

  it('with only material rows left, the user is asked, with no button — the table is the control', () => {
    const need = needsUser({ ...base, stage: stage('continuity'), facts: review(0, 2), stageEvaluation: evaluation('continuity'), allowed: ['advance_stage'] });
    expect(need).toEqual({ kind: 'triage_findings', stageId: 'continuity', count: 2 });
    expect(describeNeed(need!, label)).toEqual({ message: '2 findings would change the work, so they need your decision. Accept or reject each in the table below — that is how a check stage works.', action: 'Go to the table' });
  });

  it('a fully decided table needs nothing', () => {
    expect(needsUser({ ...base, stage: stage('continuity'), facts: review(0, 0), stageEvaluation: evaluation('continuity'), allowed: ['advance_stage'] })).toBeNull();
  });
});

describe('needsUser: an outcome table is the user\'s to decide (production pass, 2026-09-29)', () => {
  it('stops for undecided claims instead of letting the planner revise the table', () => {
    const schema = { itemLabel: 'claim', fields: [], minItems: 1, maxItems: 20, statuses: [] };
    const rows = [{ id: 'a', claim: 'x', status: 'candidate_source' }, { id: 'b', claim: 'y', status: 'no_source' }];
    const need = needsUser({
      ...base, stage: stage('fact_check'), stageEvaluation: evaluation('fact_check'), allowed: ['revise_stage', 'evaluate_stage'],
      facts: { review: { items: rows, schema, routine: [], material: rows, outcome: true } } as never,
    });
    expect(need).toEqual({ kind: 'decide_rows', stageId: 'fact_check', count: 2, itemLabel: 'claim' });
    expect(describeNeed(need!, label)).toEqual({
      message: '2 claims are waiting for your decision — only you can settle them. Set a status on each in the table below — that is how a check stage works.',
      // The button takes the user to the rows; deciding them stays theirs.
      action: 'Go to the table',
    });
    expect(needIsDecidedOnStage(need!)).toBe(true);
    expect(needIsDecidedOnStage({ kind: 'tick_criterion' })).toBe(false);
  });
});

describe('needsUser: a required box with only revise moves left is the user\'s (production pass, 2026-09-29)', () => {
  it('stops for the tick instead of counting revise_stage as work left', () => {
    const need = needsUser({
      ...base, stage: stage('positioning'), facts: {}, allowed: ['evaluate_stage', 'revise_stage', 'advance_stage'],
      stageEvaluation: evaluation('positioning', [{ id: 'pos.differentiator', label: 'One-sentence differentiator', satisfied: false, blocking: true, manual: true }]),
    });
    expect(need).toMatchObject({ kind: 'tick_criterion', stageId: 'positioning', criterionId: 'pos.differentiator' });
  });
  it('still lets Go draft first when the stage is empty', () => {
    const need = needsUser({
      ...base, stage: stage('positioning'), facts: {}, allowed: ['draft_stage', 'advance_stage'],
      stageEvaluation: evaluation('positioning', [{ id: 'pos.differentiator', label: 'One-sentence differentiator', satisfied: false, blocking: true, manual: true }]),
    });
    expect(need).toBeNull();
  });
});

describe('needStillHolds: a recorded stop is checked against the project (1 Oct, items 1 and 22)', () => {
  const at = (stageId: string, over: Record<string, unknown> = {}) => ({
    ...base, stage: stage(stageId), facts: {}, stageEvaluation: evaluation(stageId), objective: 'A book', currentStageId: stageId, ...over,
  });

  it('an approval the user has since given no longer holds', () => {
    const need: NeedsUser = { kind: 'approve_outline', stageId: 'outline', versionNumber: 1, unsavedDraft: false, onStage: 'outline' };
    expect(needStillHolds(need, at('outline', { facts: outline(3, false) }))).toBe(true);
    expect(needStillHolds(need, at('outline', { facts: outline(3, true) }))).toBe(false);
  });

  it('a box the user has since ticked no longer holds; a different open box is a different request', () => {
    const unmet = [{ id: 'pos.differentiator', label: 'One-sentence differentiator', satisfied: false, blocking: true, manual: true }];
    const need: NeedsUser = { kind: 'tick_criterion', stageId: 'positioning', criterionId: 'pos.differentiator', label: 'One-sentence differentiator', onStage: 'positioning' };
    expect(needStillHolds(need, at('positioning', { stageEvaluation: evaluation('positioning', unmet) }))).toBe(true);
    expect(needStillHolds(need, at('positioning'))).toBe(false);
    const other = [{ ...unmet[0], id: 'pos.other' }];
    expect(needStillHolds(need, at('positioning', { stageEvaluation: evaluation('positioning', other) }))).toBe(false);
  });

  it('an approval asked for while other moves were still on offer holds until it is given (production pass, 2026-10-02)', () => {
    const unmet = [{ id: 'analysis.verdicts', label: 'I confirm each hypothesis has an evidence-backed verdict', satisfied: false, blocking: true, manual: true }];
    const need: NeedsUser = { kind: 'tick_criterion', stageId: 'positioning', criterionId: 'analysis.verdicts', label: unmet[0].label, onStage: 'positioning' };
    const allowed = ['derive', 'prove', 'run_computation', 'evaluate_stage', 'revise_stage'];
    // Reasoning moves cannot tick an approval (4 Oct): needsUser raises it itself now…
    expect(needsUser({ ...at('positioning', { stageEvaluation: evaluation('positioning', unmet) }), allowed })).toMatchObject({ kind: 'tick_criterion' });
    // …unless the project's data can still carry out a computation.
    expect(needsUser({ ...at('positioning', { stageEvaluation: evaluation('positioning', unmet) }), allowed, runAttemptsLeft: 2 })).toBeNull();
    expect(needStillHolds(need, { ...at('positioning', { stageEvaluation: evaluation('positioning', unmet) }), allowed })).toBe(true);
    expect(needStillHolds(need, { ...at('positioning'), allowed })).toBe(false);
  });

  it('a request raised on a stage the project has left no longer holds', () => {
    const need: NeedsUser = { kind: 'answer_question', question: 'Which audience?', onStage: 'audience' };
    expect(needStillHolds(need, at('audience'))).toBe(true);
    expect(needStillHolds(need, at('positioning'))).toBe(false);
  });

  it('a stage the user has continued is no longer stuck; finished jobs are no longer waited for', () => {
    const stuck: NeedsUser = { kind: 'unblock_stage', stageId: 'objective', reason: 'x', blockKind: 'data_missing', onStage: 'objective' };
    expect(needStillHolds(stuck, at('objective'))).toBe(false);
    const waiting: NeedsUser = { kind: 'wait_for_jobs', stageId: 'drafting', pending: 2, complete: 1, total: 3, onStage: 'drafting' };
    expect(needStillHolds(waiting, at('drafting', { facts: manuscript({ pendingJobs: [{}] }) }))).toBe(true);
    expect(needStillHolds(waiting, at('drafting', { facts: manuscript({}) }))).toBe(false);
  });

  it('another window stays the user\'s click wherever the project is; a missing objective holds until it is set', () => {
    expect(needStillHolds({ kind: 'continue_budget', budgetSteps: 12, onStage: 'audience' }, at('positioning'))).toBe(true);
    expect(needStillHolds({ kind: 'set_objective' }, at('objective', { objective: ' ' }))).toBe(true);
    expect(needStillHolds({ kind: 'set_objective' }, at('objective'))).toBe(false);
  });
});

describe('a suggestion to skip is the user\'s call (1 Oct, item 11)', () => {
  const need: NeedsUser = { kind: 'skip_stage', stageId: 'audience', reason: 'The audience is already fixed by the brief.', onStage: 'audience' };
  it('says what is normally next, why not now, and that it can be undone', () => {
    expect(describeNeed(need, label)).toEqual({
      message: 'Audience is normally next, but I would skip it for now. The audience is already fixed by the brief. It is your call, and a skipped stage can be reopened later.',
      action: 'Skip Audience for now',
    });
  });
  it('stands while the project is on that stage, and goes once it has moved', () => {
    const at = (stageId: string) => ({ ...base, stage: stage(stageId), facts: {}, stageEvaluation: evaluation(stageId), objective: 'A book', currentStageId: stageId });
    expect(needStillHolds(need, at('audience'))).toBe(true);
    expect(needStillHolds(need, at('positioning'))).toBe(false);
  });
});

describe('needsUser: runs the data can carry out are tried before the table is the user\'s (1 Oct, item 17)', () => {
  const schema = { itemLabel: 'run', fields: [], minItems: 1, maxItems: 20, statuses: [], execution: { status: 'completed', field: 'observed' } };
  const rows = [{ id: 'a', run: 'Count the accounts' }, { id: 'b', run: 'Compare cohorts' }];
  const input = {
    ...base, stage: stage('fact_check'), stageEvaluation: evaluation('fact_check'), allowed: ['run_computation'],
    facts: { review: { items: rows, schema, routine: [], material: rows, outcome: true } } as never,
  };

  it('with data and attempts left, the planner is asked', () => {
    expect(needsUser({ ...input, runAttemptsLeft: 2 })).toBeNull();
  });

  it('with none left — no data, or every row tried — the rows are the user\'s, as before', () => {
    expect(needsUser({ ...input, runAttemptsLeft: 0 })).toMatchObject({ kind: 'decide_rows', count: 2, itemLabel: 'run' });
    expect(needsUser(input)).toMatchObject({ kind: 'decide_rows' });
  });

  it('a table no run can settle is never held back for one', () => {
    const claims = { ...schema, itemLabel: 'claim', execution: undefined };
    expect(needsUser({ ...input, runAttemptsLeft: 5, facts: { review: { items: rows, schema: claims, routine: [], material: rows, outcome: true } } as never }))
      .toMatchObject({ kind: 'decide_rows', itemLabel: 'claim' });
  });
});

describe('approvalsAskedFor: a question asking for an approval offers the tick (4 Oct, production)', () => {
  const gap = { id: 'lit.gap', label: 'I agree this says what is not yet known, and that this work addresses it' };
  const other = { id: 'x.other', label: 'I approve this analysis plan for execution' };
  const asked =
    'Does this literature context clearly state the knowledge gap for your question — not just novelty, but what is still not known about whether pair programming reduces defects in professional teams, and why that matters to engineering managers? If yes, use “I agree this says what is not yet known, and that this work addresses it”; if no, say the one thing that still needs changing.';

  it('matches the requirement the question quotes, curly quotes and all', () => {
    expect(approvalsAskedFor(asked, [gap, other])).toEqual([gap]);
  });

  it('offers nothing for a question that does not quote a requirement', () => {
    expect(approvalsAskedFor('Which of the three segments should the book address first?', [gap, other])).toEqual([]);
    expect(approvalsAskedFor(asked, [])).toEqual([]);
  });
});

describe('requiredWork: the stage\'s own requirements come before optional moves (4 Oct)', () => {
  const approval = [{ id: 'evidence.approved', label: 'I approve this evidence base and hypothesis set', satisfied: false, blocking: true, manual: true }];
  const ruleUnmet = [{ id: 'x', label: 'At least one item', satisfied: false, blocking: true, manual: false }];
  const research = ['derive', 'compare_alternatives', 'evaluate_stage', 'revise_stage', 'apply_findings', 'continue_writing'];
  const draft = (over: Record<string, unknown> = {}) => ({ draft: { truncated: false, checked: true, ...over } }) as Record<string, unknown> as never;
  const args = (facts: never, unmet = approval, allowed = research) => ({
    stage: stage('positioning'), facts, stageEvaluation: evaluation('positioning', unmet), allowed,
  });

  it('a cut-off draft is finished first, whatever else is open', () => {
    expect(requiredWork(args(draft({ truncated: true }), ruleUnmet))?.key).toBe('continue_writing');
    expect(requiredWork(args(draft({ truncated: true })))?.key).toBe('continue_writing');
  });

  it('at an approval: open findings on this version are applied, then the new version is checked', () => {
    const withFindings = { ...(draft() as object), evaluationFindings: { count: 4, aboutHead: true } } as never;
    expect(requiredWork(args(withFindings))?.key).toBe('apply_findings');
    expect(requiredWork(args(draft({ checked: false })))?.key).toBe('evaluate_stage');
    expect(requiredWork(args(draft()))).toBeNull();
  });

  it('only what the polish cap still allows is required', () => {
    const withFindings = { ...(draft({ checked: false }) as object), evaluationFindings: { count: 4, aboutHead: true } } as never;
    expect(requiredWork(args(withFindings, approval, ['derive', 'compare_alternatives']))).toBeNull();
  });

  it('with a rule still unmet, polishing is the planner\'s choice, not required', () => {
    expect(requiredWork(args(draft({ checked: false }), ruleUnmet))).toBeNull();
  });

  it('once the required work is done, the only thing left is the user\'s approval — not Compare alternatives', () => {
    const need = needsUser({ ...base, stage: stage('positioning'), facts: draft(), stageEvaluation: evaluation('positioning', approval), allowed: research });
    expect(need).toMatchObject({ kind: 'tick_criterion', criterionId: 'evidence.approved' });
    // …but not while there are findings Go can still apply.
    const pending = { ...(draft() as object), evaluationFindings: { count: 4, aboutHead: true } } as never;
    expect(needsUser({ ...base, stage: stage('positioning'), facts: pending, stageEvaluation: evaluation('positioning', approval), allowed: research })).toBeNull();
  });
});

describe('requiredWork in a looping workflow (production pass, 5 Oct)', () => {
  const next = { ...BOOK_V1.stages[0], id: 'next_question', label: 'Next question', transitions: { ...BOOK_V1.stages[0].transitions, loop_to: 'explore' } };
  const met = { canAdvance: true, unmet: [], criteria: [] } as unknown as StageEvaluation;
  const unmet = { canAdvance: false, unmet: [], criteria: [] } as unknown as StageEvaluation;

  it('drafts a stage that still holds last round\'s draft, before anything else', () => {
    const r = requiredWork({ stage: next, facts: {}, stageEvaluation: met, allowed: ['draft_stage', 'request_user_decision'], round: { staleDraft: true } });
    expect(r?.key).toBe('draft_stage');
  });

  it('proposes the next round once the question is written and the stage is ready', () => {
    const r = requiredWork({ stage: next, facts: {}, stageEvaluation: met, allowed: ['propose_next_round', 'revise_stage'], round: { staleDraft: false } });
    expect(r?.key).toBe('propose_next_round');
  });

  it('leaves the choice to the planner while the stage is not ready, or outside a loop', () => {
    expect(requiredWork({ stage: next, facts: {}, stageEvaluation: unmet, allowed: ['propose_next_round'], round: { staleDraft: false } })).toBeNull();
    expect(requiredWork({ stage: next, facts: {}, stageEvaluation: met, allowed: ['propose_next_round'] })).toBeNull();
  });
});
