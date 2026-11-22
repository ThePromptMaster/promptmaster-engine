import { describe, expect, it } from 'vitest';

import { lengthRows } from './deliverable-check';
import { projectRequirements } from '@/lib/workflow/context';
import { repairStuckNeed, repairTries, staleRepair } from './needs';
import type { AgentStep } from '@/types/agent';

/**
 * 21 Nov (Sean, launch readiness brief and internal email, run 827006bf, L-268).
 * Step 12 repaired Final for a reopening, steps 16 and 18 carried i19 into it. After
 * his answer Check was saved again and Final reopened, and Go stopped at once: the
 * two i19 repairs were counted as tries at the new reopening. The card then said
 * "3 repairs" and named the reopening as what was unresolved, not i19.
 */
const I19 = 'Accepted change i19 (Check) is not carried into Final brief and email: In the shortened email, write: "**Target:** Friday at 9 a.m., kept by the release manager while reviewing; this is not an authorization." (what the check had found in the text it read: "Email, Target line: "**Target:** Friday at 9 a.m." The brief says the target is "kept as the target while the release manager reviews"")';
const step = (id: string, params: Record<string, unknown>, output: string) =>
  ({ id, action_key: 'recheck_stage', status: 'succeeded', params: { stage_id: 'final_brief_and_email', ...params }, changes: { version_ids: [`v-${id}`] }, output }) as unknown as AgentStep;
const steps = [
  step('s12', { stale_since: '2026-11-21T09:20:28Z' }, 'Repaired Final brief and email (The work went back to Internal email after this stage used it.) — saved as a new version and marked complete again.'),
  step('s16', { carried: [I19] }, `Repaired Final brief and email (a review carried forward, as still unmet: "${I19}") — saved as a new version; it stays reopened.`),
  step('s18', { carried: [I19] }, `Repaired Final brief and email (a review carried forward, as still unmet: "${I19}") — saved as a new version and marked complete again.`),
];
const template = {
  stages: [
    { id: 'consistency_and_fact_check', label: 'Consistency and fact check', renderer: 'review', transitions: {}, exit_criteria: [] },
    { id: 'final_brief_and_email', label: 'Final brief and email', renderer: 'prose', transitions: {}, exit_criteria: [] },
  ],
} as unknown as Parameters<typeof staleRepair>[0];
const reopened = {
  current_stage_id: 'final_brief_and_email',
  stages: {
    consistency_and_fact_check: { status: 'complete' },
    final_brief_and_email: { status: 'stale', stale: { reason: 'Consistency and fact check was changed (now v8) after this stage used it.', since: '2026-11-21T09:45:11Z', was: 'complete' } },
  },
} as unknown as Parameters<typeof staleRepair>[1];

describe('repairs for something else are not tries at a new reopening (21 Nov, L-268)', () => {
  it('the two i19 repairs and the earlier reopening do not use up this one', () => {
    const tried = repairTries(steps, reopened, new Set(steps.map((s) => s.id)));
    expect(tried).toEqual([]);
    expect(staleRepair(template, reopened, tried)?.params).toEqual({ stage_id: 'final_brief_and_email', stale_since: '2026-11-21T09:45:11Z' });
  });

  it('a planner\'s unmarked repair in this run still counts, as before', () => {
    const unmarked = step('s23', {}, 'Repaired Final brief and email.');
    expect(repairTries([...steps, unmarked], reopened, new Set(['s23']))).toEqual(['final_brief_and_email']);
  });

  it('the carried repairs still count while the stage is not reopened', () => {
    const settled = { ...reopened, stages: { ...reopened.stages, final_brief_and_email: { status: 'complete' } } } as never;
    expect(repairTries(steps, settled, new Set())).toEqual(['final_brief_and_email', 'final_brief_and_email']);
  });
});

describe('the stuck card says what the repairs were for (21 Nov, L-268)', () => {
  it('two i19 repairs: two tries, i19 unresolved, the last i19 attempt', () => {
    const need = repairStuckNeed(reopened, 'final_brief_and_email', steps);
    expect(need.tries).toBe(2);
    expect(need.why.startsWith('Accepted change i19 (Check) is not carried into Final brief and email')).toBe(true);
    expect(need.why.length).toBeLessThanOrEqual(300);
    expect(need.last).toBe(steps[2].output);
  });

  it('repairs for a reopening still name the reopening', () => {
    const need = repairStuckNeed(reopened, 'final_brief_and_email', [steps[1], steps[2], step('s24', { stale_since: '2026-11-21T09:45:11Z' }, 'Repaired once.')]);
    expect(need.tries).toBe(1);
    expect(need.why).toBe('Consistency and fact check was changed (now v8) after this stage used it.');
  });
});

/**
 * 21 Nov hand pass (john@ c89649d5): "Recheck the word count after editing. The
 * current text is 68 words, so there is room under the 80-word limit", in a change
 * to one line of the email, was counted on the whole brief and email (594 words) and
 * sent the final back for a repair that could never meet it.
 */
describe('a part\'s limit named in a change is not counted on the whole deliverable (L-269)', () => {
  const i1 = {
    id: 'i1', stage_label: 'Check', finding: 'Internal email, line "**Decision owner:** the release manager."',
    suggested_change: 'Add the recorded basis to the line, e.g. "**Decision owner:** the release manager, who owns the launch decision (standing)." Recheck the word count after editing. The current text is 68 words, so there is room under the 80-word limit.',
  };
  const whole = Array.from({ length: 590 }, (_, i) => `word${i}`).join(' ');
  it('counted on the whole text when the deliverable has no part with that limit, as before', () => {
    expect(lengthRows([i1], whole).get('i1')?.met).toBe(false);
  });
  it('left to where the brief\'s own limit applies, when the change only restates it', () => {
    expect(lengthRows([i1], whole, false, [80]).has('i1')).toBe(false);
  });
  it('the brief\'s email limit is among the limits, though "email" is a document, not a part (production pass of #763)', () => {
    const project = {
      objective: 'Build a launch readiness brief and a short internal email (at most 80 words) for a fictional inventory system rollout.',
      constraints: 'The internal email is at most 80 words.',
      output_format: 'Launch readiness brief plus an internal email (at most 80 words).',
    };
    const limits = projectRequirements(project as never).flatMap((r) => (r.kind === 'words' && !r.per && r.max !== undefined ? [r.max] : []));
    expect(limits).toContain(80);
    expect(lengthRows([i1], whole, false, limits).has('i1')).toBe(false);
  });
});
