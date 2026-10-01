/**
 * Go mode's persistence (B1). Every step is written BEFORE its action runs
 * and closed after, so a refresh mid-step finds it and never replays it.
 * The database enforces what the client cannot be trusted with: authorization
 * for Checkpoint / Autonomous, one running run per project, final terminal
 * states, and honest execution labels.
 */
import { createClient } from './client';
import type {
  AgentRun,
  AgentRunStatus,
  AgentStep,
  AgentStepStatus,
  BlockKind,
  ExecutionLabel,
  ExecutionPolicy,
  SandboxRun,
} from '@/types/agent';

export async function createAgentRun(args: {
  projectId: string;
  userId: string;
  policy: ExecutionPolicy;
  authorizationId: string | null;
  budgetSteps: number;
  leaseHolder: string;
  /** The used-up run this one continues (B4). */
  continuesRunId?: string | null;
}): Promise<AgentRun> {
  const { data, error } = await createClient()
    .from('agent_runs')
    .insert({
      project_id: args.projectId,
      user_id: args.userId,
      policy: args.policy,
      authorization_id: args.authorizationId,
      budget_steps: args.budgetSteps,
      lease_holder: args.leaseHolder,
      heartbeat_at: new Date().toISOString(),
      continues_run_id: args.continuesRunId ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as AgentRun;
}

/** The project's live run, if any — what a refreshed tab resumes. */
export async function getLiveAgentRun(projectId: string): Promise<AgentRun | null> {
  const { data, error } = await createClient()
    .from('agent_runs')
    .select('*')
    .eq('project_id', projectId)
    .in('status', ['running', 'awaiting_decision', 'blocked'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as AgentRun | null) ?? null;
}

export async function updateAgentRun(
  runId: string,
  patch: Partial<Pick<AgentRun, 'status' | 'stop_reason' | 'steps_used' | 'cost_usd' | 'lease_holder' | 'heartbeat_at' | 'ended_at' | 'needs'>>
): Promise<void> {
  const { error } = await createClient().from('agent_runs').update(patch).eq('id', runId);
  if (error) throw error;
}

export async function endAgentRun(runId: string, status: AgentRunStatus, reason: string, needs: AgentRun['needs'] = null): Promise<void> {
  await updateAgentRun(runId, { status, stop_reason: reason, ended_at: new Date().toISOString(), needs });
}

export async function listAgentSteps(runId: string): Promise<AgentStep[]> {
  const { data, error } = await createClient().from('agent_steps').select('*').eq('run_id', runId).order('idx');
  if (error) throw error;
  return (data ?? []) as AgentStep[];
}

/**
 * The steps of the windows this run continues, oldest first — so a reload, or
 * a new day, does not lose what the earlier windows did. At most `maxRuns`
 * windows back: the planner is shown the recent ones, and the project's
 * decisions reach it another way (lib/agent/memory.ts).
 */
export async function listChainSteps(run: Pick<AgentRun, 'continues_run_id'>, maxRuns = 4): Promise<AgentStep[]> {
  const windows: AgentStep[][] = [];
  let parentId = run.continues_run_id;
  for (let i = 0; i < maxRuns && parentId; i += 1) {
    const { data, error } = await createClient().from('agent_runs').select('id, continues_run_id').eq('id', parentId).maybeSingle();
    if (error || !data) break;
    windows.unshift(await listAgentSteps(data.id as string));
    parentId = (data.continues_run_id as string | null) ?? null;
  }
  return windows.flat();
}

export async function startAgentStep(step: {
  runId: string;
  userId: string;
  projectId: string;
  idx: number;
  stageId: string;
  mode: string;
  actionKey: string;
  params: Record<string, unknown>;
  rationale: string;
  expectedOutcome: string;
  needsDecision: boolean;
  decisionQuestion: string | null;
}): Promise<AgentStep> {
  const { data, error } = await createClient()
    .from('agent_steps')
    .insert({
      run_id: step.runId,
      user_id: step.userId,
      project_id: step.projectId,
      idx: step.idx,
      stage_id: step.stageId,
      mode: step.mode,
      action_key: step.actionKey,
      params: step.params,
      rationale: step.rationale,
      expected_outcome: step.expectedOutcome,
      needs_decision: step.needsDecision,
      decision_question: step.decisionQuestion,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as AgentStep;
}

export async function finishAgentStep(
  stepId: string,
  outcome: {
    status: Exclude<AgentStepStatus, 'running'>;
    label: ExecutionLabel | null;
    output?: string;
    blockKind?: BlockKind | null;
    toolsUsed?: string[];
    changes?: AgentStep['changes'];
    params?: Record<string, unknown>;
    costUsd?: number | null;
  }
): Promise<AgentStep> {
  const { data, error } = await createClient()
    .from('agent_steps')
    .update({
      status: outcome.status,
      execution_label: outcome.label,
      output: outcome.output ?? '',
      block_kind: outcome.blockKind ?? null,
      tools_used: outcome.toolsUsed ?? [],
      changes: outcome.changes ?? {},
      ...(outcome.params ? { params: outcome.params } : {}),
      cost_usd: outcome.costUsd ?? null,
      finished_at: new Date().toISOString(),
    })
    .eq('id', stepId)
    .select('*')
    .single();
  if (error) throw error;
  return data as AgentStep;
}

export async function getSandboxRun(id: string): Promise<SandboxRun | null> {
  const { data, error } = await createClient().from('sandbox_runs').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as SandboxRun | null) ?? null;
}

/** Park a step for the user's approval, or pick it back up after it. */
export async function setAgentStepStatus(stepId: string, status: 'awaiting_decision' | 'running'): Promise<void> {
  const { error } = await createClient().from('agent_steps').update({ status }).eq('id', stepId);
  if (error) throw error;
}

/** The project's most recent run, finished or not — what reopening the page shows. */
export async function getLatestAgentRun(projectId: string): Promise<AgentRun | null> {
  const { data, error } = await createClient()
    .from('agent_runs')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as AgentRun | null) ?? null;
}
