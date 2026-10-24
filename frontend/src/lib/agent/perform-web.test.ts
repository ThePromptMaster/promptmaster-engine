import { beforeEach, describe, expect, it, vi } from 'vitest';

const agentWebSearch = vi.fn();
const saveSources = vi.fn();
vi.mock('@/lib/api/client', () => ({ api: { agentWebSearch: (...a: unknown[]) => agentWebSearch(...a) } }));
vi.mock('@/lib/supabase/sources', () => ({ saveSources: (...a: unknown[]) => saveSources(...a) }));

import { performStep, type PerformContext } from './perform';
import { RESEARCH_V1 } from '@/lib/workflow';

/**
 * Sean, 23 Oct (the Nancy test): Go's search was refused — "`purpose` is
 * longer than the 600-character limit" — and the next one, which saved five
 * sources, was recorded as "No change to the project".
 */
const stage = RESEARCH_V1.stages.find((s) => s.id === 'literature')!;

function ctx(rationale: string): PerformContext {
  return {
    project: { id: 'p', user_id: 'u', objective: 'Choose an AI tool for Nancy', web_access: 'on', facts: [], data_files: [], sources: [] },
    template: RESEARCH_V1,
    state: { current_stage_id: stage.id, stages: {} },
    stage,
    bundles: { [stage.id]: { artifact: null, versions: [] } },
    context: { fields: {}, itemCounts: {}, itemsMissingStatus: {}, artifactNonEmpty: {}, outlineApproved: false, sections: {}, findings: {}, manualChecks: {} },
    approvedOutline: [],
    run: { id: 'run1', policy: 'autonomous' },
    step: { action_key: 'search_web', params: { query: 'Claude Pro pricing' }, rationale },
    digest: { recent_steps: [] },
    approvedByUser: false,
    deliverableDone: false,
    afterStageEvent: async () => undefined,
    loadEvents: async () => [],
    signal: new AbortController().signal,
  } as unknown as PerformContext;
}

beforeEach(() => {
  agentWebSearch.mockReset();
  saveSources.mockReset();
  agentWebSearch.mockResolvedValue({ summary: 'Pro is $20.', sources: [{ url: 'https://claude.com/pricing', title: 'Plans', excerpt: '' }] });
  saveSources.mockResolvedValue([{ id: 's1' }]);
});

describe("Go's web search", () => {
  it('clips a long reason to the purpose the server accepts', async () => {
    await performStep(ctx('Why: '.repeat(300)));
    expect(agentWebSearch.mock.calls[0][0].purpose.length).toBe(600);
  });

  it('records the sources it saved as a change to the project', async () => {
    const out = await performStep(ctx('Needs the vendor pages.'));
    expect(out.status).toBe('succeeded');
    expect(out.changes).toEqual({ source_ids: ['s1'] });
  });

  it('a search whose sources were all saved already changes nothing', async () => {
    saveSources.mockResolvedValue([]);
    const out = await performStep(ctx('Again.'));
    expect(out.changes).toEqual({});
  });
});
