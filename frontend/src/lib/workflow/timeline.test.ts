import { describe, expect, it } from 'vitest';

import { projectTimeline } from './timeline';
import type { WorkflowEvent } from './types';

const template = { stages: [{ id: 'brief', label: 'Brief' }, { id: 'draft', label: 'Draft' }] } as never;
const v = (id: string, n: number, at: string, summary: string | null = null, op = 'stage_generate') => ({
  id, version_number: n, source_operation: op, change_summary: summary, created_at: at,
});
const ev = (type: WorkflowEvent['type'], stage_id: string, created_at: string, reason?: string): WorkflowEvent =>
  ({ type, stage_id, actor: 'user', created_at, ...(reason ? { reason } : {}) }) as WorkflowEvent;

describe('projectTimeline — what happened, newest first (14 Oct call)', () => {
  const entries = projectTimeline(
    template,
    [ev('project_created', 'brief', '2026-10-14T09:00:00Z'), ev('stage_marked_complete', 'brief', '2026-10-14T09:10:00Z'),
      ev('job_enqueued', 'draft', '2026-10-14T09:11:00Z'), ev('stage_reopened', 'brief', '2026-10-14T10:00:00Z', 'Change the date')],
    {
      brief: { versions: [v('b1', 1, '2026-10-14T09:05:00Z')] },
      draft: { versions: [v('d1', 1, '2026-10-14T09:20:00Z'), v('d2', 2, '2026-10-14T09:40:00Z', 'Start moved to 10 a.m.')] },
    }
  );

  it('lists versions of every stage and the decisions, newest first, leaving out bookkeeping', () => {
    expect(entries.map((e) => `${e.stageLabel}: ${e.title}`)).toEqual([
      'Brief: Stage reopened to change it',
      expect.stringMatching(/^Draft: v2 · /),
      expect.stringMatching(/^Draft: v1 · /),
      'Brief: Stage marked complete',
      expect.stringMatching(/^Brief: v1 · /),
      'Brief: Project started',
    ]);
  });

  it('marks the current version of each stage and carries what changed', () => {
    const d2 = entries.find((e) => e.versionId === 'd2')!;
    expect(d2).toMatchObject({ current: true, detail: 'Start moved to 10 a.m.', versionNumber: 2 });
    expect(entries.find((e) => e.versionId === 'd1')!.current).toBe(false);
    expect(entries[0].detail).toBe('Change the date');
  });
});

describe('what a change did, readable on reopening (26 Nov, L-290)', () => {
  const OLD = 'Northwind Refrigeration delivers the two cooling units on March 3, 2027.';
  const NEW = 'Northwind Refrigeration delivers the two cooling units on March 17, 2027.';
  const change = {
    type: 'brief_changed', stage_id: 'brief', actor: 'user', created_at: '2026-11-26T12:00:00Z',
    payload: {
      field: 'facts', kind: 'fact', changed_facts: [OLD],
      before: `- ${OLD}\n- Requirement: Total cost within the approved $55,000.`,
      after: `- ${NEW}\n- Requirement: Total cost within the approved $55,000.\n- Bayview wants a call the week before.`,
      affected: [{ stage_id: 'draft', reason: `It states "${OLD}", which changed: "The units arrive on March 3."` }],
    },
  } as unknown as WorkflowEvent;

  it('pairs the replaced fact with its replacement, names what was added, and what it reopened in plain words', async () => {
    const { changeDetail } = await import('./timeline');
    const d = changeDetail(change)!;
    expect(d.pairs).toEqual([{ from: OLD, to: NEW }]);
    expect(d.added).toEqual(['Bayview wants a call the week before.']);
    expect(d.removed).toEqual([]);
    expect(d.reopened).toEqual([{ stageId: 'draft', reason: expect.stringContaining('which has changed') }]);
    expect(changeDetail({ ...change, payload: { ...change.payload, presentation_only: true } })).toBeNull();
  });

  it('the timeline carries it, and names records of who has a version, checks that kept a stage, and saves that reopened later ones', () => {
    const events = [
      change,
      { type: 'stage_marked_complete', stage_id: 'brief', actor: 'system', created_at: '2026-11-26T12:05:00Z', payload: { checked_unchanged: true } },
      { type: 'stage_version_saved', stage_id: 'brief', actor: 'user', created_at: '2026-11-26T12:06:00Z', payload: { version_number: 3, affected: ['draft'] } },
      { type: 'version_shared', stage_id: 'draft', actor: 'user', created_at: '2026-11-26T12:07:00Z', payload: { record_id: 'r1', version_id: 'd2', version_number: 2, to: 'Bayview Grocers', on: '2026-11-26', how: 'email' } },
      { type: 'version_shared', stage_id: 'draft', actor: 'user', created_at: '2026-11-26T12:08:00Z', payload: { undoes: 'r1', version_id: 'd2' } },
    ] as unknown as WorkflowEvent[];
    const entries = projectTimeline(template, events, {});
    const title = (t: string) => entries.find((e) => e.title === t);
    expect(title('The brief changed')?.change?.pairs).toHaveLength(1);
    expect(title('Checked after a change and kept')).toBeTruthy();
    expect(title('Your change reopened later stages')?.reopenedStages).toEqual(['draft']);
    expect(title('Recorded who has a version')?.detail).toBe('v2 to Bayview Grocers, 2026-11-26 (email)');
    expect(title('Took back a record of who has a version')).toBeTruthy();
  });
});
