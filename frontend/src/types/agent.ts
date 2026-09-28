/**
 * Go mode's records (B1). Mirrors supabase/migrations/20260928000000_agent_runs.sql.
 */

/** PM-18: how autonomously the loop continues. */
export type ExecutionPolicy = 'guided' | 'checkpoint' | 'autonomous';

export type AgentRunStatus =
  | 'running'
  | 'awaiting_decision'
  | 'blocked'
  | 'completed'
  | 'budget_exhausted'
  | 'stopped'
  | 'failed';

export type AgentStepStatus =
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'blocked'
  | 'awaiting_decision'
  | 'cancelled'
  | 'interrupted';

/**
 * PM-12, Sean's list verbatim: what actually happened, never what was claimed.
 * The database refuses code_executed / simulation_run without a sandbox run.
 */
export type ExecutionLabel =
  | 'discussed'
  | 'designed'
  | 'code_written'
  | 'code_executed'
  | 'simulation_run'
  | 'result_interpreted'
  | 'blocked';

export type BlockKind = 'tool_missing' | 'data_missing' | 'needs_decision';

export interface AgentRun {
  id: string;
  user_id: string;
  project_id: string;
  policy: ExecutionPolicy;
  status: AgentRunStatus;
  stop_reason: string | null;
  authorization_id: string | null;
  budget_steps: number;
  budget_usd: number | null;
  steps_used: number;
  cost_usd: number;
  lease_holder: string | null;
  heartbeat_at: string | null;
  created_at: string;
  ended_at: string | null;
  /** What the run needs from the user before it can continue (B4): rendered as the "I need you to…" card. */
  needs: NeedsUser | null;
  /** The budget_exhausted run this one continues (B4): windows chain. */
  continues_run_id: string | null;
}

export interface AgentStep {
  id: string;
  run_id: string;
  user_id: string;
  project_id: string;
  idx: number;
  stage_id: string;
  mode: string;
  action_key: string;
  params: Record<string, unknown>;
  rationale: string;
  expected_outcome: string;
  needs_decision: boolean;
  decision_question: string | null;
  status: AgentStepStatus;
  execution_label: ExecutionLabel | null;
  block_kind: BlockKind | null;
  tools_used: string[];
  changes: { version_ids?: string[]; event_types?: string[]; sandbox_run_id?: string; sections_written?: string[]; jobs?: string[] };
  output: string;
  cost_usd: number | null;
  started_at: string;
  finished_at: string | null;
}

export interface SandboxRun {
  id: string;
  step_id: string;
  run_id: string;
  language: string;
  code: string;
  stdout: string;
  stderr: string;
  truncated: boolean;
  exit_code: number | null;
  timed_out: boolean;
  duration_ms: number | null;
  artifacts: { name: string; bytes: number; url?: string }[];
  status: 'ok' | 'error' | 'timeout' | 'unavailable';
  created_at: string;
}

// --- B2's endpoints (backend/routers/agent.py) ---------------------------------

import type { NeedsUser } from '@/lib/agent/needs';
import type { PMInput } from './index';
import type { AgentStateDigest } from '@/lib/agent/digest';

export interface AgentUsage {
  tokens_in: number;
  tokens_out: number;
}

export interface NextActionRequest {
  inputs: PMInput;
  state: AgentStateDigest;
  allowed_actions: string[];
  policy: ExecutionPolicy;
  model?: string;
}

export interface NextActionResponse {
  action_key: string;
  params: Record<string, unknown>;
  rationale: string;
  expected_outcome: string;
  needs_user_decision: boolean;
  decision_question: string | null;
  objective_complete: boolean;
  model_used: string;
}

export interface AgentTextResponse {
  text: string;
  model_used: string;
  usage: AgentUsage;
}

export interface WriteCodeResponse {
  code: string;
  language: 'python';
  model_used: string;
  usage: AgentUsage;
}

/** /api/sandbox/run (B3). */
export interface SandboxRunResponse {
  sandbox_run: SandboxRun & { cost_usd: number | null };
  classification: {
    stepStatus: 'succeeded' | 'failed' | 'blocked';
    executionLabel: ExecutionLabel;
    blockKind: BlockKind | null;
    summary: string;
  };
  detail: string | null;
}
