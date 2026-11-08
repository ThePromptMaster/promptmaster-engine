import { beforeEach, describe, expect, it, vi } from 'vitest';

const getArtifact = vi.fn();
const agentCheckDeliverable = vi.fn();
vi.mock('@/lib/api/client', () => ({ api: { agentCheckDeliverable: (...a: unknown[]) => agentCheckDeliverable(...a) } }));
vi.mock('@/lib/supabase/versions', () => ({ getArtifact: (...a: unknown[]) => getArtifact(...a), listVersions: vi.fn(async () => []), listArtifacts: vi.fn(async () => []) }));
vi.mock('@/lib/jobs/await', () => ({ awaitSectionJobs: vi.fn(async () => ({ outcome: 'done', written: ['s1'], complete: 1, total: 1, failed: [], pending: [] })) }));
vi.mock('@/lib/jobs/sections', async (original) => ({ ...(await original<typeof import('@/lib/jobs/sections')>()), enqueueRevisionJobs: vi.fn(async () => ['s1']) }));
vi.mock('@/lib/supabase/jobs', async (original) => ({ ...(await original<typeof import('@/lib/supabase/jobs')>()), listProjectJobs: vi.fn(async () => []) }));
vi.mock('@/lib/supabase/workflow', () => ({ appendWorkflowEvent: vi.fn(async () => undefined), listWorkflowEvents: vi.fn(async () => []) }));
vi.mock('@/lib/supabase/outline', () => ({ approvedOutlineVersionId: () => null, commitOutlineVersion: vi.fn() }));
vi.mock('@/lib/supabase/sources', () => ({ saveSources: vi.fn(async () => []) }));

import { performStep, type PerformContext } from './perform';
import { BOOK_V1 } from '@/lib/workflow/templates/book.v1';

const stage = BOOK_V1.stages.find((s) => s.id === 'drafting')!;
const artifact = (text: string) => ({ id: 'a1', stage_id: 'drafting', long_form: { state: 'complete', outline: [{ id: 's1', title: 'One', status: 'complete', content: text, finish_reason: 'stop' }] } });

function ctx(reason: string, facts: unknown[] = []) {
  return {
    project: { id: 'p', user_id: 'u', objective: 'A book', mode: 'architect', facts, data_files: [], sources: [], web_access: 'off' },
    template: BOOK_V1,
    state: { current_stage_id: 'continuity', stages: { drafting: { status: 'stale', stale: { reason } } } },
    stage: BOOK_V1.stages.find((s) => s.id === 'continuity')!,
    bundles: { drafting: { artifact: artifact('Before.'), versions: [] } },
    context: { fields: {}, itemCounts: {}, itemsMissingStatus: {}, artifactNonEmpty: {}, outlineApproved: true, sections: { drafting: { total: 1, complete: 1 } }, findings: {}, manualChecks: {} },
    approvedOutline: [], run: { id: 'r', policy: 'autonomous' },
    step: { action_key: 'recheck_stage', params: { stage_id: 'drafting' }, rationale: 'Reopened.' },
    digest: { recent_steps: [] }, approvedByUser: false, deliverableDone: false,
    afterStageEvent: async () => undefined, loadEvents: async () => [], refresh: async () => undefined,
    appendStageVersion: async () => ({ id: 'v' }),
    signal: new AbortController().signal,
  } as unknown as PerformContext;
}

beforeEach(() => {
  getArtifact.mockReset();
  agentCheckDeliverable.mockReset();
});

describe('a chapter repair has to show it landed (8 Nov, production)', () => {
  it('a named correction that is not in the text keeps the step from succeeding', async () => {
    getArtifact.mockResolvedValue(artifact('Article XIII, Section 4 provides that.'));
    agentCheckDeliverable.mockResolvedValue({ findings: [{ id: 'correction', verdict: 'not_carried', quote: 'Article XIII, Section 4', note: 'Still cites Section 4.' }], contradictions: [] });
    const out = await performStep(ctx('Correct the pension clause to Article XIII, Section 5.'));
    expect(out.status).toBe('failed');
    expect(out.output).toContain('The correction is not in the text yet');
    expect(out.output).toContain('Still cites Section 4.');
  });

  it('a correction that landed passes', async () => {
    getArtifact.mockResolvedValue(artifact('Article XIII, Section 5 provides that.'));
    agentCheckDeliverable.mockResolvedValue({ findings: [{ id: 'correction', verdict: 'carried', quote: 'Article XIII, Section 5', note: '' }], contradictions: [] });
    expect((await performStep(ctx('Correct the pension clause to Article XIII, Section 5.'))).status).toBe('succeeded');
  });

  it('a superseded value still in a chapter is found in code, with no model call', async () => {
    getArtifact.mockResolvedValue(artifact('Data migration: $8,000 this year.'));
    const fact = { id: 'n', project_id: 'p', user_id: 'u', statement: 'Data migration: $13,000 fixed.', subject: null, kind: 'fact', source_kind: 'user_edit', source_ref: {}, accepted_by: 'user', agent_run_id: null, supersedes: 'o', retired_at: null, retired_reason: null, created_at: 't' };
    const old = { ...fact, id: 'o', statement: 'Data migration: $8,000 fixed.', supersedes: null, retired_at: 't' };
    const out = await performStep(ctx('Package documents was changed (now v4) after this stage used it.', [old, fact]));
    expect(out.status).toBe('failed');
    expect(out.output).toContain('still states old values');
    expect(agentCheckDeliverable).not.toHaveBeenCalled();
  });

  it('a reason that names no correction asks nothing more of the model', async () => {
    getArtifact.mockResolvedValue(artifact('Whole text.'));
    expect((await performStep(ctx('Package documents was changed (now v4) after this stage used it.'))).status).toBe('succeeded');
    expect(agentCheckDeliverable).not.toHaveBeenCalled();
  });

  it('a check that could not run concludes nothing', async () => {
    getArtifact.mockResolvedValue(artifact('Text.'));
    agentCheckDeliverable.mockRejectedValue(new Error('down'));
    expect((await performStep(ctx('Correct the clause.'))).status).toBe('succeeded');
  });
});
