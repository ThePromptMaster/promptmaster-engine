/**
 * 12 Nov (a client): "If one answer clears three blockers, Go should ask once,
 * apply the answer everywhere it matters, and keep going."
 */
import { describe, expect, it } from 'vitest';

import { keptQuestions } from './account';
import { holdsUpLine, queueLines, restOfQueue, userQueue, QUEUE_MAX } from './user-queue';
import type { OutstandingItem } from '@/lib/workflow/engine';
import type { WorkflowState, WorkflowTemplate } from '@/lib/workflow/types';
import type { AgentStep } from '@/types/agent';

const criterion = (id: string, label: string, authority?: 'delegable' | 'reserved') => ({ id, label, check: 'manual', blocking: true, ...(authority ? { authority } : {}) });
const template = {
  stages: [
    { id: 'baseline', label: 'Baseline', exit_criteria: [criterion('baseline.ok', 'I confirm the baseline', 'delegable')] },
    { id: 'check', label: 'Coverage and staffing check', short_label: 'Coverage check', exit_criteria: [] },
    { id: 'options', label: 'Options A/B', exit_criteria: [criterion('options.choice', 'I choose the recovery option', 'reserved')] },
    { id: 'final', label: 'Final package', exit_criteria: [criterion('final.accept', 'I accept this package as final', 'reserved')] },
  ],
} as unknown as WorkflowTemplate;
const state = (statuses: Record<string, string>): WorkflowState =>
  ({ stages: Object.fromEntries(template.stages.map((s) => [s.id, { status: statuses[s.id] ?? 'not_started' }])) }) as unknown as WorkflowState;
const written = (...ids: string[]) => Object.fromEntries(ids.map((id) => [id, { versions: [{ id: `${id}-v1`, content: 'Text.' }] }])) as never;
const step = (over: Partial<AgentStep>): AgentStep => ({ id: 's', stage_id: 'baseline', action_key: 'advance_stage', params: {}, status: 'succeeded', output: '', decision_question: null, ...over }) as AgentStep;

