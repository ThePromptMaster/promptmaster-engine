import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 17 Nov (Sean's book, "Can a State Admit It Was Wrong?"): a chapter retitle the
 * chapters already carried was "repaired" by rewriting all 26 sections, and each
 * Resume queued the whole book again while the last pass was still running:
 * twelve passes, 237 rewrites, about $63, and the text did not change.
 */

const getArtifact = vi.fn();
const sectionsToRepair = vi.fn();
const enqueueRevisionJobs = vi.fn();
const awaitSectionJobs = vi.fn();
const listProjectJobs = vi.fn();
const appendWorkflowEvent = vi.fn();
vi.mock('@/lib/api/client', () => ({ api: { agentSectionsToRepair: (...a: unknown[]) => sectionsToRepair(...a), agentCheckDeliverable: vi.fn() } }));
vi.mock('@/lib/supabase/versions', () => ({ getArtifact: (...a: unknown[]) => getArtifact(...a), listVersions: vi.fn(async () => []), listArtifacts: vi.fn(async () => []) }));
vi.mock('@/lib/jobs/await', () => ({ awaitSectionJobs: (...a: unknown[]) => awaitSectionJobs(...a) }));
vi.mock('@/lib/jobs/sections', async (original) => ({ ...(await original<typeof import('@/lib/jobs/sections')>()), enqueueRevisionJobs: (...a: unknown[]) => enqueueRevisionJobs(...a) }));
vi.mock('@/lib/supabase/jobs', async (original) => ({ ...(await original<typeof import('@/lib/supabase/jobs')>()), listProjectJobs: (...a: unknown[]) => listProjectJobs(...a) }));
vi.mock('@/lib/supabase/workflow', () => ({ appendWorkflowEvent: (...a: unknown[]) => appendWorkflowEvent(...a), listWorkflowEvents: vi.fn(async () => []) }));
vi.mock('@/lib/supabase/outline', () => ({ approvedOutlineVersionId: () => null, commitOutlineVersion: vi.fn() }));
vi.mock('@/lib/supabase/sources', () => ({ saveSources: vi.fn(async () => []) }));

import { performStep, type PerformContext } from './perform';
import { repairWaitMs } from './repair-targets';
import { BOOK_V1 } from '@/lib/workflow/templates/book.v1';

const REASON = 'The drafted manuscript\'s Chapter 5 section carries the old title, which must change to "Beyond the Growth Narrative".';
const section = (id: string, title: string, content: string) => ({ id, title, status: 'complete', content, finish_reason: 'stop', revision: 3 });
const BOOK = [
  section('s4', "Chapter 4: Mississippi's Reading Gains", 'Mississippi rose.'),
  section('s5', 'Chapter 5: Beyond the Growth Narrative', 'This chapter, "Beyond the Growth Narrative", argues.'),
  section('s6', 'Chapter 6: Alabama', 'Three states.'),
];
const artifact = { id: 'a1', stage_id: 'drafting', long_form: { state: 'complete', outline: BOOK } };

function ctx(reason = REASON) {
  return {
    project: { id: 'p', user_id: 'u', objective: 'A book', mode: 'architect', facts: [], data_files: [], sources: [], web_access: 'off' },
    template: BOOK_V1,
    state: { current_stage_id: 'continuity', stages: { drafting: { status: 'stale', stale: { reason } } } },
    stage: BOOK_V1.stages.find((s) => s.id === 'continuity')!,
    bundles: { drafting: { artifact, versions: [] } },
    context: { fields: {}, itemCounts: {}, itemsMissingStatus: {}, artifactNonEmpty: {}, outlineApproved: true, sections: { drafting: { total: 3, complete: 3 } }, findings: {}, manualChecks: {} },
    approvedOutline: [], run: { id: 'r', policy: 'autonomous' },
    step: { action_key: 'recheck_stage', params: { stage_id: 'drafting' }, rationale: 'Reopened.' },
    digest: { recent_steps: [] }, approvedByUser: false, deliverableDone: false,
    afterStageEvent: async () => undefined, loadEvents: async () => [], refresh: async () => undefined,
    appendStageVersion: async () => ({ id: 'v' }),
    signal: new AbortController().signal,
  } as unknown as PerformContext;
}

beforeEach(() => {
  for (const f of [getArtifact, sectionsToRepair, enqueueRevisionJobs, awaitSectionJobs, listProjectJobs, appendWorkflowEvent]) f.mockReset();
  getArtifact.mockResolvedValue(artifact);
  listProjectJobs.mockResolvedValue([]);
  awaitSectionJobs.mockImplementation(async (a: { sectionIds: string[] }) => ({ outcome: 'done', written: a.sectionIds, complete: 3, total: 3, failed: [], pending: [] }));
  enqueueRevisionJobs.mockImplementation(async (a: { targets: { section: { id: string } }[] }) => a.targets.map((t) => t.section.id));
});

describe('a manuscript repair rewrites only what the change concerns (17 Nov)', () => {
  it('a change already in the chapters closes the stage with nothing rewritten', async () => {
    sectionsToRepair.mockResolvedValue({ checked: true, already_done: true, sections: [], note: 'The new title already heads Chapter 5.' });
    const out = await performStep(ctx());
    expect(enqueueRevisionJobs).not.toHaveBeenCalled();
    expect(out.status).toBe('succeeded');
    expect(out.output).toContain('Checked the chapters before rewriting any: The new title already heads Chapter 5. Nothing was rewritten.');
    expect(out.changes.checked_unchanged).toBe(true);
    const closed = appendWorkflowEvent.mock.calls.map((c) => c[2]).find((e) => e.type === 'stage_marked_complete');
    expect(closed.payload.checked_unchanged).toBe(true);
    expect(closed.reason).toMatch(/^Checked after a change:/);
  });

  it('the check sees each section\'s title and the lines that mention what changed', async () => {
    sectionsToRepair.mockResolvedValue({ checked: true, already_done: true, sections: [] });
    await performStep(ctx());
    const sent = sectionsToRepair.mock.calls[0][0];
    expect(sent.sections.map((s: { id: string }) => s.id)).toEqual(['s4', 's5', 's6']);
    expect(sent.sections[1].title).toBe('Chapter 5: Beyond the Growth Narrative');
    expect(sent.sections[1].excerpt).toContain('Beyond the Growth Narrative');
  });

  it('only the sections named are rewritten, and the rest are said to be left as they are', async () => {
    sectionsToRepair.mockResolvedValue({ checked: true, already_done: false, sections: [{ id: 's5' }] });
    const out = await performStep(ctx());
    expect(enqueueRevisionJobs.mock.calls[0][0].targets.map((t: { section: { id: string } }) => t.section.id)).toEqual(['s5']);
    expect(awaitSectionJobs.mock.calls[0][0].timeoutMs).toBe(repairWaitMs(1));
    expect(out.output).toContain('The other 2 sections were left as they are');
  });

  it('a pass still running is waited for, and nothing is queued again', async () => {
    listProjectJobs.mockResolvedValue([
      { id: 'j1', status: 'leased', kind: 'draft_section', payload: { artifact_id: 'a1', section_id: 's4', revision: 4 } },
      { id: 'j2', status: 'queued', kind: 'draft_section', payload: { artifact_id: 'a1', section_id: 's6', revision: 4 } },
    ]);
    const out = await performStep(ctx());
    expect(sectionsToRepair).not.toHaveBeenCalled();
    expect(enqueueRevisionJobs).not.toHaveBeenCalled();
    expect(awaitSectionJobs.mock.calls[0][0].sectionIds).toEqual(['s4', 's6']);
    expect(out.status).toBe('succeeded');
  });

  it('a wait that runs out says Resume waits for them, and the need is for the manuscript', async () => {
    sectionsToRepair.mockResolvedValue({ checked: true, already_done: false, sections: [{ id: 's5' }] });
    awaitSectionJobs.mockResolvedValue({ outcome: 'timeout', written: [], complete: 2, total: 3, failed: [], pending: ['s5'] });
    const out = await performStep(ctx());
    expect(out.status).toBe('interrupted');
    expect(out.output).toContain('Resume waits for them rather than starting them again');
    expect(out.needs).toMatchObject({ kind: 'wait_for_jobs', stageId: 'drafting' });
  });

  it('no answer and nothing old in the text rewrites nothing, rather than everything', async () => {
    sectionsToRepair.mockResolvedValue({ checked: false, already_done: false, sections: [] });
    const out = await performStep(ctx());
    expect(enqueueRevisionJobs).not.toHaveBeenCalled();
    expect(out.status).toBe('failed');
    expect(out.output).toContain('nothing was rewritten');
  });
});
