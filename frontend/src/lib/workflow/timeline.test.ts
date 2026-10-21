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
