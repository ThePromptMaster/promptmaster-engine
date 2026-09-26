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
  | 'literature' // no retrieval tool yet → blocked / tool_missing
  | 'draft' // generate-stage-artifact
  | 'evaluate' // evaluate-stage-artifact
  | 'revise' // generate-stage-artifact with the current draft
  | 'advance' // a stage event
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
  { key: 'advance_stage', family: 'workflow', label: 'Move to the next stage', performer: 'advance', important: true },
  { key: 'mark_blocked', family: 'workflow', label: 'Mark this stage blocked', performer: 'block', important: false },
  { key: 'request_user_decision', family: 'workflow', label: 'Ask the user', performer: 'ask', important: false },
  { key: 'declare_objective_complete', family: 'workflow', label: 'Objective complete', performer: 'complete', important: true },
];

/** Not planner-selectable: the automatic second half of run_computation. */
export const INTERPRET_STEP = 'interpret_result';
/** Not planner-selectable: the user's reply to a question the run asked. */
export const USER_ANSWER_STEP = 'user_answer';

const BY_KEY = new Map(AGENT_ACTIONS.map((a) => [a.key, a]));

export function actionFor(key: string): AgentAction | undefined {
  return BY_KEY.get(key);
}

export function actionLabel(key: string): string {
  if (key === INTERPRET_STEP) return 'Interpret the result';
  if (key === USER_ANSWER_STEP) return 'Your answer';
  return BY_KEY.get(key)?.label ?? key.replace(/_/g, ' ');
}
