import { ITEM_SCHEMAS } from '@/lib/workflow/stage-artifact';
import { approvalsAskedFor, repairTries } from './needs';
import type { AgentStep } from '@/types/agent';
import { describe, expect, it } from 'vitest';

import { BOOK_V1 } from '@/lib/workflow/templates/book.v1';
import { initialState, projectState } from '@/lib/workflow/engine';
import type { StageEvaluation, WorkflowEvent } from '@/lib/workflow/types';
import { approvedAsItStands, COMMIT_REPAIRS, delegableToCommit, refusalToRepair, refusedCommits, describeNeed, needIsDecidedOnStage, needStillHolds, needsUser, repairStuckNeed, requiredWork, staleRepair, unrepairableStale, waitingOnTable, type NeedsUser } from './needs';
import { shownStopReason } from '@/lib/i18n/stop-reasons';
import { RESEARCH_V1 } from '@/lib/workflow/templates/research.v1';

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

  it('an empty chapter plan that asks for its own approval is generated first (2 Nov, production)', () => {
    // A designed workflow's chapter plan holds the outline and the approval on one stage.
    const plan = {
      ...stage('outline'), id: 'chapter_plan',
      exit_criteria: [{ id: 'chapter_plan.approved', label: 'A chapter plan is approved', blocking: true, check: 'auto', rule: { type: 'outline_approved' } }],
    } as unknown as Parameters<typeof needsUser>[0]['stage'];
    const unmet = evaluation('chapter_plan', [{ id: 'chapter_plan.approved', label: 'A chapter plan is approved', satisfied: false, blocking: true }]);
    const input = { ...base, outlineStageId: 'chapter_plan', stage: plan, stageEvaluation: unmet, allowed: ['generate_outline'] };
    expect(needsUser({ ...input, facts: outline(0, false) })).toBeNull();
    // Once written, approving it is the user's.
    expect(needsUser({ ...input, facts: outline(4, false) })).toMatchObject({ kind: 'approve_outline', stageId: 'chapter_plan' });
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
    expect(describeNeed({ kind: 'continue_budget', budgetSteps: 12 }, label)).toEqual({
      message: 'This window of 12 steps is used up and the work is not done.',
      detail: 'Continue starts a new window of 12 steps in a run linked to this one, with the work and its history carried over.',
      action: 'Continue for 12 more steps',
    });
    // 4 Nov (Sean): what was saved, why Go paused, and what Continue does.
    expect(describeNeed({ kind: 'continue_budget', budgetSteps: 25, saved: ['Draft memo', 'Check'] }, label).detail).toBe(
      'Everything it did is saved: Draft memo, Check. Continue starts a new window of 25 steps in a run linked to this one, with the work and its history carried over.'
    );
    expect(describeNeed({ kind: 'continue_budget', budgetSteps: 25, callCap: 400 }, label).message).toBe(
      'Go paused after 400 model calls in this run, the most one run makes without your click.'
    );
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
    expect(describeNeed(need!, label)).toEqual({ message: '2 major or unrated findings are yours to decide: accept, reject or defer each in the table below.', action: 'Go to the table' });
  });

  it('a fully decided table needs nothing', () => {
    expect(needsUser({ ...base, stage: stage('continuity'), facts: review(0, 0), stageEvaluation: evaluation('continuity'), allowed: ['advance_stage'] })).toBeNull();
  });
});

