import { describe, expect, it } from 'vitest';
import { carryNewerFixes, describeCarried, fixesToMerge, reasksCarried, CARRY_REASON } from './review-rounds';
import { templateFromDesign } from '@/lib/workflow/custom';
import { BOOK_V1 } from '@/lib/workflow/templates/book.v1';
import { SINGLE_OUTPUT_V1 } from '@/lib/workflow/templates/single-output.v1';
import { serializeItems, type StageItem, type StageItemSchema } from '@/lib/workflow/stage-artifact';

const schema: StageItemSchema = {
  itemLabel: 'item',
  fields: [{ key: 'text', label: 'Item', long: true, max: 600 }],
  minItems: 1,
  maxItems: 12,
  statuses: [
    { value: 'accepted', label: 'Accept', tone: 'done', modelMayPropose: true },
    { value: 'deferred', label: 'Defer', tone: 'neutral', requiresReason: true, modelMayPropose: true },
    { value: 'rejected', label: 'Reject', tone: 'warn', requiresReason: true },
  ],
};

const row = (id: string, text: string, extra: Partial<StageItem> = {}): StageItem =>
  ({ id, text, status: 'accepted', status_source: 'policy', reason: 'Routine fix.', ...extra }) as StageItem;

// 19 Oct, FIELDGUIDE copy: the first round (fr1–fr2) was merged when Go went back at 15:56.
const firstRound = [row('fr1', 'Merge the realignment replacements into the pack.'), row('fr2', 'Cut the memo to 400 words.')];
const versions = [
  { content: serializeItems(firstRound), created_at: '2026-10-19T15:40:00Z' },
  { content: serializeItems([...firstRound]), created_at: '2026-10-19T16:20:00Z' },
];
const returned = [{ stage_id: 'summary', action_key: 'return_to_stage', status: 'succeeded' as const, started_at: '2026-10-19T15:56:00Z' }];
const question = 'You accepted seven fixes against version 5. Shall we go back to the Output stage and apply them?';

const newerRoutine = [
  ...firstRound,
  row('fr11', 'Output v5 opens with a change list above the six headings; move it out.'),
  row('fr12', 'Tighten the ownership reason in one register row.'),
  row('fr9', 'These checks passed, and no change is needed.', { suggested_change: 'No change required' }),
];

const base = { question, isReviewStage: true, stageId: 'summary', schema, steps: returned, versions, policy: 'autonomous' as const, routine: 'handle' as const };

describe('a second round of review fixes (19 Oct, FIELDGUIDE)', () => {
  it('is carried forward, not another trip back, once a round was merged in this run', () => {
    const r = carryNewerFixes({ ...base, items: newerRoutine });
    expect(r?.carried.map((i) => i.id)).toEqual(['fr11', 'fr12']);
    expect(r?.items.find((i) => i.id === 'fr11')).toMatchObject({ status: 'deferred', status_source: 'policy', reason: CARRY_REASON });
    // The merged round, and a row that reports nothing wrong, are left as they were.
    expect(r?.items.find((i) => i.id === 'fr1')?.status).toBe('accepted');
    expect(r?.items.find((i) => i.id === 'fr9')?.status).toBe('accepted');
    expect(describeCarried(r!)).toMatch(/^Carried forward: 2 newer fixes from the second review/);
  });

  it('counts a round merged in an earlier run: each Resume starts a new run', () => {
    // 19 Oct, prod: the merge round was in the run that blocked; after Resume
    // the new run had no return of its own and Go asked to go back again.
    const events = [{ type: 'stage_returned' as const, stage_id: 'summary', created_at: '2026-10-19T15:56:00Z' }];
    expect(carryNewerFixes({ ...base, items: newerRoutine, steps: [], events })?.carried.map((i) => i.id)).toEqual(['fr11', 'fr12']);
    // A return from another stage does not count.
    expect(carryNewerFixes({ ...base, items: newerRoutine, steps: [], events: [{ ...events[0], stage_id: 'realign' }] })).toBeNull();
  });

  it('still asks the first time: nothing has been merged yet', () => {
    expect(carryNewerFixes({ ...base, items: newerRoutine, steps: [] })).toBeNull();
  });

  it('still asks when a newer fix says a requirement is unmet, or is major', () => {
    const unmet = [...newerRoutine, row('fr13', 'C6 requires Section 6 to state why this decision is next; that reason is absent.')];
    expect(carryNewerFixes({ ...base, items: unmet })).toBeNull();
    const major = [...newerRoutine, row('fr14', 'Workshop 3 timing needs a slot reordered.', { severity: 'major' })];
    expect(carryNewerFixes({ ...base, items: major })).toBeNull();
  });

  it('still asks when the user accepted a newer fix themselves', () => {
    const mine = [...newerRoutine, row('fr15', 'Rename the register heading.', { status_source: 'user' })];
    expect(carryNewerFixes({ ...base, items: mine })).toBeNull();
  });

  it('still asks under "ask me", outside Autonomous, off a review stage, or for another question', () => {
    expect(carryNewerFixes({ ...base, items: newerRoutine, routine: 'ask' })).toBeNull();
    expect(carryNewerFixes({ ...base, items: newerRoutine, policy: 'checkpoint' })).toBeNull();
    expect(carryNewerFixes({ ...base, items: newerRoutine, isReviewStage: false })).toBeNull();
    expect(carryNewerFixes({ ...base, items: newerRoutine, question: 'Which audience should the memo address?' })).toBeNull();
  });
});

