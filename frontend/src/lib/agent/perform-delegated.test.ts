import { beforeEach, describe, expect, it, vi } from 'vitest';

const generateStageArtifact = vi.fn();
const recordFacts = vi.fn(async () => []);
vi.mock('@/lib/api/client', () => ({
  api: {
    generateStageArtifact: (...a: unknown[]) => generateStageArtifact(...a),
    dependentClaims: async () => ({ claims: [] }),
    checkNewClaims: async () => ({ claims: [] }),
  },
}));
vi.mock('@/lib/supabase/workflow', () => ({ appendWorkflowEvent: vi.fn(async () => undefined), listWorkflowEvents: vi.fn(async () => []) }));
vi.mock('@/lib/supabase/sources', () => ({ saveSources: vi.fn(async () => []) }));
vi.mock('@/lib/supabase/facts', async (original) => ({
  ...(await original<typeof import('@/lib/supabase/facts')>()),
  recordFacts: (...a: unknown[]) => recordFacts(...(a as [])),
}));

import { performStep, type PerformContext } from './perform';
import { delegatedWhy } from '@/lib/workflow/answers';
import { SINGLE_OUTPUT_V1 } from '@/lib/workflow/templates/single-output.v1';

/** 5 Nov (a research project): "Unresolved. The researcher should state both." stayed in the document. */
const stage = SINGLE_OUTPUT_V1.stages.find((s) => s.id === 'output')!;
const QUESTION = 'Does the symbol mean the product of differences, or the discriminant?';
const HEAD = '# Thread 1\n\nThe argument.\n\n| Item | Standing |\n|---|---|\n| The symbol, product of differences or discriminant | Unresolved. The researcher should state both. |\n';

function ctx() {
  const saved: { content: string; change_summary: string; instruction: string }[] = [];
  const c = {
    project: { id: 'p', user_id: 'u', objective: 'A derivation', facts: [], data_files: [], sources: [], web_access: 'off' },
    template: SINGLE_OUTPUT_V1,
    state: { current_stage_id: 'output', stages: { output: { status: 'stale', stale: { reason: delegatedWhy(QUESTION), was: 'in_progress', since: '2026-11-05T00:58:53Z' } } } },
    stage,
    bundles: { output: { artifact: null, versions: [{ id: 'v3', version_number: 3, content: HEAD, source_operation: 'agent_apply', created_at: '2026-11-05T00:57:00Z' }] } },
    context: { fields: {}, itemCounts: {}, itemsMissingStatus: {}, artifactNonEmpty: { output: true }, outlineApproved: false, sections: {}, findings: {}, manualChecks: {} },
    approvedOutline: [],
    run: { id: 'run1', policy: 'autonomous' },
    step: { action_key: 'recheck_stage', params: { stage_id: 'output' }, rationale: 'Reopened.' },
    digest: { recent_steps: [] },
    approvedByUser: false,
    deliverableDone: false,
    afterStageEvent: async () => undefined,
    loadEvents: async () => [],
    appendStageVersion: async (_id: string, _label: string, v: { content: string; change_summary: string; instruction: string }) => {
      saved.push(v);
      return { id: 'v4' };
    },
    signal: new AbortController().signal,
  } as unknown as PerformContext;
  return { c, saved };
}

beforeEach(() => {
  generateStageArtifact.mockReset();
  recordFacts.mockClear();
  generateStageArtifact.mockResolvedValue({
    content: '# Thread 1\n\nThe argument. The symbol means the product of differences, of degree 20.\n',
    note_to_user: 'Chosen: the product of differences, of degree 20. Why: the lift argument needs it.',
    items: [], finish_reason: 'stop', model_used: 'm',
  });
});

describe('a question left to Go is decided by the repair', () => {
  it('tells the writer to decide it and leave nothing open', async () => {
    await performStep(ctx().c);
    const [req] = generateStageArtifact.mock.calls[0] as [{ instruction: string }];
    expect(req.instruction).toContain('DECIDE IT NOW');
    expect(req.instruction).toContain(QUESTION);
  });

  it('the row the question is about is not put back, and the choice is said to the user', async () => {
    const { c, saved } = ctx();
    const out = await performStep(c);
    expect(saved[0].content).not.toContain('Unresolved');
    expect(out.output).toContain('Kept out of the document, for you: Chosen: the product of differences');
  });

  it('records the choice as a fact, said apart from what the user said', async () => {
    await performStep(ctx().c);
    const [, [fact]] = recordFacts.mock.calls[0] as unknown as [unknown, { statement: string; origin: string; source_ref: Record<string, unknown> }[]];
    expect(fact.statement).toBe(`Chosen by Go when you left it to Go — asked "${QUESTION}": the product of differences, of degree 20.`);
    expect(fact.origin).toBe('model_assumed');
    expect(fact.source_ref).toMatchObject({ delegated: true, version_id: 'v4', run_id: 'run1' });
  });

  it('with no choice in the note, the fact points at the version rather than making one up', async () => {
    generateStageArtifact.mockResolvedValue({ content: '# Thread 1\n\nThe argument.\n', items: [], finish_reason: 'stop', model_used: 'm' });
    await performStep(ctx().c);
    const [, [fact]] = recordFacts.mock.calls[0] as unknown as [unknown, { statement: string }[]];
    expect(fact.statement).toMatch(/: see .*the version saved with this choice$/);
  });

  it('an ordinary repair records nothing', async () => {
    const { c } = ctx();
    (c.state.stages.output as { stale: { reason: string } }).stale.reason = 'The brief changed.';
    await performStep(c);
    expect(recordFacts).not.toHaveBeenCalled();
  });
});
