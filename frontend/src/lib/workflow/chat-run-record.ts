/**
 * The latest Go run as the side chat is told it, read from the database when the
 * user asks (5 Nov, a research project). The chat told the client nothing had been
 * run, then that Go was still running, and only then what had happened: it was given
 * one tab's memory of the run, which is empty until it has loaded and goes on saying
 * "running" after the tab that drove it has closed.
 */
import { getLatestAgentRun, listAgentSteps, listChainSteps } from '@/lib/supabase/agent';
import type { AgentRun, AgentStep } from '@/types/agent';
import type { ChatContext } from '@/types';

const STEPS_SENT = 12;
const OUTPUT_SENT = 400;

function minutesSince(run: AgentRun, steps: readonly AgentStep[], now: number): number | null {
  const times = [run.created_at, run.heartbeat_at, ...steps.flatMap((s) => [s.started_at, s.finished_at])]
    .map((iso) => Date.parse(iso ?? ''))
    .filter((t) => !Number.isNaN(t));
  return times.length ? Math.max(0, Math.round((now - Math.max(...times)) / 60_000)) : null;
}

/** The run and its steps as the prompt reads them. Pure. */
export function runRecordTrace(run: AgentRun, steps: readonly AgentStep[], objective: string, now: number): NonNullable<ChatContext['go_run']> {
  return {
    status: run.status,
    policy: run.policy,
    stop_reason: (run.stop_reason ?? '').slice(0, 2_000),
    steps: steps
      .filter((s) => s.status !== 'running')
      .slice(-STEPS_SENT)
      .map((s) => ({ action: s.action_key, status: s.status, execution_label: s.execution_label, block_kind: s.block_kind ?? null, output: (s.output ?? '').slice(0, OUTPUT_SENT) })),
    objective,
    ...(run.needs?.kind === 'answer_question' && run.needs.questions?.length ? { questions: run.needs.questions.slice(0, 8).map((q) => q.slice(0, 600)) } : {}),
    from_record: true,
    moves: steps.filter((s) => s.action_key !== 'user_answer').length,
    cost_usd: Number.isFinite(Number(run.cost_usd)) ? Number(run.cost_usd) : null,
    last_activity_minutes: minutesSince(run, steps, now),
  };
}

/** `context` with the run as recorded now. A failed read says so: it never reads as "no run". */
export async function withRunRecord(context: ChatContext, projectId: string, now = Date.now()): Promise<ChatContext> {
  try {
    const run = await getLatestAgentRun(projectId);
    if (!run) return { ...context, go_run: null, go_run_read: true };
    const [earlier, own] = await Promise.all([listChainSteps(run), listAgentSteps(run.id)]);
    return { ...context, go_run: runRecordTrace(run, [...earlier, ...own], context.go_run?.objective ?? '', now), go_run_read: true };
  } catch {
    return context.go_run ? context : { ...context, go_run: null, go_run_read: false };
  }
}
