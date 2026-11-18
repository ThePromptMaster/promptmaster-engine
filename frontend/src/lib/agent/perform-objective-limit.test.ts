import { beforeEach, describe, expect, it, vi } from 'vitest';

const agentAssessObjective = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: {
    agentAssessObjective: (...a: unknown[]) => agentAssessObjective(...a),
    agentCheckDeliverable: async () => ({ findings: [], contradictions: [], read_chars: 100, total_chars: 100 }),
  },
}));
const appendWorkflowEvent = vi.fn(async () => undefined);
vi.mock('@/lib/supabase/workflow', () => ({ appendWorkflowEvent: (...a: unknown[]) => appendWorkflowEvent(...(a as [])), listWorkflowEvents: vi.fn(async () => []) }));
vi.mock('@/lib/supabase/sources', () => ({ saveSources: vi.fn(async () => []) }));

import { FIX_OBJECTIVE_REASON } from './objective-fixes';
import { performStep, type PerformContext } from './perform';
import { SINGLE_OUTPUT_V1 } from '@/lib/workflow/templates/single-output.v1';

const stage = SINGLE_OUTPUT_V1.stages.find((s) => s.id === 'output')!;

function ctx(events: { type: string; reason?: string; created_at: string }[]): PerformContext {
  return {
    project: { id: 'p', user_id: 'u', objective: 'A short report', facts: [], data_files: [], sources: [], web_access: 'off' },
    template: SINGLE_OUTPUT_V1,
    state: { current_stage_id: 'output', stages: { output: { status: 'in_progress' } } },
    stage,
    bundles: { output: { artifact: null, versions: [{ id: 'v3', version_number: 3, content: 'The report as it stands.', source_operation: 'agent_revise', created_at: '2026-11-05T23:00:00Z' }] } },
    context: { fields: {}, itemCounts: {}, itemsMissingStatus: {}, artifactNonEmpty: { output: true }, outlineApproved: false, sections: {}, findings: {}, manualChecks: {}, measured: {} },
    approvedOutline: [],
    run: { id: 'run1', policy: 'autonomous' },
    step: { action_key: 'declare_objective_complete', params: {}, rationale: 'Done.' },
    digest: { recent_steps: [] },
    approvedByUser: false,
    deliverableDone: true,
    afterStageEvent: async () => undefined,
    loadEvents: async () => events,
    signal: new AbortController().signal,
  } as unknown as PerformContext;
}

const fix = (minute: number) => ({ type: 'brief_changed', reason: FIX_OBJECTIVE_REASON, created_at: `2026-11-05T23:0${minute}:00Z` });

beforeEach(() => {
  agentAssessObjective.mockReset();
  appendWorkflowEvent.mockClear();
  agentAssessObjective.mockResolvedValue({
    outcome: 'not_met', reason: 'The note describes an older draft.', basis_quote: '', blockers: [], performed: [], proposed_next: [],
    criteria: [{ requirement: 'A note on this text', verdict: 'not_met', basis: 'It describes an older draft.' }],
    read_chars: 24, total_chars: 24, model_used: 'm',
  });
});

describe('the check that is still unmet after Go has tried twice', () => {
  it('after one repair it still offers to fix it', async () => {
    const out = await performStep(ctx([fix(1)]));
    expect(out.needs).toMatchObject({ kind: 'objective_check', finding: 'unmet' });
  });

  it('after two it does not', async () => {
    const out = await performStep(ctx([fix(1), fix(2)]));
    expect(out.needs).toMatchObject({ kind: 'objective_check', finding: 'repair_limit', tried: 2, items: [expect.stringContaining('A note on this text')] });
    expect(out.stop?.status).toBe('awaiting_decision');
  });

  it('records which text was read and how much of it, with the verdict', async () => {
    await performStep(ctx([]));
    const [, , event] = appendWorkflowEvent.mock.calls.find((c) => (c as unknown[])[2] && ((c as unknown[])[2] as { type: string }).type === 'objective_assessed') as unknown as [string, string, { payload: { basis: unknown } }];
    expect(event.payload.basis).toMatchObject({ stage_id: 'output', version_number: 3, read: { chars: 24, total: 24 } });
  });
});

describe('a limit on each chapter (6 Nov, a book test: "Roughly 600–800 words per chapter" came back not checked)', () => {
  const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
  const withChapters = (counts: number[]) => {
    const base = ctx([]);
    const content = counts.map((n, i) => `## ${i + 1}. Chapter\n\n${words(n)}`).join('\n\n');
    return {
      ...base,
      project: { ...base.project, constraints: 'Roughly 600–800 words per chapter.' },
      bundles: { output: { artifact: null, versions: [{ id: 'v3', version_number: 3, content, source_operation: 'agent_revise' }] } },
    } as unknown as PerformContext;
  };

  it('tells the check the count it could not make, and records it', async () => {
    await performStep(withChapters([690, 787]));
    const [request] = agentAssessObjective.mock.calls[0] as [{ measured: string[]; failed_checks: string[] }];
    expect(request.measured).toEqual(['Each chapter: roughly 600–800 words — 2 chapters, 690–787 words each']);
    expect(request.failed_checks).toEqual([]);
    const [, , event] = appendWorkflowEvent.mock.calls.find((c) => (c as unknown[])[2] && ((c as unknown[])[2] as { type: string }).type === 'objective_assessed') as unknown as [string, string, { payload: { basis: { measured: string[] } } }];
    expect(event.payload.basis.measured).toEqual(request.measured);
  });

  it('says which chapter is well off, as something still unmet', async () => {
    await performStep(withChapters([700, 300]));
    const [request] = agentAssessObjective.mock.calls[0] as [{ measured: string[]; failed_checks: string[] }];
    expect(request.measured).toEqual([]);
    expect(request.failed_checks).toEqual(['Each chapter: roughly 600–800 words — measured 2. Chapter: 300 words']);
  });
});