describe('needsUser: an outcome table is the user\'s to decide (production pass, 2026-09-29)', () => {
  it('names the one click when PromptMaster has proposed the statuses (3 Oct)', () => {
    const schema = ITEM_SCHEMAS.alternatives;
    const rows = [
      { id: 'a', explanation: 'x', status: 'ruled_out', reason: 'Reconciled to the ledger.', status_source: 'proposed' },
      { id: 'b', explanation: 'y', status: 'left_open', reason: 'Not tested.', status_source: 'proposed' },
      { id: 'c', explanation: 'z' },
    ];
    const need = needsUser({
      ...base, stage: stage('fact_check'), stageEvaluation: evaluation('fact_check'), allowed: ['revise_stage', 'evaluate_stage'],
      facts: { review: { items: rows, schema, routine: [], material: rows, outcome: true } } as never,
    });
    expect(need).toMatchObject({ kind: 'decide_rows', count: 3, proposed: 2 });
    expect(describeNeed(need!, label)).toEqual({
      message: 'I proposed a status for 2 alternative explanations. Press "Confirm the 2 proposals" above the table, or change any that read wrong. 1 more needs a status from you.',
      action: 'Go to the table',
    });
  });

  it('never stops for rows on a table that says they are optional (C3; Sean, 7 Oct)', () => {
    const schema = { itemLabel: 'item', fields: [], minItems: 1, maxItems: 20, statuses: [] };
    const rows = [{ id: 'a', text: 'x' }, { id: 'b', text: 'y' }];
    const optional = { ...stage('fact_check'), exit_criteria: [] };
    expect(needsUser({
      ...base, stage: optional, stageEvaluation: evaluation('fact_check'), allowed: ['revise_stage', 'evaluate_stage'],
      facts: { review: { items: rows, schema, routine: [], material: rows, outcome: true } } as never,
    })?.kind).not.toBe('decide_rows');
  });

  it('never stops for rows whose status rule is marked not blocking (Exploration, 26 Oct)', () => {
    const schema = ITEM_SCHEMAS.exploration_tests;
    const rows = [{ id: 'a', claim: 'x', test: 't', expected: 'e' }, { id: 'b', claim: 'y', test: 't', expected: 'e' }];
    const tests = { ...stage('fact_check'), exit_criteria: [{ id: 'test.decided', label: 'Every test has a verdict', check: 'auto', rule: { type: 'every_item_has_status' }, blocking: false }] };
    expect(needsUser({
      ...base, stage: tests as never, stageEvaluation: evaluation('fact_check'), allowed: ['revise_stage', 'evaluate_stage'],
      facts: { review: { items: rows, schema, routine: [], material: rows, outcome: true } } as never,
    })?.kind).not.toBe('decide_rows');
  });

  it('stops for undecided claims instead of letting the planner revise the table', () => {
    const schema = { itemLabel: 'claim', fields: [], minItems: 1, maxItems: 20, statuses: [] };
    const rows = [{ id: 'a', claim: 'x', status: 'candidate_source' }, { id: 'b', claim: 'y', status: 'no_source' }];
    const need = needsUser({
      ...base, stage: stage('fact_check'), stageEvaluation: evaluation('fact_check'), allowed: ['revise_stage', 'evaluate_stage'],
      facts: { review: { items: rows, schema, routine: [], material: rows, outcome: true } } as never,
    });
    expect(need).toEqual({ kind: 'decide_rows', stageId: 'fact_check', count: 2, itemLabel: 'claim' });
    expect(describeNeed(need!, label)).toEqual({
      message: '2 claims need your decision: set a status on each in the table below.',
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

  it('a repair that did not settle holds while the stage still waits for its recheck (15 Oct, HARBOR Resume loop)', () => {
    const need: NeedsUser = { kind: 'repair_stuck', stageId: 'objective', why: 'the brief changed', last: '', tries: 2, saved: 0 };
    const withStage = (status: string) => ({ ...base.state, stages: { ...base.state.stages, objective: { ...(base.state.stages.objective ?? {}), status } } });
    expect(needStillHolds(need, at('positioning', { state: withStage('stale') }))).toBe(true);
    expect(needStillHolds(need, at('positioning', { state: withStage('complete') }))).toBe(false);
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
      message: 'I suggest skipping Audience: The audience is already fixed by the brief. You can reopen it later.',
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

  it('a stage that does not close a round gets the same answer with or without `round`', () => {
    const plain = BOOK_V1.stages[0];
    for (const evaluation of [met, unmet]) {
      const allowed = ['propose_next_round', 'evaluate_stage', 'continue_writing'];
      expect(requiredWork({ stage: plain, facts: {}, stageEvaluation: evaluation, allowed, round: { staleDraft: false } }))
        .toEqual(requiredWork({ stage: plain, facts: {}, stageEvaluation: evaluation, allowed }));
    }
  });

  it('leaves the choice to the planner while the stage is not ready, or outside a loop', () => {
    expect(requiredWork({ stage: next, facts: {}, stageEvaluation: unmet, allowed: ['propose_next_round'], round: { staleDraft: false } })).toBeNull();
    expect(requiredWork({ stage: next, facts: {}, stageEvaluation: met, allowed: ['propose_next_round'] })).toBeNull();
  });
});

describe('routine decisions (Sean, 5 Oct): delegated, validated, and the user asked only when it is theirs', () => {
  const draft = { draft: { truncated: false, checked: true } } as Record<string, unknown> as never;
  const differentiator = [{ id: 'pos.differentiator', label: 'I confirm the one-sentence differentiator is stated', satisfied: false, blocking: true, manual: true }];
  const moves = ['evaluate_stage', 'revise_stage', 'advance_stage', 'commit_delegated'];
  const args = (over: Record<string, unknown> = {}) => ({
    ...base, stage: stage('positioning'), facts: draft, stageEvaluation: evaluation('positioning', differentiator), allowed: moves, ...over,
  });

  it('under "handle them for me", a routine approval is checked and committed — not asked', () => {
    expect(requiredWork(args({ routine: 'handle' }))).toMatchObject({ key: 'commit_delegated', params: { criterion_id: 'pos.differentiator' } });
    expect(needsUser(args({ routine: 'handle' }))).toBeNull();
  });

  it('under "Ask me", the same approval is the user\'s, and the card says why', () => {
    expect(requiredWork(args({ routine: 'ask' }))).toBeNull();
    const need = needsUser(args({ routine: 'ask' }));
    expect(need).toMatchObject({ kind: 'tick_criterion', criterionId: 'pos.differentiator', authority: 'policy_ask' });
    expect(describeNeed(need!, label).message).toContain('your routine decisions are set to "Ask me"');
  });

  it('a failed check is repaired, not asked about: Go revises toward it', () => {
    const tried = args({ routine: 'handle', commitTried: ['pos.differentiator'] });
    expect(requiredWork(tried)).toBeNull();
    expect(needsUser(tried)).toBeNull();
    // With no revision left to try, it is the user's after all.
    expect(needsUser({ ...tried, allowed: ['advance_stage'] })).toMatchObject({ kind: 'tick_criterion', criterionId: 'pos.differentiator' });
  });

  // 12 Nov (a client, an executive-search simulation): "Go marked a draft
  // approval as routine, then stopped and asked me to approve it because the
  // original plan didn't name an approver." The check had refused it over
  // "Approver: to confirm"; two rounds of check-and-apply had used the stage's
  // polishing moves, so there was no Revise left and the approval went to him.
  describe('a refused routine approval gets one repair before the user is asked', () => {
    const reason = 'The decision log\'s entry for the original plan contains an open placeholder, "Approver: to confirm".';
    const refused = (repairs: number) => [{ criterionId: 'pos.differentiator', reason, repairs }];
    const first = args({ routine: 'handle', commitTried: ['pos.differentiator'], commitRefused: refused(0) });

    it('revises for what the check said, and nothing else', () => {
      const move = requiredWork(first);
      expect(move).toMatchObject({ key: 'revise_stage', params: { repairs_criterion: 'pos.differentiator' } });
      const instruction = String(move!.params!.instruction);
      expect(instruction).toContain('"Approver: to confirm"');
      expect(instruction).toContain('Change only what that names');
      expect(instruction).toContain('write "approver not specified"');
      expect(move!.rationale).toContain('did not hold on this version');
      expect(needsUser(first)).toBeNull();
    });

    it('commits first when the check has not refused the current version', () => {
      expect(requiredWork(args({ routine: 'handle', commitRefused: [] }))).toMatchObject({ key: 'commit_delegated' });
    });

    it('is the user\'s after that one repair, and the card says what the check said', () => {
      expect(COMMIT_REPAIRS).toBe(1);
      const second = args({ routine: 'handle', allowed: ['advance_stage'], commitTried: ['pos.differentiator'], commitRefused: refused(1) });
      expect(requiredWork(second)).toBeNull();
      const need = needsUser(second);
      expect(need).toMatchObject({ kind: 'tick_criterion', criterionId: 'pos.differentiator', checkReason: reason });
      const message = describeNeed(need!, label).message;
      expect(message).toContain('Needs your approval: "I confirm the one-sentence differentiator is stated".');
      expect(message).toContain('The check did not hold: The decision log');
    });

    it('never repairs under "Ask me", a reserved approval, or a version the user approved as it stands', () => {
      expect(refusalToRepair(stage('positioning'), evaluation('positioning', differentiator), 'ask', refused(0))).toBeNull();
      expect(requiredWork({ ...first, asItStands: true })).toBeNull();
      const research = RESEARCH_V1.stages.find((s) => s.id === 'method')!;
      const plan = [{ id: 'meth.analysisplan', label: 'I approve this analysis plan for execution', satisfied: false, blocking: true, manual: true }];
      expect(refusalToRepair(research, evaluation('method', plan), 'handle', [{ criterionId: 'meth.analysisplan', reason, repairs: 0 }])).toBeNull();
    });

    it('reads the refusals, their reasons and their repairs from the steps', () => {
      const step = (over: Partial<AgentStep>) => ({ stage_id: 'positioning', status: 'succeeded', params: {}, output: '', changes: {}, started_at: '2026-11-12T23:46:17Z', finished_at: '2026-11-12T23:46:18Z', ...over }) as AgentStep;
      const v3 = { id: 'v3', created_at: '2026-11-12T23:46:16Z' };
      const v4 = { id: 'v4', created_at: '2026-11-12T23:47:29Z' };
      const failed = step({ action_key: 'commit_delegated', status: 'failed', params: { criterion_id: 'pos.differentiator' }, changes: { check_reason: reason, checked_version_id: 'v3' } });
      // A step saved before the reason was kept: read from what it printed, and placed by when it started.
      const older = step({
        action_key: 'commit_delegated', status: 'failed', params: { criterion_id: 'pos.differentiator' },
        output: `Checked "X" on version 3: not met — ${reason} I will revise toward it rather than ask you; it is committed only once it holds.`,
      });
      const repair = step({ action_key: 'revise_stage', params: { repairs_criterion: 'pos.differentiator' }, started_at: '2026-11-12T23:47:00Z', finished_at: '2026-11-12T23:47:30Z' });
      expect(refusedCommits([failed], 'positioning', v3)).toEqual([{ criterionId: 'pos.differentiator', reason, repairs: 0 }]);
      expect(refusedCommits([older], 'positioning', v3)).toEqual([{ criterionId: 'pos.differentiator', reason, repairs: 0 }]);
      // The repair made a new version: the old refusal is of the version before it.
      expect(refusedCommits([failed, repair], 'positioning', v4)).toEqual([]);
      expect(refusedCommits([older, repair], 'positioning', v4)).toEqual([]);
      // Refused again on the repaired version: one repair is on record.
      const again = step({ action_key: 'commit_delegated', status: 'failed', params: { criterion_id: 'pos.differentiator' }, changes: { check_reason: reason, checked_version_id: 'v4' }, started_at: '2026-11-12T23:48:00Z', finished_at: '2026-11-12T23:48:10Z' });
      expect(refusedCommits([failed, repair, again], 'positioning', v4)).toEqual([{ criterionId: 'pos.differentiator', reason, repairs: 1 }]);
      // The user's own direction starts the count again.
      const answer = step({ action_key: 'user_answer', started_at: '2026-11-12T23:47:40Z', finished_at: '2026-11-12T23:47:40Z' });
      expect(refusedCommits([failed, repair, answer, again], 'positioning', v4)[0].repairs).toBe(0);
      // Another stage's refusal is not this stage's; and with no version there is nothing refused.
      expect(refusedCommits([failed], 'outline', v3)).toEqual([]);
      expect(refusedCommits([], 'positioning', undefined)).toEqual([]);
    });

    // 13 Nov, production, forcing this very case: the browser's clock was 31
    // seconds ahead of the database's. The step's finish (browser) was later
    // than the repaired version (database), so the refusal of version 3 read
    // as a refusal of version 4: it was never checked again, and the user was
    // asked. The times below are the ones that run recorded.
    it('places a refusal by the version it checked, never by a time the browser wrote', () => {
      const step = (over: Partial<AgentStep>) => ({ stage_id: 'brief', status: 'succeeded', params: {}, output: '', changes: {}, ...over }) as AgentStep;
      const refusedV3 = { action_key: 'commit_delegated', status: 'failed' as const, params: { criterion_id: 'brief.approved' }, started_at: '2026-11-13T16:30:36.195Z', finished_at: '2026-11-13T16:31:07.946Z' };
      const repair = step({ action_key: 'revise_stage', params: { repairs_criterion: 'brief.approved' }, started_at: '2026-11-13T16:30:37.105Z', finished_at: '2026-11-13T16:31:26.710Z' });
      const v4 = { id: 'v4', created_at: '2026-11-13T16:30:54.810Z' };
      // As the step is saved now, naming the version it checked.
      expect(refusedCommits([step({ ...refusedV3, changes: { check_reason: reason, checked_version_id: 'v3' } }), repair], 'brief', v4)).toEqual([]);
      // As it was saved in that run, with no version named: placed by its start, which the database stamped.
      expect(refusedCommits([step({ ...refusedV3, changes: { check_reason: reason } }), repair], 'brief', v4)).toEqual([]);
    });
  });

  it('a reserved approval is never delegated, and the card says it is the user\'s alone', () => {
    const research = RESEARCH_V1.stages.find((s) => s.id === 'method')!;
    const plan = [{ id: 'meth.analysisplan', label: 'I approve this analysis plan for execution', satisfied: false, blocking: true, manual: true }];
    const reserved = { ...base, state: initialState(RESEARCH_V1), stage: research, facts: draft, stageEvaluation: evaluation('method', plan), allowed: moves, routine: 'handle' as const };
    expect(delegableToCommit(research, evaluation('method', plan), 'handle')).toBeNull();
    expect(requiredWork(reserved)).toBeNull();
    const need = needsUser(reserved);
    expect(need).toMatchObject({ kind: 'tick_criterion', criterionId: 'meth.analysisplan', authority: 'reserved' });
    expect(describeNeed(need!, (id) => id).message).toContain('This one is yours alone');
  });
});

describe('Q1a (Sean, 9 Oct): a "not run" row PromptMaster can carry out is work for Go, not the user', () => {
  const schema = ITEM_SCHEMAS.runs;
  const rows = [
    { id: 'a', run: 'Period at 10, 30, 60 and 90 degrees by numerical integration', producible_by: 'PromptMaster — the equation is stated', status: 'not_run', status_source: 'model', reason: 'No data attached.' },
    { id: 'b', run: 'Measure a real pendulum', producible_by: 'Needs data — laboratory timings', status: 'not_run', status_source: 'model', reason: 'No timings provided.' },
  ];
  const facts = { review: { items: rows, schema, routine: [], material: [rows[0]], outcome: true } } as never;

  it('the row a computation can settle is the next move, named with what it is to compute', () => {
    const move = requiredWork({ stage: RESEARCH_V1.stages.find((s) => s.id === 'experiment')!, facts, stageEvaluation: evaluation('experiment'), allowed: ['run_computation'], runAttemptsLeft: 1 });
    expect(move).toMatchObject({ key: 'run_computation', params: { row: 1, goal: rows[0].run } });
    expect(move?.rationale).toContain('the equation is stated');
  });

  it('with no attempts left, or no computation allowed, nothing is forced', () => {
    const experiment = RESEARCH_V1.stages.find((s) => s.id === 'experiment')!;
    expect(requiredWork({ stage: experiment, facts, stageEvaluation: evaluation('experiment'), allowed: ['run_computation'], runAttemptsLeft: 0 })).toBeNull();
    expect(requiredWork({ stage: experiment, facts, stageEvaluation: evaluation('experiment'), allowed: [], runAttemptsLeft: 1 })).toBeNull();
  });
});

describe('the objective check\'s stop (11 Oct, survey brief)', () => {
  const label = (id: string) => (id === 'output' ? 'Output' : id);
  it('names what is unmet and offers to fix it', () => {
    const d = describeNeed({ kind: 'objective_check', stageId: 'output', finding: 'unmet', items: ['Exactly four sections — It has two.'] }, label);
    expect(d.message).toContain('not met: Exactly four sections — It has two.');
    expect(d.options?.map((o) => o.id)).toEqual(['fix', 'stop']);
  });
  it('a check that only lacked a quote does not say anything failed', () => {
    const d = describeNeed({ kind: 'objective_check', stageId: 'output', finding: 'no_evidence', items: [] }, label);
    expect(d.message).toContain('found nothing unmet');
    expect(d.message).not.toMatch(/satisf/);
    expect(d.options?.[0]).toEqual({ id: 'resume', label: 'Carry on' });
  });
  it('met with stages left says where carrying on goes', () => {
    const d = describeNeed({ kind: 'objective_check', stageId: 'output', finding: 'stages_left', items: ['Summary', 'Realign (optional)'], next: 'Summary' }, label);
    expect(d.options?.[0].label).toBe('Carry on to Summary');
  });
  it('holds until the run moves on', () => {
    expect(needStillHolds({ kind: 'objective_check', stageId: 'output', finding: 'unmet', items: [] }, { currentStageId: 'output' } as never)).toBe(true);
  });
});

it('met while still on the stage: the button finishes it, not "carry on to" it', () => {
  const d = describeNeed({ kind: 'objective_check', stageId: 'output', finding: 'stages_left', items: ['Output', 'Summary'], next: 'Output' }, (id) => (id === 'output' ? 'Output' : id));
  expect(d.options?.[0].label).toBe('Finish Output and carry on');
});

describe('"Approve it as it stands" (19 Oct, Research › Method screenshot)', () => {
  const approval = [{ id: 'method.approved', label: 'I approve this analysis plan for execution', satisfied: false, blocking: true, manual: true }];
  const allowed = ['evaluate_stage', 'apply_findings', 'revise_stage'];
  const step = (over: Record<string, unknown>) =>
    ({ stage_id: 'method', action_key: 'request_user_decision', output: '', changes: {}, ...over }) as never;
  const pending = { draft: { truncated: false, checked: false }, evaluationFindings: { count: 1, aboutHead: true } } as never;

  it('the production answer, given after the latest version, means approve as it stands', () => {
    const steps = [step({ action_key: 'revise_stage', changes: { version_ids: ['v3'] } }), step({}), step({ action_key: 'user_answer', output: 'Approve the analysis plan as it stands' })];
    expect(approvedAsItStands(steps, 'method')).toBe(true);
  });

  it('a newer version, a later different answer, or another stage does not count', () => {
    const said = step({ action_key: 'user_answer', output: 'Approve the analysis plan as it stands' });
    expect(approvedAsItStands([said, step({ action_key: 'apply_findings', changes: { version_ids: ['v4'] } })], 'method')).toBe(false);
    expect(approvedAsItStands([said, step({ action_key: 'user_answer', output: 'Check the latest version first, then I\'ll decide' })], 'method')).toBe(false);
    expect(approvedAsItStands([said], 'experiment')).toBe(false);
  });

  it('nothing is checked or applied: the approval tick is what is left', () => {
    const args = { stage: { ...stage('positioning'), id: 'method' }, facts: pending, stageEvaluation: evaluation('method', approval), allowed };
    expect(requiredWork(args)?.key).toBe('apply_findings');
    expect(requiredWork({ ...args, asItStands: true })).toBeNull();
    expect(needsUser({ ...base, ...args, asItStands: true })).toMatchObject({ kind: 'tick_criterion', criterionId: 'method.approved' });
  });
});

describe('a reopened stage Go does not revise is the user\'s to keep or open (2 Nov, production)', () => {
  const stale = { status: 'stale', stale: { reason: 'The work went back to Research after this stage used it.', since: '2026-11-02T00:00:00Z' } };
  const withStale = (stages: Record<string, unknown>) => {
    const s = initialState(BOOK_V1);
    return { ...s, current_stage_id: 'drafting', stages: { ...s.stages, ...stages } } as never;
  };

  it('is found once nothing Go can repair is left, and a reopened draft is still Go\'s', () => {
    expect(unrepairableStale(BOOK_V1, withStale({ outline: stale }))).toBe('outline');
    // Go repairs nothing on a reopened outline, which is why it is the user's.
    expect(staleRepair(BOOK_V1, withStale({ outline: stale }))).toBeNull();
    // A reopened prose stage is Go's to repair, not this.
    expect(unrepairableStale(BOOK_V1, withStale({ positioning: stale }))).toBeNull();
    expect(unrepairableStale(BOOK_V1, withStale({}))).toBeNull();
  });

  it('asks keep or open, never "try once more", and the stop reason reads in Spanish', () => {
    const need = { ...repairStuckNeed(withStale({ outline: stale }), 'outline', []), byHand: true };
    const d = describeNeed(need, label);
    expect(d.message).toBe(
      `${label('outline')} needs a recheck: The work went back to Research after this stage used it. I do not revise this kind of stage myself, and the stages I can repair have been repaired. Keep it as it is now and carry on, or open it and change it yourself.`
    );
    expect(d.options?.map((o) => o.id)).toEqual(['keep', 'open']);
    expect(shownStopReason('es', d.message)).toMatch(/necesita una revisión/);
    // Still the user's while the stage waits; gone once it is kept.
    expect(needStillHolds(need, { ...base, state: withStale({ outline: stale }), stage: stage('outline'), facts: {}, stageEvaluation: evaluation('outline'), objective: 'o', currentStageId: 'drafting' })).toBe(true);
  });
});

describe('Resume saves what was chosen in the table first (6 Nov, production book test)', () => {
  it('is waiting on the table only for rows on that same stage', () => {
    expect(waitingOnTable({ kind: 'triage_findings', stageId: 'review', count: 2 }, 'review')).toBe(true);
    expect(waitingOnTable({ kind: 'decide_rows', stageId: 'review', count: 2, itemLabel: 'row' }, 'review')).toBe(true);
    expect(waitingOnTable({ kind: 'triage_findings', stageId: 'review', count: 2 }, 'manuscript')).toBe(false);
    expect(waitingOnTable({ kind: 'tick_criterion', stageId: 'review', onStage: 'review', criterionId: 'a', label: 'b', authority: 'reserved' } as NeedsUser, 'review')).toBe(false);
    expect(waitingOnTable(null, 'review')).toBe(false);
  });
});

describe('an Assess stage with nothing to judge (6 Nov, production)', () => {
  const stage = { ...BOOK_V1.stages[0], renderer: 'assess' as const, exit_criteria: [] };
  const input = {
    state: initialState(BOOK_V1), stage, stageEvaluation: { canAdvance: false, unmet: [], criteria: [] } as unknown as StageEvaluation,
    allowed: [] as string[], policy: 'autonomous' as const, outlineStageId: null,
  };

  it('asks for the batch before any planner call, in words that name the box', () => {
    const need = needsUser({ ...input, facts: { batch: { offered: false, noun: 'deals' } } });
    expect(need).toMatchObject({ kind: 'paste_batch', stageId: stage.id, noun: 'deals' });
    const said = describeNeed(need!, () => 'Screen');
    expect(said.message).toContain('Paste the deals into the box on this stage and press Assess');
    expect(said.action).toBe('Go to the box');
  });

  it('says items when the stage has no word for them', () => {
    const need = needsUser({ ...input, facts: { batch: { offered: false, noun: null } } });
    expect(describeNeed(need!, () => 'Screen').message).toContain('Paste the items');
  });

  it('judges a batch it was given rather than asking', () => {
    const facts = { batch: { offered: true, noun: 'deals' } };
    expect(needsUser({ ...input, facts })).toBeNull();
    expect(requiredWork({ stage, facts, stageEvaluation: input.stageEvaluation, allowed: ['assess_batch'] })?.key).toBe('assess_batch');
  });

  it('stops asking once something is judged', () => {
    const need = { kind: 'paste_batch' as const, stageId: stage.id, noun: 'deals' };
    const held = (facts: object) => needStillHolds(need, { ...input, facts, objective: 'x', currentStageId: stage.id });
    expect(held({ batch: { offered: false, noun: 'deals' } })).toBe(true);
    expect(held({})).toBe(false);
  });
});

describe('chapters cut off mid-sentence are finished before anything else (8 Nov, production)', () => {
  const tpl = {
    stages: [
      { id: 'draft', label: 'Manuscript', renderer: 'long_form', transitions: {} },
      { id: 'final', label: 'Final', renderer: 'prose', transitions: {} },
    ],
  } as unknown as Parameters<typeof staleRepair>[0];
  const doneAt = (current: string) => ({ current_stage_id: current, stages: { draft: { status: 'complete' }, final: { status: 'complete' } } }) as unknown as Parameters<typeof staleRepair>[1];
  const cut = { draft: ['Chapter 7', 'Chapter 13'] };

  it('names them and asks for no rewrite', () => {
    const move = staleRepair(tpl, doneAt('final'), [], {}, new Set(), null, cut);
    expect(move?.key).toBe('recheck_stage');
    expect(move?.params).toEqual({ stage_id: 'draft', cut: true });
    expect(move?.rationale).toContain('Chapter 7; Chapter 13');
  });

  it('stops after the repair tries are used', () => {
    expect(staleRepair(tpl, doneAt('final'), ['draft', 'draft'], {}, new Set(), null, cut)).toBeNull();
  });

  it('does nothing with no cut chapters', () => {
    expect(staleRepair(tpl, doneAt('final'), [], {}, new Set(), null, {})).toBeNull();
  });

  it('a stale stage is repaired as a stale stage: its rewrite finishes the chapters too', () => {
    const state = { current_stage_id: 'final', stages: { draft: { status: 'stale', stale: { reason: 'x', since: 't' } }, final: { status: 'complete' } } } as unknown as Parameters<typeof staleRepair>[1];
    expect(staleRepair(tpl, state, [], {}, new Set(), null, cut)?.params).toEqual({ stage_id: 'draft', stale_since: 't' });
  });

  it('a finishing step counts as a try', () => {
    const state = doneAt('final');
    const step = { id: 's', action_key: 'recheck_stage', status: 'failed', params: { stage_id: 'draft', cut: true } } as unknown as AgentStep;
    expect(repairTries([step], state, new Set())).toEqual(['draft']);
  });
});

describe('what the final check found unmet (8 Nov, production)', () => {
  const tpl = { stages: [{ id: 'final', label: 'Final', renderer: 'prose', transitions: {} }] } as unknown as Parameters<typeof staleRepair>[0];
  const state = (status: string) => ({ current_stage_id: 'final', stages: { final: { status } } }) as unknown as Parameters<typeof staleRepair>[1];
  const carried = { deliverableId: 'final', rows: ['Checklist item 7 contradicts the verdict.'] };

  it('is repaired on a written stage still in progress, as on a finished one', () => {
    expect(staleRepair(tpl, state('in_progress'), [], {}, new Set(['final']), carried)?.params).toMatchObject({ stage_id: 'final', carried: carried.rows });
    expect(staleRepair(tpl, state('complete'), [], {}, new Set(['final']), carried)?.params).toMatchObject({ stage_id: 'final' });
  });
  it('not on a stage with nothing written, and not past the tries', () => {
    expect(staleRepair(tpl, state('in_progress'), [], {}, new Set(), carried)).toBeNull();
    expect(staleRepair(tpl, state('complete'), ['final', 'final'], {}, new Set(['final']), carried)).toBeNull();
  });
});

describe('a reopened chapter plan under "handle them for me" (8 Nov, production)', () => {
  const tpl = { stages: [
    { id: 'plan', label: 'Chapter plan', renderer: 'outline', transitions: {} },
    { id: 'docs', label: 'Documents', renderer: 'long_form', transitions: {} },
  ] } as unknown as Parameters<typeof staleRepair>[0];
  const state = { current_stage_id: 'docs', stages: { plan: { status: 'stale', stale: { reason: 'The budget changed.', since: 't' } }, docs: { status: 'stale', stale: { reason: 'x', since: 't' } } } } as unknown as Parameters<typeof staleRepair>[1];

  it('is repaired before the chapters that follow it', () => {
    const move = staleRepair(tpl, state, [], {}, new Set(), null, {}, true);
    expect(move?.params).toEqual({ stage_id: 'plan', stale_since: 't' });
  });

  it('stays the user\'s otherwise: left out of the repairs, and named as theirs', () => {
    expect(staleRepair(tpl, state, [], {}, new Set(), null, {}, false)?.params).toEqual({ stage_id: 'docs', stale_since: 't' });
    expect(unrepairableStale(tpl as never, state as never)).toBe('plan');
    expect(unrepairableStale(tpl as never, state as never, true)).toBeNull();
  });
});

