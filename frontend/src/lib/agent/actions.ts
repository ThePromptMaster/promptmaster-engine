/**
 * The moves Go mode can make (PM-17, PM-19). Mirror of
 * backend/promptmaster/agent_actions.py — actions-drift.test.ts fails if the
 * two disagree on a key, a family or what counts as important.
 *
 * `performer` is the one way each key is carried out here; the planner picks a
 * key and cannot pick how it is performed.
 */

export type ActionFamily = 'research' | 'writing' | 'workflow';

export type Performer =
  | 'reason' // /api/agent/reason — label: discussed
  | 'compute' // write-code → /api/sandbox/run → (follow-up) interpret
  | 'literature' // looks named works up in OpenAlex, or searches it by topic when given a query
  | 'draft' // generate-stage-artifact
  | 'evaluate' // evaluate-stage-artifact
  | 'revise' // generate-stage-artifact with the current draft
  | 'continue' // continue-document: finish a draft that was cut off
  | 'outline' // generate an outline and commit it as a version (B2b)
  | 'sections' // enqueue section jobs and wait for them (B2b)
  | 'apply' // apply the latest check's findings as a new version (B2b)
  | 'triage' // decide the routine findings of a review table (B3)
  | 'propose' // propose a status for each undecided row of a check table; the user confirms (3 Oct)
  | 'advance' // a stage event
  | 'skip' // proposes skipping the stage; the user decides
  | 'loop' // proposes the next round of a looping workflow; the user starts it
  | 'block' // stage_blocked
  | 'ask' // stop for the user
  | 'complete'; // end the run, if the objective really is met

export interface AgentAction {
  key: string;
  family: ActionFamily;
  label: string;
  performer: Performer;
  /** Checkpoint stops for approval before performing it. */
  important: boolean;
}

export const AGENT_ACTIONS: readonly AgentAction[] = [
  { key: 'derive', family: 'research', label: 'Derive', performer: 'reason', important: false },
  { key: 'prove', family: 'research', label: 'Prove', performer: 'reason', important: false },
  { key: 'simplify', family: 'research', label: 'Simplify', performer: 'reason', important: false },
  { key: 'limiting_case', family: 'research', label: 'Test a limiting case', performer: 'reason', important: false },
  { key: 'try_contradiction', family: 'research', label: 'Try a contradiction', performer: 'reason', important: false },
  { key: 'run_computation', family: 'research', label: 'Run a computation', performer: 'compute', important: true },
  { key: 'falsify_hypothesis', family: 'research', label: 'Falsify a hypothesis', performer: 'reason', important: false },
  { key: 'compare_alternatives', family: 'research', label: 'Compare alternatives', performer: 'reason', important: false },
  { key: 'check_literature', family: 'research', label: 'Check literature', performer: 'literature', important: false },
  { key: 'update_assumptions', family: 'research', label: 'Update assumptions', performer: 'reason', important: true },
  { key: 'draft_stage', family: 'writing', label: 'Draft this stage', performer: 'draft', important: false },
  { key: 'evaluate_stage', family: 'writing', label: 'Check this stage', performer: 'evaluate', important: false },
  { key: 'revise_stage', family: 'writing', label: 'Revise this stage', performer: 'revise', important: true },
  // 4 Oct: a cut-off draft is finished before anything else is done to it.
  { key: 'continue_writing', family: 'writing', label: 'Continue writing', performer: 'continue', important: false },
  // B2b: the stage-specific work the buttons do, as moves (Sean, 28 Sep, item 2).
  { key: 'generate_outline', family: 'writing', label: 'Generate the outline', performer: 'outline', important: false },
  { key: 'draft_sections', family: 'writing', label: 'Draft the sections', performer: 'sections', important: true },
  { key: 'revise_sections', family: 'writing', label: 'Revise the sections', performer: 'sections', important: true },
  { key: 'apply_findings', family: 'writing', label: 'Apply the findings', performer: 'apply', important: true },
  { key: 'triage_findings', family: 'writing', label: 'Decide the routine findings', performer: 'triage', important: true },
  // 3 Oct: what the draft already concluded reaches the status, as a proposal the user confirms.
  { key: 'propose_statuses', family: 'writing', label: 'Propose a status for each row', performer: 'propose', important: true },
  // 1 Oct, item 11: the template guides the order; it does not imprison it.
  { key: 'propose_skip', family: 'workflow', label: 'Suggest skipping this stage', performer: 'skip', important: false },
  // 3 Oct call: work that goes on round after round; the user starts each one.
  { key: 'propose_next_round', family: 'workflow', label: 'Suggest the next round', performer: 'loop', important: false },
  { key: 'advance_stage', family: 'workflow', label: 'Move to the next stage', performer: 'advance', important: true },
  { key: 'mark_blocked', family: 'workflow', label: 'Mark this stage stuck', performer: 'block', important: false },
  { key: 'request_user_decision', family: 'workflow', label: 'Ask the user', performer: 'ask', important: false },
  { key: 'declare_objective_complete', family: 'workflow', label: 'Objective complete', performer: 'complete', important: true },
];

/** Not planner-selectable: the automatic second half of run_computation. */
export const INTERPRET_STEP = 'interpret_result';
/** Not planner-selectable: the user's reply to a question the run asked. */
export const USER_ANSWER_STEP = 'user_answer';
/** Not planner-selectable: waiting for section jobs already queued (after a reload, or ones the user started). */
export const AWAIT_SECTIONS_STEP = 'await_sections';

const BY_KEY = new Map(AGENT_ACTIONS.map((a) => [a.key, a]));

export function actionFor(key: string): AgentAction | undefined {
  return BY_KEY.get(key);
}

export function actionLabel(key: string): string {
  if (key === INTERPRET_STEP) return 'Interpret the result';
  if (key === USER_ANSWER_STEP) return 'Your answer';
  if (key === AWAIT_SECTIONS_STEP) return 'Wait for the sections being written';
  return BY_KEY.get(key)?.label ?? key.replace(/_/g, ' ');
}