describe('a fixable problem on a workflow that keeps its stages (6 Nov, production)', () => {
  const fixed = () => {
    const base = ctx([]);
    return { ...base, template: { ...SINGLE_OUTPUT_V1, inquiry: true, fixed_stages: true } } as unknown as PerformContext;
  };
  const found = {
    outcome: 'not_met', reason: 'It contradicts itself.', basis_quote: '', performed: [], proposed_next: [],
    criteria: [{ requirement: 'Says one thing', verdict: 'not_met', basis: 'It says two.' }],
    next_task: { title: 'Fix the contradiction', kind: 'write', work: 'Drop one sentence.', needs: [] },
    read_chars: 24, total_chars: 24, model_used: 'm',
  };

  it('offers to fix it, rather than saying it cannot continue over what only other work needs', async () => {
    agentAssessObjective.mockResolvedValue({ ...found, blockers: [{ need: 'conversion data', kind: 'data_missing' }] });
    const out = await performStep(fixed());
    expect(out.stop?.status).toBe('awaiting_decision');
    expect(out.needs).toMatchObject({ kind: 'objective_check', finding: 'unmet' });
    expect(appendWorkflowEvent.mock.calls.some((c) => ((c as unknown[])[2] as { type?: string })?.type === 'stage_added')).toBe(false);
  });

  it('is still blocked when nothing can be done now', async () => {
    agentAssessObjective.mockResolvedValue({ ...found, next_task: undefined, blockers: [{ need: 'conversion data', kind: 'data_missing' }] });
    const out = await performStep(fixed());
    expect(out.stop?.status).toBe('blocked');
  });
});

describe('what the check finds unmet on a later stage (18 Nov, hand pass: a memo after a paper)', () => {
  const memo = { ...SINGLE_OUTPUT_V1.stages.find((s) => s.id === 'output')!, id: 'memo', label: 'One-page board decision memo', short_label: 'Board memo', exit_criteria: [], required: false };
  // Not required, so the earlier stage stays the deliverable the check reads, as the paper did.
  const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
  const memoCase = () => {
    const base = ctx([]);
    return {
      ...base,
      project: { ...base.project, routine_decisions: 'handle' },
      template: { ...SINGLE_OUTPUT_V1, inquiry: true, stages: [stage, memo] },
      state: { current_stage_id: 'memo', stages: { output: { status: 'done' }, memo: { status: 'in_progress' } } },
      stage: memo,
      bundles: {
        output: { artifact: null, versions: [{ id: 'v9', version_number: 9, content: words(400), source_operation: 'agent_revise', created_at: '2026-11-17T21:00:00Z' }] },
        memo: { artifact: null, versions: [{ id: 'm5', version_number: 5, content: words(30), source_operation: 'agent_revise', created_at: '2026-11-17T21:10:00Z' }] },
      },
      context: { ...base.context, artifactNonEmpty: { output: true, memo: true }, measured: { memo: [{ id: 'm1', label: 'Memo: at most 1 page (estimated)', satisfied: false, detail: 'about 1.1 pages (605 words; estimated at 550 words a page)' }] } },
    } as unknown as PerformContext;
  };
  const unmet = [
    'One-page board decision memo: Memo: at most 1 page (estimated) — measured about 1.1 pages (605 words; estimated at 550 words a page)',
    "A one-page decision memo for a board — The project's own check (S8) measured the memo at about 1.1 pages (605 words; estimated at 550 words a page), over the one-page limit",
  ];

  beforeEach(() => {
    agentAssessObjective.mockResolvedValue({
      outcome: 'not_met', reason: 'The memo is over one page.', basis_quote: '', blockers: [], performed: [], proposed_next: [], unmet,
      next_task: { title: 'Trim board memo to one page', kind: 'write', work: 'Revise the latest One-page board decision memo (v5) to 550 words or fewer.', needs: [] },
      read_chars: 24, total_chars: 24, model_used: 'm',
    });
  });

  it('records the items as the memo’s, so they are not carried into the paper', async () => {
    await performStep(memoCase());
    const [, , event] = appendWorkflowEvent.mock.calls.find((c) => ((c as unknown[])[2] as { type?: string })?.type === 'objective_assessed') as unknown as [string, string, { payload: { basis: { stage_id: string }; unmet_elsewhere: unknown } }];
    expect(event.payload.basis.stage_id).toBe('output');
    expect(event.payload.unmet_elsewhere).toEqual(unmet.map((item) => ({ item, stage_id: 'memo' })));
  });

  it('adds no stage to trim the memo, and puts the fix to the memo itself', async () => {
    const out = await performStep(memoCase());
    expect(appendWorkflowEvent.mock.calls.some((c) => ((c as unknown[])[2] as { type?: string })?.type === 'stage_added')).toBe(false);
    expect(out.needs).toMatchObject({ kind: 'objective_check', finding: 'unmet', stageId: 'memo' });
    expect(out.output).toContain('"Trim board memo to one page" is a change to One-page board decision memo, not new work');
  });
});
