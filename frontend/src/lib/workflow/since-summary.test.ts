// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { anythingSince, changesSince } from './since-summary';
import type { WorkflowEvent } from './types';

const at = (m: number) => `2026-11-26T12:${String(m).padStart(2, '0')}:00Z`;
const OLD = 'Northwind delivers the two cooling units on March 3, 2027.';
const NEW = 'Northwind delivers the two cooling units on March 17, 2027.';

describe('everything since the last visit (26 Nov, L-290: "pick up where they left off")', () => {
  const events = [
    { type: 'stage_version_saved', stage_id: 'timeline', actor: 'system', created_at: at(1), payload: { version_number: 1, affected: [] } },
    { type: 'brief_changed', stage_id: 'plan', actor: 'user', created_at: at(10), payload: { field: 'facts', changed_facts: [OLD], before: `- ${OLD}`, after: `- ${NEW}`, affected: [{ stage_id: 'timeline', reason: 'x' }, { stage_id: 'staffing', reason: 'y' }] } },
    { type: 'stage_version_saved', stage_id: 'timeline', actor: 'system', created_at: at(12), payload: { version_number: 2, affected: ['budget', 'commitment'] } },
    { type: 'stage_marked_complete', stage_id: 'budget', actor: 'system', created_at: at(13), payload: { checked_unchanged: true } },
    { type: 'stage_version_saved', stage_id: 'commitment', actor: 'system', created_at: at(14), payload: { version_number: 4, affected: [] } },
    { type: 'version_shared', stage_id: 'commitment', actor: 'user', created_at: at(20), payload: { record_id: 'r', version_id: 'c4', version_number: 4, to: 'Bayview Grocers', on: '2026-11-26' } },
  ] as unknown as WorkflowEvent[];

  it('lists each change, each stage redone to its newest version and by whom, what was kept, and what was sent', () => {
    const s = changesSince(events, at(5));
    expect(s.changes).toHaveLength(1);
    expect(s.changes[0].detail.pairs).toEqual([{ from: OLD, to: NEW }]);
    expect(s.redone).toEqual([{ stageId: 'timeline', version: 2, by: 'go' }, { stageId: 'commitment', version: 4, by: 'go' }]);
    expect(s.kept).toEqual(['budget']);
    expect(s.sent).toEqual([{ stageId: 'commitment', version: 4, to: 'Bayview Grocers' }]);
    expect(s.touched.sort()).toEqual(['budget', 'commitment', 'staffing', 'timeline']);
    expect(anythingSince(s)).toBe(true);
  });

  it('nothing since the last visit says nothing', () => {
    expect(anythingSince(changesSince(events, at(30)))).toBe(false);
  });
});