describe('one list of what waits on the user, across every stage', () => {
  const outstanding: OutstandingItem[] = [
    { kind: 'open_findings', stageId: 'check', label: 'Coverage check', count: 1, rows: [{ id: 'i2', text: 'Named lists are missing.', severity: 'major', suggested_change: 'Add them.' }] } as never,
    { kind: 'carried_forward', stageId: 'check', label: 'Coverage check', rows: ['The no-absence assumption is untested.'], items: [{ id: 'i5', text: 'The no-absence assumption is untested.', note: 'No absences.' }] },
    { kind: 'stale_stage', stageId: 'baseline', label: 'Baseline', reason: 'x' },
  ];
  const kept = [{ stepId: 'k1', stageId: 'baseline', question: 'Is one trainer enough?', choices: ['Yes', 'No, two'] }];
  const queue = userQueue({
    template, state: state({ baseline: 'complete', check: 'complete', options: 'in_progress' }), outstanding,
    bundles: written('baseline', 'check', 'options'), manualChecks: {}, routine: 'handle', kept,
  });

  it('holds the approval, the undecided finding, the carried row and the kept question, each by stage', () => {
    expect(queue.map((q) => [q.kind, q.stageLabel, q.rowId ?? q.criterionId ?? q.stepId])).toEqual([
      ['approval', 'Options A/B', 'options.choice'],
      ['finding', 'Coverage check', 'i2'],
      ['carried', 'Coverage check', 'i5'],
      ['kept_question', 'Baseline', 'k1'],
    ]);
    expect(queue.find((q) => q.kind === 'carried')).toMatchObject({ note: 'No absences.', text: 'The no-absence assumption is untested.' });
    expect(queue.find((q) => q.kind === 'finding')?.text).toBe('Named lists are missing. — suggested change: Add them.');
    expect(queue.find((q) => q.kind === 'kept_question')?.choices).toEqual(['Yes', 'No, two']);
  });

  it('says what each holds up, from the workflow\'s own order, and puts the most held up first', () => {
    const approval = queue.find((q) => q.kind === 'approval')!;
    expect(approval.holdsUp).toEqual(['Options A/B', 'Final package']);
    expect(holdsUpLine(approval)).toBe('Options A/B, Final package and the finish');
    expect(holdsUpLine({ holdsUp: [], blocksFinish: false })).toBe('');
    expect(holdsUpLine({ holdsUp: ['A', 'B', 'C', 'D', 'E'], blocksFinish: false })).toBe('A, B, C and 2 more stages');
  });

  it('leaves out an approval Go may give itself, one already given, and a stage not written yet', () => {
    expect(queue.some((q) => q.criterionId === 'baseline.ok')).toBe(false);
    expect(queue.some((q) => q.criterionId === 'final.accept')).toBe(false);
    const asking = userQueue({
      template, state: state({ baseline: 'in_progress' }), outstanding: [], bundles: written('baseline'), manualChecks: {}, routine: 'ask',
    });
    expect(asking.map((q) => q.criterionId)).toEqual(['baseline.ok']);
    const given = userQueue({
      template, state: state({ options: 'in_progress' }), outstanding: [], bundles: written('options'), manualChecks: { 'options.choice': true }, routine: 'handle',
    });
    expect(given).toEqual([]);
  });

  it('is the rest of the list once the stop\'s own question is taken out', () => {
    expect(restOfQueue(queue, { criterionId: 'options.choice' }).map((q) => q.kind)).toEqual(['finding', 'carried', 'kept_question']);
    expect(restOfQueue(queue, { rowIds: ['i5', 'i2'] }).map((q) => q.kind)).toEqual(['approval', 'kept_question']);
    expect(restOfQueue(queue, { question: 'Before I go on: is one trainer enough? It changes the plan.' }).map((q) => q.kind)).toEqual(['approval', 'finding', 'carried']);
    expect(restOfQueue(queue, null)).toHaveLength(4);
  });

  it('is told to the planner as what is already waiting, and never more than a screenful', () => {
    expect(queueLines(queue)[0]).toBe('Options A/B: approval "I choose the recovery option"');
    const many = userQueue({
      template, state: state({ check: 'complete' }), bundles: written('check'), manualChecks: {}, routine: 'handle',
      outstanding: [{ kind: 'open_findings', stageId: 'check', label: 'Check', count: 20, rows: Array.from({ length: 20 }, (_, i) => ({ id: `i${i}`, text: `Finding ${i}` })) } as never],
    });
    expect(many).toHaveLength(QUEUE_MAX);
  });
});

describe('a question set aside is kept until it is answered', () => {
  const steps = [
    step({ id: 'a', stage_id: 'baseline', params: { set_aside_question: 'Is one trainer enough for the week?', choices: ['Yes', 'No', 3] } }),
    step({ id: 'b', stage_id: 'check', params: { set_aside_question: 'Is one trainer enough for the week?' } }),
    step({ id: 'c', stage_id: 'check', params: { set_aside_question: 'Should South have a fourth slot?' } }),
  ];

  it('lists each once, with the answers it offered', () => {
    expect(keptQuestions(steps)).toEqual([
      { stepId: 'a', stageId: 'baseline', question: 'Is one trainer enough for the week?', choices: ['Yes', 'No'] },
      { stepId: 'c', stageId: 'check', question: 'Should South have a fourth slot?', choices: [] },
    ]);
  });

  it('drops one answered from the list of what is waiting, or asked again and answered', () => {
    expect(keptQuestions(steps, new Set(['c'])).map((k) => k.stepId)).toEqual(['a']);
    const asked = [
      ...steps,
      step({ id: 'd', action_key: 'request_user_decision', decision_question: 'Is one trainer enough for the week?' }),
      step({ id: 'e', action_key: 'user_answer', output: 'Yes.' }),
    ];
    expect(keptQuestions(asked).map((k) => k.stepId)).toEqual(['c']);
  });
});

