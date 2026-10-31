import { describe, expect, it, vi } from 'vitest';

vi.mock('./client', () => ({ createClient: () => ({}) }));
vi.mock('./facts', () => ({ listProjectFacts: vi.fn() }));
vi.mock('./workflow', () => ({ getLatestTemplate: vi.fn(), getTemplateById: vi.fn() }));

import { materialFromSnapshot } from './references';
import type { ProjectReference, ReferenceSnapshot } from '@/types/project';

/**
 * 31 Oct: "should it be more like a copy thing rather than combining them so
 * you have the original project too as well kind of like the versions". A
 * reference draws on the copy it took, not on the original as it is now.
 */
const snapshot: ReferenceSnapshot = { title: 'Pilot study', objective: 'Test it', deliverable: 'Report', text: 'Findings v3.', facts: ['n = 40'], updatedAt: '2026-10-30T00:00:00Z' };
const row = (include_facts: boolean): ProjectReference & { snapshot: ReferenceSnapshot } => ({
  id: 'r1', project_id: 'p', user_id: 'u', referenced_project_id: 'o', include_facts, position: 0, created_at: '', snapshot, snapshot_at: '2026-10-31T09:00:00Z',
});

describe('a reference is a copy', () => {
  it('brings what was taken, and says when', () => {
    expect(materialFromSnapshot(row(true))).toEqual({
      referenceId: 'r1', projectId: 'o', title: 'Pilot study', objective: 'Test it', deliverable: 'Report',
      text: 'Findings v3.', facts: ['n = 40'], deleted: false, updatedAt: '2026-10-30T00:00:00Z', snapshotAt: '2026-10-31T09:00:00Z',
    });
  });

  it('its facts follow the reference’s own switch, whatever was taken', () => {
    expect(materialFromSnapshot(row(false)).facts).toEqual([]);
  });
});
