import { describe, expect, it } from 'vitest';

import { keptQuestions, runAccount } from './account';
import { returnWorkToCarry } from './manuscript-fixes';
import { planFromScreen, type QuestionScreen } from './question-screen';
import { resolvedFindings, stillWaiting, type QueueEntry, type QueueItem } from './user-queue';
import { blocksCompletion, outstandingWork, rowsRequired } from '@/lib/workflow/engine';
import { isPendingResearch } from '@/lib/workflow/stage-artifact';
import type { WorkflowTemplate } from '@/lib/workflow/types';

/**
 * 17 Nov, Sean (Hidden Innovation): "When I clicked one, Go continued before I
 * could answer the others"; "blocked completion on three manuscript findings it
 * described as resolved, grouped them with six source-check findings, and showed
 * three versions of the same request to record the authorship."
 */

const item = (over: Partial<QueueItem>): QueueItem => ({ id: 'x', kind: 'finding', stageId: 'review', stageLabel: 'Review', text: 't', holdsUp: [], blocksFinish: true, ...over });
const one = (i: QueueItem): QueueEntry => ({ key: i.id, items: [i] });

describe('answer everything, then Resume once', () => {
  const entries = [
    one(item({ id: 'a1', kind: 'approval', criterionId: 'plan.decision', text: 'I choose the measurement paper' })),
    one(item({ id: 'a2', kind: 'approval', criterionId: 'plan.resources', text: 'I accept the resource commitments' })),
    one(item({ id: 'f1', rowId: 'h2', text: 'Section 7 still uses the multiplicative model.' })),
  ];
  it('what still waits once one answer is given', () => {
    expect(stillWaiting(entries, { criterionIds: ['plan.decision'] }).map((e) => e.key)).toEqual(['a2', 'f1']);
    expect(stillWaiting(entries, { criterionIds: ['plan.decision', 'plan.resources'], rowIds: ['h2'] })).toEqual([]);
  });

  it('"Ready to carry on" says what is still waiting', () => {
    const run = { status: 'awaiting_decision', stop_reason: 'Ready to carry on — press Resume.', needs: null } as never;
    expect(runAccount(run, [], (id) => id)?.now).toBe('Ready to carry on — press Resume.');
    expect(runAccount(run, [], (id) => id, 'en', undefined, false, 3)?.now).toBe('Recorded. 3 more things wait on you below: answer them now, or press Resume and Go will ask when it reaches them.');
  });
});

describe('verified fixes close in one press', () => {
  it('findings whose own text says they are resolved', () => {
    const e = [
      one(item({ id: 'h1', rowId: 'h1', text: 'Resolved in consolidated manuscript v2, Section 1. It restores Bell et al.' })),
      one(item({ id: 'h4', rowId: 'h4', text: 'Section 7 still uses the multiplicative model.' })),
      one(item({ id: 'a', kind: 'approval', criterionId: 'c', text: 'Resolved to proceed' })),
    ];
    expect(resolvedFindings(e).map((x) => x.key)).toEqual(['h1']);
  });
});

describe('research still to do does not block the finish', () => {
  it('a source that could not be read in full is pending research; a fault in the text is not', () => {
    expect(isPendingResearch({ id: 'p0-s54', finding: 'P0, conference paper [S54]: could not be read in full. The saved text is a short excerpt.', suggested_change: 'Retrieve the full PDF and search it.' })).toBe(true);
    expect(isPendingResearch({ id: 'h2', finding: 'Section 7 uses the multiplicative model.', suggested_change: 'Use the additive model.' })).toBe(false);
    expect(isPendingResearch({ id: 'p0', status: 'accepted', finding: 'could not be read in full' })).toBe(false);
  });

  it('listed as pending research, never holding up the finish', () => {
    const template = { stages: [{ id: 'check', label: 'P0 check', short_label: 'P0 check', renderer: 'review', exit_criteria: [], transitions: {} }] } as unknown as WorkflowTemplate;
    const state = { current_stage_id: 'check', stages: { check: { status: 'in_progress' } } } as never;
    const rows = [{ id: 'p0-s54', text: 'could not be read in full' }];
    const items = outstandingWork(template, state, { pendingResearch: { check: rows } } as never);
    const research = items.find((i) => i.kind === 'pending_research');
    expect(research).toMatchObject({ kind: 'pending_research', stageId: 'check', rows });
    expect(blocksCompletion(research!)).toBe(false);
  });

  it('a table whose "every finding decided" rule does not block does not require every row', () => {
    expect(rowsRequired({ exit_criteria: [{ id: 'x', label: 'Every finding decided', check: 'auto', rule: { type: 'all_findings_triaged' }, blocking: false }] } as never)).toBe(false);
    expect(rowsRequired({ exit_criteria: [{ id: 'x', label: 'Every finding decided', check: 'auto', rule: { type: 'all_findings_triaged' }, blocking: true }] } as never)).toBe(true);
  });
});

