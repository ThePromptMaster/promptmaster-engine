/**
 * What Go is doing now, in plain words (4 Nov, Sean: "show progress in plain
 * language, such as 'Updating the budget' or 'Checking the revised draft'",
 * and "show the current activity next to the action the user just took").
 * Pure; the words are the interface's (`doing.*`).
 *
 * The panel said "Check this stage — in progress." and the pinned copy only
 * "Working…"; the counter of steps was the most visible thing on it.
 */
import { tr } from '@/lib/i18n/store';
import type { MessageKey } from '@/lib/i18n/messages/en';
import type { AgentStep } from '@/types/agent';

const DOING: Record<string, MessageKey> = {
  draft_stage: 'doing.draft',
  revise_stage: 'doing.revise',
  continue_writing: 'doing.continue',
  evaluate_stage: 'doing.check',
  apply_findings: 'doing.apply',
  triage_findings: 'doing.triage',
  propose_statuses: 'doing.propose',
  confirm_proposals: 'doing.confirm',
  recheck_stage: 'doing.recheck',
  commit_delegated: 'doing.commit',
  advance_stage: 'doing.advance',
  declare_objective_complete: 'doing.objective',
  generate_outline: 'doing.outline',
  draft_sections: 'doing.sections',
  revise_sections: 'doing.reviseSections',
  search_web: 'doing.search',
  check_literature: 'doing.literature',
  run_computation: 'doing.compute',
  extract_facts: 'doing.facts',
  return_to_stage: 'doing.return',
};

/** The stage a step works on: its target when it names one, else the stage it stands on. */
export function stepTarget(step: Pick<AgentStep, 'stage_id' | 'params'>): string {
  const t = (step.params as { stage_id?: unknown } | null)?.stage_id;
  return typeof t === 'string' && t ? t : step.stage_id;
}

/**
 * One line for the step under way, or for Go choosing its next move; null
 * when nothing is running. `progress` is the job's own count ("3 of 8 sections
 * written"), said after it.
 */
export function doingNow(
  step: Pick<AgentStep, 'action_key' | 'stage_id' | 'params' | 'status'> | null,
  stageName: (id: string) => string,
  opts: { thinking?: boolean; progress?: string | null } = {}
): string | null {
  if (opts.thinking) return tr('doing.choosing');
  if (!step || step.status !== 'running') return null;
  const key = DOING[step.action_key] ?? 'doing.other';
  const line = tr(key, { stage: stageName(stepTarget(step)) });
  return opts.progress ? `${line} (${opts.progress})` : line;
}
