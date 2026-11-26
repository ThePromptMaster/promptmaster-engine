/**
 * The latest Go run as the side chat is told it, read from the database when the
 * user asks (5 Nov, a research project). The chat told the client nothing had been
 * run, then that Go was still running, and only then what had happened: it was given
 * one tab's memory of the run, which is empty until it has loaded and goes on saying
 * "running" after the tab that drove it has closed.
 */
import { earlierWindowsCost, getLatestAgentRun, listAgentSteps, listChainSteps } from '@/lib/supabase/agent';
import type { Spent } from '@/lib/observability/spent';
import type { AgentRun, AgentStep } from '@/types/agent';
import type { ChatContext } from '@/types';
import { GO_STEPS_MAX, chatStep } from './chat-context';

/** A stage's name as the page shows it, from its id; undefined when not known. */
export type StageNamer = (stageId: string) => string | undefined;
const noNames: StageNamer = () => undefined;

function minutesSince(run: AgentRun, steps: readonly AgentStep[], now: number): number | null {
  const times = [run.created_at, run.heartbeat_at, ...steps.flatMap((s) => [s.started_at, s.finished_at])]
    .map((iso) => Date.parse(iso ?? ''))
    .filter((t) => !Number.isNaN(t));
  return times.length ? Math.max(0, Math.round((now - Math.max(...times)) / 60_000)) : null;
}

/**
 * The run and its steps as the prompt reads them. Pure. Each step is read as the live
 * trace reads it (`chatStep`): 1,200 characters, its stage, and the one running now
 * (26 Nov, Sean: "the side chat lags behind").
 */
export function runRecordTrace(run: AgentRun, steps: readonly AgentStep[], objective: string, now: number, stageName: StageNamer = noNames): NonNullable<ChatContext['go_run']> {
  return {
    status: run.status,
    policy: run.policy,
    stop_reason: (run.stop_reason ?? '').slice(0, 2_000),
    steps: steps.slice(-GO_STEPS_MAX).map((s) => chatStep(s, stageName, now)),
    objective,
    ...(run.needs?.kind === 'answer_question' && run.needs.questions?.length ? { questions: run.needs.questions.slice(0, 8).map((q) => q.slice(0, 600)) } : {}),
    from_record: true,
    moves: steps.filter((s) => s.action_key !== 'user_answer').length,
    cost_usd: Number.isFinite(Number(run.cost_usd)) ? Number(run.cost_usd) : null,
    last_activity_minutes: minutesSince(run, steps, now),
  };
}

/** `context` with the run as recorded now. A failed read says so: it never reads as "no run". */
export async function withRunRecord(context: ChatContext, projectId: string, now = Date.now(), stageName: StageNamer = noNames): Promise<ChatContext> {
  try {
    const run = await getLatestAgentRun(projectId);
    if (!run) return { ...context, go_run: null, go_run_read: true };
    const [earlier, own, before] = await Promise.all([listChainSteps(run), listAgentSteps(run.id), earlierWindowsCost(run)]);
    const trace = runRecordTrace(run, [...earlier, ...own], context.go_run?.objective ?? '', now, stageName);
    // What the tab driving Go says it is doing now; the record has only finished moves' outputs.
    const live = context.go_run && run.status === 'running'
      ? { ...(context.go_run.progress ? { progress: context.go_run.progress } : {}), ...(context.go_run.current_stage ? { current_stage: context.go_run.current_stage } : {}) }
      : {};
    // The moves cover every window, so the cost does too: on production the chat said "34 moves" beside one window's $1.01.
    return { ...context, go_run: { ...trace, ...live, cost_usd: trace.cost_usd == null ? trace.cost_usd : trace.cost_usd + before }, go_run_read: true };
  } catch {
    return context.go_run ? context : { ...context, go_run: null, go_run_read: false };
  }
}

/**
 * `context` with what the whole project has cost, as the piggy bank reads it (26 Nov, Sean:
 * "It reads the cost way less than what the piggy bank says": the chat was given only the
 * latest Go run's cost). `spent` is `projectSpent`'s result; null when it could not be read.
 */
export function withProjectCost(context: ChatContext, spent: Pick<Spent, 'cost' | 'unpriced' | 'calls'> | null): ChatContext {
  return { ...context, project_cost: spent ? { usd: spent.cost, calls: spent.calls, unpriced: spent.unpriced } : null };
}
