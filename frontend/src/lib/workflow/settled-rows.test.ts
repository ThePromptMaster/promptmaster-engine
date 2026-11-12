/**
 * 12 Nov (a client's training plan): the check asked "confirm absences or
 * leave". He deferred the row and wrote the answer as its reason. The finish
 * counted every deferred major row as unmet, whatever its note said, and Go
 * stopped on it twice.
 */
import { describe, expect, it } from 'vitest';

import { describeSettled, nothingSaid, settleItems, settleKey, settleMarks, userStatements, withMarks } from '@/lib/agent/settle';
import { carriedRowsOf } from '@/lib/agent/needs';
import { carryUserFields } from './apply-findings';
import { initialState, outstandingWork } from './engine';
import { isSettled, keptOpen, markSettled, onlySettles, unsettle } from './settled-rows';
import { carriedForwardUnmet, carriedRows, deferredNotBlocking, itemSchemaFor, serializeItems, type StageItem } from './stage-artifact';
import { SINGLE_OUTPUT_V1 } from './templates/single-output.v1';
import type { WorkflowState } from './types';
import type { ProjectFact } from '@/types/project';

const T = SINGLE_OUTPUT_V1;
const schema = itemSchemaFor(T.stages.find((s) => s.id === 'summary')!);
const NOTE = 'For this fictional baseline, use the staffing and availability figures provided. There are no additional absences to account for.';
const absence = (over: Partial<StageItem> = {}): StageItem => ({
  id: 'i5', text: 'The no-absence assumption is untested. Any absence in North leaves North at 23, below its minimum of 24.',
  severity: 'major', status: 'deferred', status_source: 'user', reason: NOTE, ...over,
}) as StageItem;
const QUOTE = 'There are no additional absences to account for.';

describe('a row the user answered is settled, with its status kept', () => {
  it('counts as carried forward until it is settled, and not after', () => {
    expect(carriedForwardUnmet([absence()], schema)).toHaveLength(1);
    const [row] = markSettled([absence()], 'i5', { quote: QUOTE, source: 'note' });
    expect(row).toMatchObject({ status: 'deferred', status_source: 'user', reason: NOTE, settled_by: QUOTE, settled_source: 'note' });
    expect(isSettled(row)).toBe(true);
    expect(carriedForwardUnmet([row], schema)).toEqual([]);
    expect(carriedRows([row], schema)).toEqual([]);
  });

  it('is still named at the finish, with the answer as its reason', () => {
    const [row] = markSettled([absence()], 'i5', { quote: QUOTE, source: 'note' });
    expect(deferredNotBlocking([row], schema)).toEqual([{ row: expect.stringContaining('no-absence assumption'), reason: NOTE, settled: QUOTE }]);
  });

  it('the finish names it by the answer that settled it, not by an older note that postponed it', async () => {
    const { deferredNote } = await import('@/lib/agent/perform');
    const [row] = markSettled([absence({ reason: 'Will confirm with HR next week.' })], 'i5', { quote: 'HR has confirmed there are no absences.', source: 'fact', ref: 'f1' });
    const note = deferredNote({ template: T, context: { deferred: { summary: deferredNotBlocking([row], schema) } } } as never);
    expect(note).toContain('— settled by your answer: "HR has confirmed there are no absences"');
    expect(note).not.toContain('deferred because Will confirm');
  });

  it('a fact that settles it is named by its id; an empty quote settles nothing', () => {
    expect(markSettled([absence()], 'i5', { quote: 'None expected.', source: 'fact', ref: 'fact-9' })[0].settled_ref).toBe('fact-9');
    expect(isSettled(markSettled([absence()], 'i5', { quote: '   ', source: 'note' })[0])).toBe(false);
  });

  it('"Keep it open instead" reopens it, and it is not read a second time', () => {
    const settled = markSettled([absence()], 'i5', { quote: QUOTE, source: 'note' });
    const [open] = unsettle(settled, 'i5');
    expect(isSettled(open)).toBe(false);
    expect(keptOpen(open)).toBe(true);
    expect(carriedForwardUnmet([open], schema)).toHaveLength(1);
    const template = { stages: [{ id: 'check', label: 'Coverage check' }] } as never;
    expect(settleItems(template, { check: [{ id: 'i5', text: 't', note: NOTE, source: 'user', keptOpen: true }] })).toEqual([]);
  });

  it('a row a later fact superseded is not carried forward either', () => {
    expect(carriedForwardUnmet([absence({ superseded_by: 'The deadline is 12 business days.' })], schema)).toEqual([]);
  });

  it('what settled it survives a rebuilt table, which returns declared fields only', () => {
    const before = markSettled([absence()], 'i5', { quote: QUOTE, source: 'note' });
    const rebuilt = [{ id: 'i5', text: 'The no-absence assumption is untested.', severity: 'major' } as StageItem];
    const [kept] = carryUserFields(before, rebuilt, schema);
    expect(kept).toMatchObject({ status: 'deferred', reason: NOTE, settled_by: QUOTE, settled_source: 'note' });
  });
});

