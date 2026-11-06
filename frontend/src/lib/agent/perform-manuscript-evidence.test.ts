import { beforeEach, describe, expect, it, vi } from 'vitest';

const getArtifact = vi.fn();
const listVersions = vi.fn();
vi.mock('@/lib/supabase/versions', () => ({
  getArtifact: (...a: unknown[]) => getArtifact(...a),
  listVersions: (...a: unknown[]) => listVersions(...a),
  listArtifacts: vi.fn(async () => []),
}));
vi.mock('@/lib/jobs/await', () => ({
  awaitSectionJobs: vi.fn(async () => ({ outcome: 'done', written: ['s1', 's2'], complete: 2, total: 2, failed: [], pending: [] })),
}));
vi.mock('@/lib/jobs/sections', async (original) => ({
  ...(await original<typeof import('@/lib/jobs/sections')>()),
  enqueueRevisionJobs: vi.fn(async () => ['s1', 's2']),
}));
vi.mock('@/lib/supabase/workflow', () => ({ appendWorkflowEvent: vi.fn(async () => undefined), listWorkflowEvents: vi.fn(async () => []) }));
vi.mock('@/lib/supabase/outline', () => ({ approvedOutlineVersionId: () => null, commitOutlineVersion: vi.fn() }));
vi.mock('@/lib/supabase/sources', () => ({ saveSources: vi.fn(async () => []) }));

import { performStep, type PerformContext } from './perform';
import { BOOK_V1 } from '@/lib/workflow/templates/book.v1';

/**
 * 5 Nov (a six-chapter book test): after every repair of the Manuscript, "Full
 * draft saved" held the text from before that repair. v3 and v4, v5 and v6, v7
 * and v8, v9 and v10 were the same text; the repaired chapters reached a
 * version only when the next repair took its "before" snapshot.
 */
const stage = BOOK_V1.stages.find((s) => s.id === 'drafting')!;
const artifact = (text: string) => ({
  id: 'a1', stage_id: 'drafting',
  long_form: { state: 'complete', outline: [
    { id: 's1', title: 'One', status: 'complete', content: `${text} one.` },
    { id: 's2', title: 'Two', status: 'complete', content: `${text} two.` },
  ] },
});

function ctx() {
  const saved: { content: string; source_operation: string }[] = [];
  const c = {
    project: { id: 'p', user_id: 'u', objective: 'A book', mode: 'architect', facts: [], data_files: [], sources: [], web_access: 'off' },
    template: BOOK_V1,
    state: { current_stage_id: 'continuity', stages: { drafting: { status: 'stale', stale: { reason: 'The review note is wrong.' } } } },
    stage: BOOK_V1.stages.find((s) => s.id === 'continuity')!,
    bundles: { drafting: { artifact: artifact('Before the repair'), versions: [] } },
    context: {
      fields: {}, itemCounts: {}, itemsMissingStatus: {}, artifactNonEmpty: {}, outlineApproved: true,
      sections: { drafting: { total: 2, complete: 2 } }, findings: {}, manualChecks: Object.fromEntries(stage.exit_criteria.filter((x) => x.check === 'manual').map((x) => [x.id, true])),
    },
    approvedOutline: [],
    run: { id: 'run1', policy: 'autonomous' },
    step: { action_key: 'recheck_stage', params: { stage_id: 'drafting' }, rationale: 'Reopened.' },
    digest: { recent_steps: [] },
    approvedByUser: false,
    deliverableDone: false,
    afterStageEvent: async () => undefined,
    loadEvents: async () => [],
    refresh: async () => undefined,
    appendStageVersion: async (_id: string, _label: string, v: { content: string; source_operation: string }) => {
      saved.push(v);
      return { id: `v${saved.length}` };
    },
    signal: new AbortController().signal,
  } as unknown as PerformContext;
  return { c, saved };
}

beforeEach(() => {
  getArtifact.mockReset();
  listVersions.mockReset();
  // The step reads the chapters once before the jobs run, and the jobs change them.
  getArtifact.mockResolvedValueOnce(artifact('Before the repair')).mockResolvedValue(artifact('After the repair'));
  listVersions.mockResolvedValue([]);
});

describe('a repaired manuscript is saved as the repair left it', () => {
  it('"Full draft saved" holds the repaired chapters, not the ones the step started with', async () => {
    const { c, saved } = ctx();
    const out = await performStep(c);
    expect(out.status).toBe('succeeded');
    expect(saved).toHaveLength(1);
    expect(saved[0].source_operation).toBe('long_form_complete');
    expect(saved[0].content).toContain('After the repair one.');
    expect(saved[0].content).not.toContain('Before the repair');
  });

  it('the snapshot already holding that text is cited, not saved again', async () => {
    listVersions.mockResolvedValue([{ id: 'v9', content: '## 1. One\n\nAfter the repair one.\n\n## 2. Two\n\nAfter the repair two.' }]);
    const { c, saved } = ctx();
    await performStep(c);
    expect(saved).toHaveLength(0);
  });
});
