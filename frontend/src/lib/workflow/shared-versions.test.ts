// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { lastSent, sentSuperseded, sharedPayload, sharedVersions, undoPayload } from './shared-versions';
import type { WorkflowEvent } from './types';

const at = (m: number) => `2026-11-26T10:${String(m).padStart(2, '0')}:00Z`;
const sent = (stage: string, recordId: string, versionId: string, n: number, to: string, extra: Record<string, unknown> = {}, m = 0): WorkflowEvent =>
  ({ type: 'version_shared', stage_id: stage, actor: 'user', created_at: at(m), payload: sharedPayload({ recordId, versionId, versionNumber: n, to, on: '2026-11-26', ...extra }) }) as WorkflowEvent;

describe('which version people already received (25 Nov, Sean; L-289)', () => {
  it('keeps each record, takes back an undone one, and knows the newest version sent', () => {
    const events = [
      sent('commitment', 'r1', 'c1', 1, 'Bayview Grocers', { how: 'email' }, 1),
      sent('commitment', 'r2', 'c1', 1, 'Dana Ruiz', {}, 2),
      { type: 'version_shared', stage_id: 'commitment', actor: 'user', created_at: at(3), payload: undoPayload({ recordId: 'r2', versionId: 'c1' }) } as WorkflowEvent,
      { type: 'stage_marked_complete', stage_id: 'commitment', actor: 'user', created_at: at(4) } as WorkflowEvent,
    ];
    const shared = sharedVersions(events);
    expect(shared.commitment.map((r) => [r.recordId, r.to, r.how ?? null])).toEqual([['r1', 'Bayview Grocers', 'email']]);
    expect(lastSent(shared.commitment)?.versionNumber).toBe(1);
  });

  it('says which stages\' readers have an older version, with what changed since', () => {
    const events = [sent('commitment', 'r1', 'c1', 1, 'Bayview Grocers'), sent('plan', 'r2', 'p2', 2, 'Operations team')];
    const versions = {
      commitment: [
        { id: 'c1', version_number: 1, change_summary: 'First draft.' },
        { id: 'c2', version_number: 2, change_summary: 'Switch date moved to March 30 after the delivery date changed.' },
      ],
      plan: [{ id: 'p1', version_number: 1, change_summary: null }, { id: 'p2', version_number: 2, change_summary: 'x' }],
    };
    const behind = sentSuperseded({ events, stageOrder: ['commitment', 'plan'], versions });
    expect(behind).toEqual([
      expect.objectContaining({ stageId: 'commitment', current: 2, changes: [{ version: 2, summary: 'Switch date moved to March 30 after the delivery date changed.' }] }),
    ]);
    expect(behind[0].sent.to).toBe('Bayview Grocers');
  });

  it('"keep the older version with them" on the current version means nothing is owed, until a newer one', () => {
    const keep = sent('commitment', 'r3', 'c2', 2, 'Bayview Grocers', { notSending: true, note: 'They keep v1.' }, 5);
    const events = [sent('commitment', 'r1', 'c1', 1, 'Bayview Grocers'), keep];
    const two = { commitment: [{ id: 'c1', version_number: 1, change_summary: '' }, { id: 'c2', version_number: 2, change_summary: 'moved' }] };
    expect(sentSuperseded({ events, stageOrder: ['commitment'], versions: two })).toEqual([]);
    expect(lastSent(sharedVersions(events).commitment)?.versionNumber).toBe(1);
    const three = { commitment: [...two.commitment, { id: 'c3', version_number: 3, change_summary: 'moved again' }] };
    expect(sentSuperseded({ events, stageOrder: ['commitment'], versions: three }).map((b) => b.current)).toEqual([3]);
  });

  it('the payload carries the version id the database asks for, and is clipped', () => {
    const p = sharedPayload({ recordId: 'r', versionId: 'v', versionNumber: 3, to: 'x'.repeat(300), on: '2026-11-26', how: '  email  ' });
    expect(p).toMatchObject({ record_id: 'r', version_id: 'v', version_number: 3, on: '2026-11-26', how: 'email' });
    expect((p.to as string).length).toBe(200);
    expect(undoPayload({ recordId: 'r', versionId: 'v' })).toEqual({ undoes: 'r', version_id: 'v' });
  });
});
