import { beforeEach, describe, expect, it, vi } from 'vitest';

const agentCheckCriterion = vi.fn();
const appendWorkflowEvent = vi.fn();
vi.mock('@/lib/api/client', () => ({ api: { agentCheckCriterion: (...a: unknown[]) => agentCheckCriterion(...a) } }));
vi.mock('@/lib/supabase/workflow', () => ({
  appendWorkflowEvent: (...a: unknown[]) => appendWorkflowEvent(...a),
  listWorkflowEvents: async () => [],
}));

import { reconfirmApprovals } from './perform';
import type { StageDefinition } from '@/lib/workflow/types';

/**
 * L-117 (26 Oct): an approval given on a version a repair replaced was shown
 * as "approved v2, now v4" and never asked again. Under "Handle them for me"
 * Go now re-checks a routine one on the new version; a reserved one stays the
 * user's.
 */
const stage = {
  id: 'plan',
  label: 'Analysis plan',
  exit_criteria: [
    { id: 'plan.routine', label: 'The plan names its data sources', check: 'manual', blocking: true, authority: 'delegable' },
    { id: 'plan.mine', label: 'I approve this analysis plan for execution', check: 'manual', blocking: true },
  ],
} as unknown as StageDefinition;

const commitCriterion = vi.fn(async () => undefined);
function ctx(routine: 'handle' | 'ask', versions: Record<string, string> = { 'plan.routine': 'v1', 'plan.mine': 'v1' }) {
  return {
    project: {
      id: 'p', user_id: 'u', objective: 'x', facts: [], data_files: [], sources: [],
      routine_decisions: routine,
      manual_checks: { 'plan.routine': true, 'plan.mine': true },
      manual_check_versions: versions,
    },
    run: { id: 'run1', policy: 'autonomous' },
    signal: new AbortController().signal,
    commitCriterion,
  } as unknown as Parameters<typeof reconfirmApprovals>[0];
}

beforeEach(() => {
  agentCheckCriterion.mockReset();
  appendWorkflowEvent.mockReset();
  commitCriterion.mockClear();
});

describe('approvals given on a replaced version (L-117)', () => {
  it('under Handle, a routine approval is checked on the new version and committed on it', async () => {
    agentCheckCriterion.mockResolvedValue({ met: true, reason: 'It names the survey file.' });
    const lines = await reconfirmApprovals(ctx('handle'), stage, 'v2', 'text');
    expect(agentCheckCriterion).toHaveBeenCalledTimes(1);
    expect(appendWorkflowEvent.mock.calls[0][2]).toMatchObject({
      type: 'criterion_committed', actor: 'system', agent_run_id: 'run1',
      payload: { criterion_id: 'plan.routine', evidence_version_id: 'v2', reconfirmed: true },
    });
    expect(commitCriterion).toHaveBeenCalledWith('plan', 'plan.routine', 'v2');
    expect(lines[0]).toContain('"The plan names its data sources" re-confirmed on the new version');
    // The reserved one is said, never ticked again by Go.
    expect(lines[1]).toContain('Your approval "I approve this analysis plan for execution" was given on an earlier version of Analysis plan');
  });

  it('one that no longer holds is said and not committed', async () => {
    agentCheckCriterion.mockResolvedValue({ met: false, reason: 'The data sources section was removed.' });
    const lines = await reconfirmApprovals(ctx('handle'), stage, 'v2', 'text');
    expect(appendWorkflowEvent).not.toHaveBeenCalled();
    expect(commitCriterion).not.toHaveBeenCalled();
    expect(lines[0]).toContain('does not hold on this one');
  });

  it('under Ask me, every approval is left to the user', async () => {
    const lines = await reconfirmApprovals(ctx('ask'), stage, 'v2', 'text');
    expect(agentCheckCriterion).not.toHaveBeenCalled();
    expect(lines).toEqual([expect.stringContaining('Your approvals "The plan names its data sources", "I approve this analysis plan for execution" were given')]);
  });

  it('approvals already on the new version say nothing', async () => {
    expect(await reconfirmApprovals(ctx('handle', { 'plan.routine': 'v2', 'plan.mine': 'v2' }), stage, 'v2', 'text')).toEqual([]);
  });
});

describe('a routine approval the repaired stage lacks with no box ticked (2 Nov, prod)', () => {
  // Requirements: "This list matches the requirements I gave" was committed on
  // v3, its box was lost, and each recheck "stayed reopened until" it.
  const lost = () => {
    const c = ctx('handle');
    (c.project as { manual_checks: Record<string, boolean> }).manual_checks = { 'plan.mine': true };
    (c.project as { manual_check_versions: Record<string, string> }).manual_check_versions = { 'plan.mine': 'v2' };
    return c;
  };

  it('is checked on the new version and committed when it is the open one', async () => {
    agentCheckCriterion.mockResolvedValue({ met: true, reason: 'Rows match the requirements given.' });
    const committed: string[] = [];
    const lines = await reconfirmApprovals(lost(), stage, 'v2', 'text', ['plan.routine'], committed);
    expect(committed).toEqual(['plan.routine']);
    expect(commitCriterion).toHaveBeenCalledWith('plan', 'plan.routine', 'v2');
    expect(lines.join(' ')).toContain('re-confirmed on the new version');
  });

  it('is not touched unless named, and a reserved one is never committed this way', async () => {
    agentCheckCriterion.mockResolvedValue({ met: true, reason: 'ok' });
    const committed: string[] = [];
    expect(await reconfirmApprovals(lost(), stage, 'v2', 'text', [], committed)).toEqual([]);
    await reconfirmApprovals(lost(), stage, 'v2', 'text', ['plan.mine'], committed);
    expect(committed).toEqual([]);
    expect(commitCriterion).not.toHaveBeenCalled();
  });
});
