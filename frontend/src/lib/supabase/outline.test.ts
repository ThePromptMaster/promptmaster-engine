import { describe, expect, it, vi } from 'vitest';

import { approveOutlineVersion, approvedOutlineVersionId, outlineApprovals } from './outline';
import { BOOK_V1, evaluateStage } from '@/lib/workflow';
import type { StageContext, WorkflowEvent } from '@/lib/workflow/types';
import type { ArtifactVersion } from '@/types/project';

function makeSupabase() {
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
  let table = '';
  const builder = {
    insert: vi.fn((row: Record<string, unknown>) => {
      inserts.push({ table, row });
      return Promise.resolve({ data: null, error: null });
    }),
  };
  return {
    client: {
      from: vi.fn((t: string) => {
        table = t;
        return builder;
      }),
    },
    inserts,
  };
}

const supa = vi.hoisted(() => ({ current: null as ReturnType<typeof makeSupabase> | null }));
vi.mock('./client', () => ({ createClient: () => supa.current!.client }));

const ev = (overrides: Partial<WorkflowEvent> = {}): WorkflowEvent => ({
  type: 'outline_approved',
  stage_id: 'outline_approval',
  actor: 'user',
  created_at: '2026-09-04T00:00:00Z',
  ...overrides,
});

function ctx(overrides: Partial<StageContext> = {}): StageContext {
  return {
    fields: {},
    itemCounts: {},
    itemsMissingStatus: {},
    artifactNonEmpty: {},
    outlineApproved: false,
    sectionsTotal: 0,
    sectionsComplete: 0,
    findingsTotal: 0,
    findingsTriaged: 0,
    manualChecks: {},
    ...overrides,
  };
}

describe('approving an outline', () => {
  it('writes a workflow event naming the version it approved', async () => {
    supa.current = makeSupabase();

    await approveOutlineVersion(
      'p1',
      'u1',
      'outline_approval',
      { id: 'v7', version_number: 3, artifact_id: 'a1' } as ArtifactVersion,
      5
    );

    const [insert] = supa.current.inserts;
    expect(insert.table).toBe('workflow_events');
    expect(insert.row).toMatchObject({
      project_id: 'p1',
      user_id: 'u1',
      seq: 5,
      type: 'outline_approved',
      stage_id: 'outline_approval',
      actor: 'user',
    });
    // Without the version id the log would record that an approval happened
    // but not what was approved, and drafting could not bind to anything.
    expect(insert.row.payload).toEqual({
      outline_version_id: 'v7',
      outline_version_number: 3,
      artifact_id: 'a1',
    });
  });
});

describe('reading approvals back', () => {
  it('binds drafting to the most recent approval', () => {
    const events = [
      ev({ payload: { outline_version_id: 'v1' } }),
      ev({ payload: { outline_version_id: 'v4' } }),
    ];
    expect(outlineApprovals(events)).toHaveLength(2);
    expect(approvedOutlineVersionId(events)).toBe('v4');
  });

  it('ignores an approval with no version id rather than pretending one is bound', () => {
    expect(approvedOutlineVersionId([ev(), ev({ payload: {} })])).toBeNull();
  });

  it('ignores every other event type', () => {
    expect(approvedOutlineVersionId([ev({ type: 'stage_completed' })])).toBeNull();
  });
});

describe('the outline_approval exit criterion', () => {
  const stage = BOOK_V1.stages.find((s) => s.id === 'outline_approval')!;

  it('is unsatisfied until an outline is approved, and satisfied after', () => {
    const before = evaluateStage(BOOK_V1, stage.id, ctx({ outlineApproved: false }));
    expect(before.canAdvance).toBe(false);
    expect(before.unmet.map((c) => c.id)).toEqual(['appr.approved']);

    // This is what the approval event makes true, via the workspace's context.
    const after = evaluateStage(BOOK_V1, stage.id, ctx({ outlineApproved: true }));
    expect(after.canAdvance).toBe(true);
    expect(after.unmet).toEqual([]);
  });

  it('is fed by the event log, not by whether drafting has started', () => {
    const approved = approvedOutlineVersionId([ev({ payload: { outline_version_id: 'v2' } })]);
    const evaluation = evaluateStage(BOOK_V1, stage.id, ctx({ outlineApproved: approved !== null }));
    expect(evaluation.criteria[0].satisfied).toBe(true);
  });
});
