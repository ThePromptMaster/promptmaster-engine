import { beforeEach, describe, expect, it, vi } from 'vitest';

const getArtifact = vi.fn();
const listVersions = vi.fn();
const enqueueContinueJobs = vi.fn(async () => ['s1']);
const listWorkflowEvents = vi.fn();
vi.mock('@/lib/supabase/versions', () => ({
  getArtifact: (...a: unknown[]) => getArtifact(...a),
  listVersions: (...a: unknown[]) => listVersions(...a),
  listArtifacts: vi.fn(async () => []),
}));
vi.mock('@/lib/jobs/await', () => ({
  awaitSectionJobs: vi.fn(async () => ({ outcome: 'done', written: ['s1'], complete: 2, total: 2, failed: [], pending: [] })),
}));
vi.mock('@/lib/jobs/sections', async (original) => ({
  ...(await original<typeof import('@/lib/jobs/sections')>()),
  enqueueContinueJobs: (...a: unknown[]) => (enqueueContinueJobs as (...x: unknown[]) => Promise<string[]>)(...a),
}));
vi.mock('@/lib/supabase/jobs', async (original) => ({
  ...(await original<typeof import('@/lib/supabase/jobs')>()),
  listProjectJobs: vi.fn(async () => []),
}));
vi.mock('@/lib/supabase/workflow', () => ({ appendWorkflowEvent: vi.fn(async () => undefined), listWorkflowEvents: (...a: unknown[]) => listWorkflowEvents(...a) }));
vi.mock('@/lib/supabase/outline', () => ({ approvedOutlineVersionId: () => null, commitOutlineVersion: vi.fn() }));
vi.mock('@/lib/supabase/sources', () => ({ saveSources: vi.fn(async () => []) }));

import { performStep, type PerformContext } from './perform';
import { BOOK_V1 } from '@/lib/workflow/templates/book.v1';

/** 8 Nov (a book): eight chapters ended mid-sentence and every stage was marked done. */
const CUT = 'As the whole of the literature on this subject reports at very great length, Tet';
const artifact = (one: string) => ({
  id: 'a1', stage_id: 'drafting',
  long_form: { state: 'complete', outline: [
    { id: 's1', title: 'One', status: 'complete', content: one, finish_reason: 'stop', revision: 3 },
    { id: 's2', title: 'Two', status: 'complete', content: 'Two is whole.', finish_reason: 'stop', revision: 3 },
  ] },
});
const ever = [{ type: 'section_written', payload: { section_id: 's1', finish_reason: 'length' } }];

function ctx() {
  const saved: { args: unknown[] }[] = [];
  const c = {
    project: { id: 'p', user_id: 'u', objective: 'A book', mode: 'architect', facts: [], data_files: [], sources: [], web_access: 'off' },
    template: BOOK_V1,
    state: { current_stage_id: 'continuity', stages: { drafting: { status: 'complete' } } },
    stage: BOOK_V1.stages.find((s) => s.id === 'continuity')!,
    bundles: { drafting: { artifact: artifact(CUT), versions: [] } },
    context: { fields: {}, itemCounts: {}, itemsMissingStatus: {}, artifactNonEmpty: {}, outlineApproved: true, sections: { drafting: { total: 2, complete: 2 } }, findings: {}, manualChecks: {} },
    approvedOutline: [],
    run: { id: 'run1', policy: 'autonomous' },
    step: { action_key: 'recheck_stage', params: { stage_id: 'drafting', cut: true }, rationale: 'Cut.' },
    digest: { recent_steps: [] },
    approvedByUser: false, deliverableDone: false,
    afterStageEvent: async () => undefined, loadEvents: async () => [], refresh: async () => undefined,
    appendStageVersion: async (...args: unknown[]) => { saved.push({ args }); return { id: `v${saved.length}` }; },
    signal: new AbortController().signal,
  } as unknown as PerformContext;
  return { c, saved };
}

beforeEach(() => {
  getArtifact.mockReset();
  listVersions.mockReset();
  enqueueContinueJobs.mockClear();
  listVersions.mockResolvedValue([]);
  listWorkflowEvents.mockResolvedValue(ever);
});

describe('finishing cut chapters', () => {
  it('queues only the cut chapter, and saves the whole text without reopening what comes after', async () => {
    getArtifact.mockResolvedValueOnce(artifact(CUT)).mockResolvedValue(artifact('The chapter now ends properly.'));
    const { c, saved } = ctx();
    const out = await performStep(c);
    expect(out.status).toBe('succeeded');
    expect(out.output).toContain('now ends on a complete sentence');
    const call = (enqueueContinueJobs.mock.calls as unknown as [{ targets: unknown }][])[0][0];
    expect(call.targets).toEqual([{ id: 's1', index: 0, revision: 3 }]);
    expect(saved).toHaveLength(1);
    expect(saved[0].args[4]).toEqual({ keepLaterStages: true });
    expect(JSON.stringify(saved[0].args[2])).toContain('The chapter now ends properly.');
  });

  it('a chapter still cut after the attempt is a failed step that names it', async () => {
    getArtifact.mockResolvedValue(artifact(CUT));
    const { c, saved } = ctx();
    const out = await performStep(c);
    expect(out.status).toBe('failed');
    expect(out.output).toContain('Still cut off: One');
    expect(saved).toHaveLength(0);
  });

  it('nothing cut is not a success', async () => {
    getArtifact.mockResolvedValue(artifact('Whole.'));
    const { c } = ctx();
    const out = await performStep(c);
    expect(out.status).toBe('failed');
    expect(enqueueContinueJobs).not.toHaveBeenCalled();
  });
});