describe('a version that only settles rows reopens nothing after it', () => {
  const a = serializeItems([absence(), absence({ id: 'i6', text: 'Other', severity: 'minor' })]);

  it('is one where nothing but the settled marks changed', () => {
    const b = serializeItems(markSettled([absence(), absence({ id: 'i6', text: 'Other', severity: 'minor' })], 'i5', { quote: QUOTE, source: 'note' }));
    expect(onlySettles(a, b)).toBe(true);
    expect(onlySettles(b, serializeItems(unsettle(JSON.parse(b).items, 'i5')))).toBe(true);
  });

  it('is not one where a status, a reason or a finding changed, or nothing did', () => {
    expect(onlySettles(a, a)).toBe(false);
    expect(onlySettles(a, serializeItems([absence({ reason: 'Reworded.' }), absence({ id: 'i6', text: 'Other', severity: 'minor' })]))).toBe(false);
    expect(onlySettles(a, serializeItems([absence()]))).toBe(false);
    expect(onlySettles(null, a)).toBe(false);
  });
});

describe('the open work no longer holds a settled row', () => {
  const finished = (): WorkflowState => {
    const st = initialState(T);
    for (const s of T.stages) st.stages[s.id] = { ...st.stages[s.id], status: 'complete' } as never;
    return st;
  };

  it('a carried row is open work with its id and note; settled, it is gone', () => {
    const carried = { carriedForward: { summary: ['The no-absence assumption is untested.'] }, carriedRows: { summary: [{ id: 'i5', text: 'The no-absence assumption is untested.', note: NOTE, severity: 'major', source: 'user' }] } };
    const open = outstandingWork(T, finished(), carried);
    expect(open).toEqual([expect.objectContaining({ kind: 'carried_forward', stageId: 'summary', items: [expect.objectContaining({ id: 'i5', note: NOTE })] })]);
    expect(carriedRowsOf(T, open).carried).toEqual([expect.objectContaining({ stageId: 'summary', id: 'i5', note: NOTE })]);
    expect(outstandingWork(T, finished(), {})).toEqual([]);
  });
});

describe('what is read against the user\'s words', () => {
  const template = { stages: [{ id: 'check', label: 'Coverage and staffing check', short_label: 'Coverage check' }, { id: 'final', label: 'Final review' }] } as never;
  const carried = {
    check: [{ id: 'i5', text: 'Absence assumption untested.', note: NOTE, source: 'user' }, { id: 'i6', text: 'Trainer count unconfirmed.', note: 'Defer: routine.', source: 'policy' }],
    final: [{ id: 'o1', text: 'Budget not shown.', note: '', source: 'user' }],
  };
  const fact = (id: string, statement: string, over: Partial<ProjectFact> = {}) => ({ id, statement, retired_at: null, origin: 'user_stated', accepted_by: 'user', ...over }) as unknown as ProjectFact;

  it('names each row by stage and id, and sends a note only when the user wrote it', () => {
    const items = settleItems(template, carried);
    expect(items.map((i) => [i.id, i.stage, i.note])).toEqual([
      ['check::i5', 'Coverage check', NOTE],
      ['check::i6', 'Coverage check', ''],
      ['final::o1', 'Final review', ''],
    ]);
    expect(settleItems(template, carried, { stageId: 'check', rowId: 'i5' })).toHaveLength(1);
    expect(settleItems(template, undefined)).toEqual([]);
  });

  it('offers only what the user stated or decided as statements', () => {
    const { statements, factOf } = userStatements([
      fact('a', 'Headcount: North 30'), fact('b', 'Assumed one trainer', { origin: 'model_assumed' }),
      fact('c', 'Chosen by Go', { accepted_by: 'policy' }), fact('d', 'Old', { retired_at: '2026-11-11' }), fact('e', 'No absences expected.'),
    ]);
    expect(statements).toEqual([{ id: 'f1', text: 'Headcount: North 30' }, { id: 'f2', text: 'No absences expected.' }]);
    expect(factOf.get('f2')).toBe('e');
  });

  it('with nothing said there is nothing to ask, and the same rows and words are asked once', () => {
    const items = settleItems(template, carried);
    expect(nothingSaid(items.filter((i) => !i.note), [])).toBe(true);
    expect(nothingSaid(items, [])).toBe(false);
    expect(settleKey(items, [])).toBe(settleKey(settleItems(template, carried), []));
    expect(settleKey(items, [])).not.toBe(settleKey(items, [{ id: 'f1', text: 'New fact' }]));
  });

  it('turns verdicts into marks on rows, dropping any that name nothing that was sent', () => {
    const items = settleItems(template, carried);
    const marks = settleMarks([
      { id: 'check::i5', by: 'note', quote: QUOTE },
      { id: 'final::o1', by: 'f2', quote: 'No absences expected.' },
      { id: 'final::o1', by: 'f9', quote: 'x' },
      { id: 'other::i1', by: 'note', quote: 'x' },
      { id: 'check::i6', by: 'note', quote: '  ' },
    ], items, new Map([['f2', 'e']]));
    expect(marks).toEqual([
      { stageId: 'check', rowId: 'i5', quote: QUOTE, source: 'note' },
      { stageId: 'final', rowId: 'o1', quote: 'No absences expected.', source: 'fact', ref: 'e' },
    ]);
    expect(settleMarks(null, items, new Map())).toEqual([]);
  });

  it('marks the table\'s rows and says what was settled', () => {
    const content = serializeItems([absence()]);
    const marks = [{ stageId: 'check', rowId: 'i5', quote: QUOTE, source: 'note' as const }];
    const next = withMarks(content, 'check', marks)!;
    expect(JSON.parse(next).items[0]).toMatchObject({ status: 'deferred', settled_by: QUOTE });
    expect(onlySettles(content, next)).toBe(true);
    expect(withMarks(content, 'final', marks)).toBeNull();
    expect(withMarks(next, 'check', marks)).toBeNull();
    expect(describeSettled(marks, () => 'Coverage check')).toContain(`i5 (Coverage check): "${QUOTE}"`);
  });
});