describe('items one answer settles are asked as one question', () => {
  const item = (over: Record<string, unknown>) => ({ id: 'x', kind: 'carried', stageId: 'check', stageLabel: 'Coverage check', text: 't', holdsUp: [], blocksFinish: true, ...over }) as never;
  const queue = [
    item({ id: 'approval:options:c', kind: 'approval', stageId: 'options', stageLabel: 'Options A/B', text: 'I choose the recovery option', criterionId: 'c', holdsUp: ['Options A/B', 'Final package'] }),
    item({ id: 'carried:check:i5', rowId: 'i5', text: 'The no-absence assumption is untested.', note: 'No absences.' }),
    item({ id: 'finding:check:i2', kind: 'finding', rowId: 'i2', text: 'Named lists are missing.' }),
    item({ id: 'kept_question:brief:k1', kind: 'kept_question', stageId: 'brief', stageLabel: 'Brief', stepId: 'k1', text: 'Should the brief treat absence as a risk?', blocksFinish: false, choices: ['Yes', 'No'] }),
  ];

  it('only a carried row and a kept question can share an answer', async () => {
    const { mergeable, groupingItems } = await import('./user-queue');
    expect(queue.map((q) => mergeable(q))).toEqual([false, true, false, true]);
    expect(groupingItems(queue)).toEqual([
      { id: 'carried:check:i5', stage: 'Coverage check', text: 'The no-absence assumption is untested. (note on it: No absences.)' },
      { id: 'kept_question:brief:k1', stage: 'Brief', text: 'Should the brief treat absence as a risk?' },
    ]);
  });

  it('a group becomes one entry where its first item stood, with the one question and its answers', async () => {
    const { mergeQueue, entryHoldsUp } = await import('./user-queue');
    const entries = mergeQueue(queue, [{ ids: ['carried:check:i5', 'kept_question:brief:k1'], question: 'Are any absences expected that week?', choices: ['None', 'Yes'] }]);
    expect(entries.map((e) => [e.key, e.items.length])).toEqual([
      ['approval:options:c', 1],
      ['carried:check:i5|kept_question:brief:k1', 2],
      ['finding:check:i2', 1],
    ]);
    expect(entries[1]).toMatchObject({ question: 'Are any absences expected that week?', choices: ['None', 'Yes'] });
    expect(entryHoldsUp(entries[1])).toBe('the finish');
    expect(entryHoldsUp(entries[0])).toBe('Options A/B, Final package and the finish');
  });

  it('a group naming an item that cannot share an answer, or one no longer waiting, is dropped', async () => {
    const { mergeQueue } = await import('./user-queue');
    const single = mergeQueue(queue, [
      { ids: ['carried:check:i5', 'finding:check:i2'], question: 'Both?', choices: [] },
      { ids: ['carried:check:i5', 'kept_question:gone:k9'], question: 'Gone?', choices: [] },
      { ids: ['carried:check:i5', 'kept_question:brief:k1'], question: '  ', choices: [] },
    ]);
    expect(single.map((e) => e.items.length)).toEqual([1, 1, 1, 1]);
    expect(single[3].choices).toEqual(['Yes', 'No']);
    expect(mergeQueue(queue, null)).toHaveLength(4);
  });

  it('a kept question is covered by the fact that answered it, or the step that settled it', async () => {
    const { answeredKept } = await import('./user-queue');
    const covered = answeredKept(
      [{ source_ref: { kept_step_ids: ['k1', 7] }, retired_at: null }, { source_ref: { kept_step_ids: ['k2'] }, retired_at: '2026-11-12' }, { source_ref: null }],
      [{ action_key: 'settled_by_answer', params: { kept_settled: ['k3'] } }, { action_key: 'advance_stage', params: {} }]
    );
    expect([...covered].sort()).toEqual(['k1', 'k3']);
  });
});
