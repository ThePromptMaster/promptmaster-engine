import { describe, expect, it } from 'vitest';
import { carryNewerFixes, describeCarried, CARRY_REASON } from './review-rounds';
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
