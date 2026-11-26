import { describe, expect, it } from 'vitest';
import { draftFacts } from './facts';

describe('draftFacts: cut off means cut off (6 Oct, production)', () => {
  it('a draft that hit the length limit is cut off', () => {
    expect(draftFacts({ id: 'v1', finish_reason: 'length' }, null)).toEqual({ truncated: true, checked: false });
  });

  it('a check calling a finished draft "incomplete" does not make it cut off', () => {
    const evaluation = { version_id: 'v1', completeness_status: 'incomplete' };
    expect(draftFacts({ id: 'v1', finish_reason: 'stop' }, evaluation)).toEqual({ truncated: false, checked: true });
  });
});

describe('Go stops continuing a draft that stays cut off (31 Oct)', () => {
  it('after two continuations still cut off, the draft is left for the user', () => {
    const v = (op: string, finish: string | null) => ({ source_operation: op, finish_reason: finish });
    const head = { id: 'v3', finish_reason: 'length' };
    expect(draftFacts(head, null, [v('stage_draft', 'length'), v('continuation', 'length')]).truncated).toBe(true);
    expect(draftFacts(head, null, [v('stage_draft', 'length'), v('continuation', 'length'), v('continuation', 'length')]).truncated).toBe(false);
  });

  it('a revision that is itself cut off does not start the count again', () => {
    const v = (op: string, finish: string | null) => ({ source_operation: op, finish_reason: finish });
    const head = { id: 'v5', finish_reason: 'length' };
    expect(draftFacts(head, null, [v('continuation', 'length'), v('continuation', 'length'), v('agent_apply', 'length')]).truncated).toBe(false);
    expect(draftFacts(head, null, [v('continuation', 'length'), v('continuation', null), v('agent_apply', 'length')]).truncated).toBe(true);
  });
});

describe('Go and the page never judge one paste at once (26 Nov, L-284)', () => {
  const stage = {
    id: 'screen', label: 'Screen', short_label: 'Screen', group: 'evaluation', required: true, renderer: 'assess',
    entry_guidance: '', exit_criteria: [], expected_artifacts: [], recommended_modes: [], skip_reasons: [],
    transitions: { default_next: null, allow_skip: false, allow_return_to: [] },
    assess: { scale: 'traffic', item_noun: 'profiles' },
  } as unknown as import('@/lib/workflow/types').StageDefinition;
  const template = { key: 't', stages: [stage] } as unknown as import('@/lib/workflow/types').WorkflowTemplate;
  const project = { id: 'p-facts', user_id: 'u1', objective: '' } as unknown as import('@/types/project').Project;

  it('while the page judges a first paste, Go is offered the judging move, which waits, not a "paste a batch" stop', async () => {
    const { readStageFacts } = await import('./facts');
    const { assessKey, claimAssess, releaseAssess } = await import('@/lib/workflow/assess-lock');
    const idle = await readStageFacts({ project, template, stage, bundles: {}, events: [] });
    expect(idle.batch).toEqual({ offered: false, noun: 'profiles' });
    const key = assessKey('p-facts', 'screen');
    claimAssess(key, 'page', new AbortController());
    try {
      const busy = await readStageFacts({ project, template, stage, bundles: {}, events: [] });
      expect(busy.batch).toEqual({ offered: true, noun: 'profiles', left: true });
    } finally {
      releaseAssess(key, 'page');
    }
  });
});
