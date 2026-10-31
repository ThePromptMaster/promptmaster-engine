import { beforeEach, describe, expect, it, vi } from 'vitest';

const generateStageArtifact = vi.fn();
const continueDocument = vi.fn();
const appendWorkflowEvent = vi.fn(async () => undefined);
vi.mock('@/lib/api/client', () => ({
  api: {
    generateStageArtifact: (...a: unknown[]) => generateStageArtifact(...a),
    continueDocument: (...a: unknown[]) => continueDocument(...a),
    dependentClaims: async () => ({ claims: [] }),
    checkNewClaims: async () => ({ claims: [] }),
  },
}));
vi.mock('@/lib/supabase/workflow', () => ({ appendWorkflowEvent: (...a: unknown[]) => appendWorkflowEvent(...(a as [])), listWorkflowEvents: vi.fn(async () => []) }));
vi.mock('@/lib/supabase/sources', () => ({ saveSources: vi.fn(async () => []) }));

import { performStep, type PerformContext } from './perform';
import { SINGLE_OUTPUT_V1 } from '@/lib/workflow/templates/single-output.v1';

/**
 * 31 Oct (Sean, a nonfiction book at v8; screenshots): "Repair a reopened
 * stage — Manuscript … cut off by the model's length limit", twice, then
 * "The last 2 steps failed". The whole book was one prose stage, rewritten
 * in one call.
 */
const stage = SINGLE_OUTPUT_V1.stages.find((s) => s.id === 'output')!;
const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i % 50}`).join(' ');
const chapter = (i: number) => `# Chapter ${i}\n\n${words(2_400)}\n\n${words(2_400)}\n`;
const BOOK = [1, 2, 3, 4, 5, 6].map(chapter).join('\n');

function ctx(head: { content: string; finish_reason?: string | null }): { c: PerformContext; saved: { content: string; finish_reason: string | null }[] } {
  const saved: { content: string; finish_reason: string | null }[] = [];
  const c = {
    project: { id: 'p', user_id: 'u', objective: 'A nonfiction book', facts: [], data_files: [], sources: [], web_access: 'off' },
    template: SINGLE_OUTPUT_V1,
    state: { current_stage_id: 'summary', stages: { output: { status: 'stale', stale: { reason: 'The work went back to Evidence base and sources after this stage used it.' } } } },
    stage,
    bundles: { output: { artifact: null, versions: [{ id: 'v8', version_number: 8, content: head.content, finish_reason: head.finish_reason ?? null, source_operation: 'agent_revise', created_at: '2026-10-29T00:00:00Z' }] } },
    context: { fields: {}, itemCounts: {}, itemsMissingStatus: {}, artifactNonEmpty: { output: true }, outlineApproved: false, sections: {}, findings: {}, manualChecks: {} },
    approvedOutline: [],
    run: { id: 'run1', policy: 'autonomous' },
    step: { action_key: 'recheck_stage', params: { stage_id: 'output' }, rationale: 'Reopened.' },
    digest: { recent_steps: [] },
    approvedByUser: false,
    deliverableDone: false,
    afterStageEvent: async () => undefined,
    loadEvents: async () => [],
    appendStageVersion: async (_id: string, _label: string, v: { content: string; finish_reason: string | null }) => {
      saved.push(v);
      return { id: `v${8 + saved.length}` };
    },
    signal: new AbortController().signal,
  } as unknown as PerformContext;
  return { c, saved };
}

beforeEach(() => {
  generateStageArtifact.mockReset();
  continueDocument.mockReset();
  // Each part comes back revised: its first word marked, so the join can be checked.
  generateStageArtifact.mockImplementation(async (req: { existing_content: string }) => ({
    content: req.existing_content.replace(/^# Chapter (\d+)/m, '# Chapter $1 (revised)'),
    items: [], finish_reason: 'stop', model_used: 'm',
  }));
});

describe('a book too long for one call is repaired a part at a time', () => {
  it('revises each part on its own call and saves the whole book, complete', async () => {
    const { c, saved } = ctx({ content: BOOK });
    const out = await performStep(c);
    expect(generateStageArtifact.mock.calls.length).toBeGreaterThan(1);
    for (const [req] of generateStageArtifact.mock.calls) {
      expect(req.instruction).toMatch(/REVISED ONE PART AT A TIME/);
      expect(req.existing_content.split(/\s+/).length).toBeLessThan(5_200);
    }
    expect(saved).toHaveLength(1);
    for (let i = 1; i <= 6; i += 1) expect(saved[0].content).toContain(`# Chapter ${i} (revised)`);
    expect(saved[0].finish_reason).toBe('stop');
    expect(out.status).toBe('succeeded');
    expect(out.output).toMatch(/revised in \d+ parts/);
  });

  it('only the first part may search the web', async () => {
    const { c } = ctx({ content: BOOK });
    (c.project as { web_access: string }).web_access = 'on';
    await performStep(c);
    const access = generateStageArtifact.mock.calls.map(([req]) => req.web_access);
    expect(access[0]).toBe('on');
    expect(access.slice(1).every((a) => a === 'off')).toBe(true);
  });

  it('a part still cut off is kept as it was, and the step says so, instead of failing the repair', async () => {
    generateStageArtifact.mockImplementation(async (req: { existing_content: string }) =>
      /# Chapter 3/.test(req.existing_content)
        ? { content: '# Chapter 3 (revised)\n\nhalf', items: [], finish_reason: 'length', model_used: 'm' }
        : { content: req.existing_content.replace(/^# Chapter (\d+)/m, '# Chapter $1 (revised)'), items: [], finish_reason: 'stop', model_used: 'm' }
    );
    const { c, saved } = ctx({ content: BOOK });
    const out = await performStep(c);
    expect(saved[0].content).toContain(chapter(3).trim().slice(0, 40));
    expect(saved[0].content).not.toContain('half');
    expect(out.output).toMatch(/could not be revised within the length limit/);
  });

  it('a short text is still repaired in one call', async () => {
    const { c } = ctx({ content: chapter(1) });
    await performStep(c);
    expect(generateStageArtifact).toHaveBeenCalledTimes(1);
    expect(generateStageArtifact.mock.calls[0][0].instruction).not.toMatch(/ONE PART AT A TIME/);
  });

  it('a head the model cut off is continued before it is repaired', async () => {
    continueDocument.mockResolvedValue({ iteration: { output: `${chapter(1)}\nThe end of it.`, evaluation: null }, suggestions: [], finish_reason: 'stop' });
    const { c } = ctx({ content: chapter(1), finish_reason: 'length' });
    await performStep(c);
    expect(continueDocument).toHaveBeenCalledTimes(1);
    expect(generateStageArtifact.mock.calls[0][0].existing_content).toContain('The end of it.');
  });
});