describe('one question, once', () => {
  it('the same request on one stage in three wordings is kept once', () => {
    const step = (id: string, q: string) => ({ id, action_key: 'advance_stage', status: 'succeeded', stage_id: 'memo', params: { set_aside_question: q }, changes: {}, output: '' }) as never;
    const kept = keptQuestions([
      step('1', 'Should I record the authorship of [S81] as the three authors named on the paper?'),
      step('2', 'Do you want me to record the [S81] authorship as the three named authors of the paper?'),
      step('3', 'Record the authorship for [S81] as the paper\'s three named authors?'),
    ]);
    expect(kept).toHaveLength(1);
  });
});

describe('a correction is not polish (17 Nov: a citation fix was asked about at the edit limit)', () => {
  const screen = (over: Partial<QuestionScreen>): QuestionScreen => ({ verdict: 'routine_repair', reason: 'An error in the text.', instruction: 'Correct the citation for Coluccia to the 2021 paper.', target_stage: '', action: '', requirement_quote: '', ...over });
  const base = { question: 'Should I correct the Coluccia citation?', template: { stages: [] } as never, stage: { transitions: {} } as never, allowed: ['advance_stage'], returnsLeft: 0 };
  it('one correction is made beyond the limit', () => {
    const plan = planFromScreen(screen({}), base);
    expect(plan.kind === 'repair' && plan.move.action_key).toBe('revise_stage');
    expect(plan.kind === 'repair' && plan.move.params.correction_beyond_limit).toBe(true);
  });
  it('a second one, or a request that only polishes, is not', () => {
    expect(planFromScreen(screen({}), { ...base, correctionsBeyondLimit: 1 }).kind === 'repair' && (planFromScreen(screen({}), { ...base, correctionsBeyondLimit: 1 }) as { move: { action_key: string } }).move.action_key).toBe('advance_stage');
    const polish = planFromScreen(screen({ instruction: 'Tighten the opening paragraph.' }), { ...base, question: 'Tighten it?' });
    expect(polish.kind === 'repair' && polish.move.action_key).toBe('advance_stage');
  });
});

describe('the work Go went back to the manuscript for is carried into it', () => {
  it('the latest return with work named, once, whichever stage delivers (17 Nov, production pass: the Final book did)', () => {
    const template = { stages: [{ id: 'manuscript', renderer: 'long_form' }, { id: 'final', renderer: 'prose' }] } as never;
    const events = [{ type: 'stage_returned', to_stage_id: 'manuscript', created_at: 't1', payload: { work: 'Add one line to Chapter 1 giving Alex a rough time frame.' } }] as never;
    expect(returnWorkToCarry(template, events, new Set())).toEqual({ stageId: 'manuscript', rows: [{ key: 'return:t1', text: '[went back for] Add one line to Chapter 1 giving Alex a rough time frame.' }] });
    expect(returnWorkToCarry(template, events, new Set(['return:t1']))).toBeNull();
    // A return to a prose stage is that stage's own work, not this.
    expect(returnWorkToCarry(template, [{ type: 'stage_returned', to_stage_id: 'final', created_at: 't2', payload: { work: 'x' } }] as never, new Set())).toBeNull();
  });
});