describe('going back for fixes already carried forward (19 Oct, FIELDGUIDE, after Resume)', () => {
  const carried = carryNewerFixes({ ...base, items: newerRoutine })!.items;
  const ask = { isReviewStage: true, items: carried, policy: 'autonomous' as const, routine: 'handle' as const };
  const reask = 'Five fixes from the latest review are still open. Should I accept them and go back to Output to apply them in one merged version?';

  it('is not asked: Go finishes and names them', () => {
    expect(reasksCarried({ ...ask, question: reask })).toMatch(/^2 newer fixes are already carried forward/);
  });

  it('is still asked under "ask me", outside Autonomous, off a review, or for another question', () => {
    expect(reasksCarried({ ...ask, question: reask, routine: 'ask' })).toBeNull();
    expect(reasksCarried({ ...ask, question: reask, policy: 'checkpoint' })).toBeNull();
    expect(reasksCarried({ ...ask, question: reask, isReviewStage: false })).toBeNull();
    expect(reasksCarried({ ...ask, question: 'Which audience should the memo address?' })).toBeNull();
  });

  it('is still asked when nothing was carried, or the user accepted a fix themselves', () => {
    expect(reasksCarried({ ...ask, question: reask, items: newerRoutine })).toBeNull();
    expect(reasksCarried({ ...ask, question: reask, items: [...carried, row('fr15', 'Add the reason.', { status_source: 'user' })] })).toBeNull();
  });
});

describe('accepted fixes reach the deliverable before it is signed off (6 Nov, production)', () => {
  const stage = SINGLE_OUTPUT_V1.stages.find((x) => x.id === 'summary')!;
  const fix = (id: string, status_source = 'policy'): StageItem => ({
    id, finding: `Finding ${id}`, suggested_change: 'Cut it', severity: 'minor', status: 'accepted', status_source,
  } as StageItem);
  const base = {
    template: SINGLE_OUTPUT_V1, stage, items: [fix('a'), fix('b', 'user')], undecided: 0,
    events: [], versions: [], policy: 'autonomous' as const, routine: 'handle' as const,
  };

  it('goes back to the deliverable, with the rows there are to apply', () => {
    const merge = fixesToMerge(base);
    expect(merge?.target).toEqual({ id: 'output', label: 'Output and evaluation' });
    expect(merge?.rows.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('leaves it to the user unless the run may go back itself', () => {
    expect(fixesToMerge({ ...base, routine: 'ask' })).toBeNull();
    expect(fixesToMerge({ ...base, policy: 'guided' })).toBeNull();
  });

  it('waits for undecided rows', () => {
    expect(fixesToMerge({ ...base, undecided: 1 })).toBeNull();
  });

  it('has nothing to carry when no row asks for a change', () => {
    expect(fixesToMerge({ ...base, items: [{ ...fix('a'), suggested_change: '' }] })).toBeNull();
    expect(fixesToMerge({ ...base, items: [{ ...fix('a'), suggested_change: 'No change needed' }] })).toBeNull();
    expect(fixesToMerge({ ...base, items: [{ ...fix('a'), status: 'rejected' }] })).toBeNull();
  });

  it('only on the last stage: a review with a stage after it hands its rows on', () => {
    const critique = BOOK_V1.stages.find((x) => x.id === 'critique')!;
    expect(fixesToMerge({ ...base, template: BOOK_V1, stage: critique })).toBeNull();
  });

  it('not in a workflow with chapters, which has its own revision stage', () => {
    const last = BOOK_V1.stages.at(-1)!;
    expect(fixesToMerge({ ...base, template: BOOK_V1, stage: last })).toBeNull();
  });

  it('finds the deliverable of a designed workflow', () => {
    const template = templateFromDesign({
      name: 'Deck', description: '', deliverable: 'deck', inquiry: false,
      stages: [
        { label: 'Message', short_label: 'Message', kind: 'write', purpose: '', instruction: 'x', required: true, approval: '' },
        { label: 'Slides', short_label: 'Slides', kind: 'write', purpose: '', instruction: 'x', required: true, approval: '' },
        { label: 'Final review', short_label: 'Review', kind: 'check', purpose: '', instruction: 'x', required: true, approval: 'I approve' },
      ],
    }, 'custom_ex_test');
    const last = template.stages.at(-1)!;
    expect(fixesToMerge({ ...base, template, stage: last })?.target.label).toBe('Slides');
  });

  it('sent back once, a later round goes back only for what the user accepted', () => {
    const events = [{ type: 'stage_returned' as const, stage_id: 'summary', created_at: '2026-11-06T10:00:00Z' }];
    const versions = [{ content: serializeItems([fix('a')]), created_at: '2026-11-06T09:00:00Z' }];
    // Merged last time.
    expect(fixesToMerge({ ...base, events, versions, items: [fix('a')] })).toBeNull();
    // Newer, and routine: carried forward instead.
    expect(fixesToMerge({ ...base, events, versions, items: [fix('a'), fix('c')] })).toBeNull();
    // Newer, and the user's own.
    expect(fixesToMerge({ ...base, events, versions, items: [fix('a'), fix('d', 'user')] })?.rows.map((r) => r.id)).toEqual(['d']);
    // But not for ever.
    const many = [...events, ...events, ...events];
    expect(fixesToMerge({ ...base, events: many, versions, items: [fix('d', 'user')] })).toBeNull();
  });
});
