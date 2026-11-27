import { describe, expect, it, vi } from 'vitest';

import { activeRows, appendBatch, comparativeRows, DEFAULT_SCALE, referenceOf, tableLines, verdictCounts } from './assess';
import { assessPaste } from './assess-run';
import { assessmentText } from './digest';
import type { StageItem } from './stage-artifact';

// 27 Nov (Sean, Morrow Library; L-330): "I reopened [Assess], submitted the
// revision under V-B, and used Apply and continue. Assess kept both Briar rows
// active and Cedar's old 'only eligible bid' explanation." His saved rows.
const row = (id: string, subject: string, verdict: string, rationale: string, profile: string): StageItem => ({ id, subject, verdict, rationale, profile, batch: '1', assessed_at: '2026-11-27T15:32:00Z', model_verdict: verdict, verdict_source: 'model' });
const table: StageItem[] = [
  row('a_5f0f36a00b', 'V-A Alder | Week 1 Monday original bid', 'Red', '- G2 missed: delivery Week 5 Monday, a deal-breaker. M1 fails, so the bid is ineligible and not ranked.', 'V-A Alder | Week 1 Monday original bid | Equipment $37,000; installation $3,000; delivery Week 5 Monday.'),
  row('a_b573e4131b', 'V-B Briar | Week 1 Monday original bid', 'Red', '- G3 missed: insurance certificate missing, a deal-breaker.', 'V-B Briar | Week 1 Monday original bid | Equipment $37,500; installation $2,000; insurance certificate missing.'),
  row('a_b8d532bdfb', 'V-C Cedar | Week 1 Monday original bid', 'Green', '- P1 met: it is the only bid that passes G1 to G3, so it has the lowest all-in cost among eligible bids.', 'V-C Cedar | Week 1 Monday original bid | Equipment $39,500; installation $3,000; valid insurance.'),
];
const revision = { id: 'a_9dbc4d889c', subject: 'V-B Briar | Week 2 Tuesday signed revised bid (supersedes Week 1 Monday V-B bid)', verdict: 'Green', rationale: '- G1/M2 met: all-in $40,500.\n- G3 met: valid insurance.', evidence: '', gaps: '' };
const paste = 'V-B Briar | Week 2 Tuesday signed revised bid (supersedes Week 1 Monday V-B bid) | Equipment $37,500; installation $2,000; site prep $1,000; valid insurance certificate attached.';

describe('a revised item replaces the row it revises (L-330)', () => {
  it('the row the model names is replaced and kept as history', () => {
    const out = appendBatch(table, [{ ...revision, revises: 'a_b573e4131b' }], '2026-11-27T15:36:00Z', paste, '2');
    expect(out.find((i) => i.id === 'a_b573e4131b')).toMatchObject({ superseded_by: 'a_9dbc4d889c', verdict: 'Red' });
    expect(out.find((i) => i.id === 'a_9dbc4d889c')).toMatchObject({ revises: 'a_b573e4131b', batch: '2', verdict: 'Green' });
    expect(activeRows(out).map((i) => i.id)).toEqual(['a_5f0f36a00b', 'a_b8d532bdfb', 'a_9dbc4d889c']);
  });

  it('with no id named, the one row under the same reference ("V-B") is the one revised', () => {
    expect(referenceOf(revision.subject)).toBe('V-B');
    const out = appendBatch(table, [revision], '2026-11-27T15:36:00Z', paste, '2');
    expect(out.find((i) => i.id === 'a_b573e4131b')?.superseded_by).toBe('a_9dbc4d889c');
  });

  it('a made-up id, or a name already in the table, revises nothing', () => {
    const out = appendBatch(table, [{ ...revision, subject: 'Dune Works', revises: 'a_nothere' }], 'x', undefined, '2');
    expect(activeRows(out)).toHaveLength(4);
    expect(appendBatch(table, [{ ...revision, subject: table[2].subject! }], 'x')).toHaveLength(3);
  });

  it('counts, views and what later stages read leave the replaced row out, and say it apart', () => {
    const out = appendBatch(table, [{ ...revision, revises: 'a_b573e4131b' }], 'x', paste, '2');
    expect(verdictCounts(DEFAULT_SCALE, out).map((c) => [c.label, c.count])).toEqual([['Green', 2], ['Amber', 0], ['Red', 1]]);
    const text = assessmentText(out);
    expect(text).toMatch(/^3 assessed:/);
    expect(text).toContain('REPLACED BY A REVISION (history, not current):\n- V-B Briar | Week 1 Monday original bid — was Red; replaced by "V-B Briar | Week 2 Tuesday signed revised bid');
    expect(tableLines(out)).toEqual(['a_5f0f36a00b | V-A Alder | Week 1 Monday original bid | Red', 'a_b8d532bdfb | V-C Cedar | Week 1 Monday original bid | Green', 'a_9dbc4d889c | V-B Briar | Week 2 Tuesday signed revised bid (supersedes Week 1 Monday V-B bid) | Green']);
  });

  it("a row that compared itself with the others is judged again: Cedar's \"only bid\"", async () => {
    const calls: { chunk: string; already: string[]; rejudge?: boolean }[] = [];
    const call = vi.fn(async (chunk: string, already: string[], opts?: { rejudge?: boolean }) => {
      calls.push({ chunk, already, rejudge: opts?.rejudge });
      if (!opts?.rejudge) return { items: [revision], ungraded: 0, not_assessed: 0, next_from: '', finish_reason: 'stop' };
      return {
        items: [{ id: 'a_cedar2', subject: 'V-C Cedar | Week 1 Monday original bid', verdict: 'Green', rationale: '- Eligible; no longer the only eligible bid: revised V-B Briar is $2,000 lower.', evidence: '', gaps: '', revises: 'a_b8d532bdfb' }],
        ungraded: 0, not_assessed: 0, next_from: '', finish_reason: 'stop',
      };
    });
    const saved: StageItem[][] = [];
    const run = await assessPaste({ text: paste, existing: table, call, save: async (items) => { saved.push(items); }, now: () => '2026-11-27T15:36:00Z' });
    expect(calls[0].already).toContain('a_b573e4131b | V-B Briar | Week 1 Monday original bid | Red');
    expect(calls[1].rejudge).toBe(true);
    expect(calls[1].chunk).toContain('### V-C Cedar | Week 1 Monday original bid (a_b8d532bdfb)');
    expect(calls[1].chunk).not.toContain('a_9dbc4d889c');
    const cedar = run.items.find((i) => i.id === 'a_cedar2')!;
    expect(cedar).toMatchObject({ revises: 'a_b8d532bdfb', batch: '1', rejudged: 'true', profile: table[2].profile });
    expect(run.items.find((i) => i.id === 'a_b8d532bdfb')?.superseded_by).toBe('a_cedar2');
    expect(assessmentText(run.items)).not.toMatch(/it is the only bid that passes/);
    expect(saved).toHaveLength(2);
  });

  it('a paste that revises nothing judges nothing again', async () => {
    const call = vi.fn(async () => ({ items: [{ id: 'a_new', subject: 'V-D Dune | bid', verdict: 'Red', rationale: '- late', evidence: '', gaps: '' }], ungraded: 0, not_assessed: 0, next_from: '', finish_reason: 'stop' }));
    await assessPaste({ text: 'V-D Dune | bid', existing: table, call, save: async () => {} });
    expect(call).toHaveBeenCalledTimes(1);
    expect(comparativeRows(table, new Set()).map((i) => i.id)).toEqual(['a_5f0f36a00b', 'a_b8d532bdfb']);
  });
});
