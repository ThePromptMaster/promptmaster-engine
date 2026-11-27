/**
 * The latest update to a project, as one card in the Go panel (L-321, 27 Nov).
 *
 * Sean, 27 Nov: "What did my change affect, and where did Go stop? … Show affected records and
 * tasks, with links to open them. Start with a clickable summary in the existing Go panel." And,
 * correcting his own mockup: "Showing Alex's next step as ready would overstate what happened. A
 * better message would be 'Alex's exception recorded. Draft check blocked. Confirm the current
 * handoff before acting.' If an unrelated check is blocked, the UI can show that separately."
 *
 * Read from what the page holds: the change's event, the change summary (`changeSummary`, so the
 * notice and this agree), Go's steps since, and the task list (`currentTasks`, so the panel and this
 * use the same words). Pure.
 */

import type { ProjectTask } from '@/lib/supabase/tasks';
import type { AgentStep } from '@/types/agent';
import type { ChangeSummary } from './change-summary';
import { changeDetail } from './timeline';
import type { WorkflowEvent, WorkflowState } from './types';

export interface LatestUpdate {
  at: string;
  /** What changed, in the new words: at most three, and how many more. */
  what: string[];
  more: number;
  /** Each record the change touched, and where it stands now. */
  records: { stageId: string; state: 'redone' | 'kept' | 'being_redone' | 'waiting' | 'to_check'; version?: number | null }[];
  /** The task list since the change: closed as done, retired, added; and on hold now. */
  tasks: { done: number; retired: number; added: number; onHold: number };
  /** Go's checks or repairs that failed since the change and have not been done since: unsafe to act on. */
  blocked: { stageId: string; reason: string; fromThisChange: boolean }[];
}

/** Go's moves that check or rewrite a stage: one that failed leaves it unconfirmed. */
const CHECKING = new Set(['recheck_stage', 'revise_stage', 'apply_findings', 'draft_stage', 'evaluate_stage', 'commit_delegated']);

/** The stage a step worked on: a repair names its target. */
const targetOf = (s: Pick<AgentStep, 'stage_id' | 'params'>) => (typeof s.params?.stage_id === 'string' && s.params.stage_id) || s.stage_id;

/** The first sentence or so of a step's output: why it stopped. */
function reasonOf(output: string): string {
  const t = output.replace(/\s+/g, ' ').trim();
  const cut = t.search(/(?<=[.!?])\s/);
  return (cut > 0 && cut < 260 ? t.slice(0, cut) : t.slice(0, 260)).trim();
}

export function latestUpdate(input: {
  events: readonly WorkflowEvent[];
  state: Pick<WorkflowState, 'stages'>;
  summary: ChangeSummary | null;
  steps: readonly AgentStep[];
  tasks: readonly ProjectTask[];
  /** Open tasks on hold now (`currentTasks(...).onHold.length`). */
  onHold: number;
}): LatestUpdate | null {
  const change = [...input.events].reverse().find((e) => e.type === 'brief_changed' && e.actor === 'user' && changeDetail(e));
  if (!change) return null;
  const at = change.created_at;
  const d = changeDetail(change)!;
  const fieldWords: Record<string, string> = { objective: 'The objective changed', constraints: 'The constraints changed', audience: 'The audience changed', output_format: 'The format changed', context: 'The project material changed', facts: 'The facts changed' };
  const ref = change.payload?.reference as { name?: unknown } | undefined;
  const field = typeof change.payload?.field === 'string' ? change.payload.field : '';
  const said = [...d.pairs.map((p) => p.to), ...d.added, ...d.removed.map((r) => `No longer: ${r}`)];
  // A change with no fact lines of its own (an edited constraint, a refreshed linked project) still says what changed.
  if (!said.length) said.push(typeof ref?.name === 'string' && ref.name ? `${ref.name} changed` : (fieldWords[field] ?? 'The brief changed'));
  const touched = new Set(d.reopened.map((r) => r.stageId));

  const records: LatestUpdate['records'] = [];
  for (const r of input.summary?.redoing ?? []) {
    touched.add(r.stageId);
    const state = r.state === 'updated' ? 'redone' : r.state === 'open' ? 'being_redone' : r.state;
    records.push({ stageId: r.stageId, state, ...(r.version !== undefined ? { version: r.version } : {}) });
  }
  for (const u of input.summary?.usable ?? []) {
    if (u.kept === 'checked' || u.kept === 'by_you' || touched.has(u.stageId)) records.push({ stageId: u.stageId, state: 'kept' });
  }

  // A check or repair that failed since the change, on a stage nothing has redone since.
  const since = input.steps.filter((s) => s.started_at >= at);
  const blocked: LatestUpdate['blocked'] = [];
  for (const s of since) {
    if (!CHECKING.has(s.action_key) || (s.status !== 'failed' && s.status !== 'blocked')) continue;
    const stageId = targetOf(s);
    const later = since.some((o) => o.started_at > s.started_at && targetOf(o) === stageId && o.status === 'succeeded' && CHECKING.has(o.action_key));
    if (later || blocked.some((b) => b.stageId === stageId)) continue;
    blocked.push({ stageId, reason: reasonOf(s.output), fromThisChange: touched.has(stageId) || input.state.stages[stageId]?.status === 'stale' });
  }

  const after = (t?: string | null) => Boolean(t) && t! >= at;
  const tasks = {
    done: input.tasks.filter((t) => t.status === 'done' && t.resolved_by === 'system' && after(t.resolved_at)).length,
    retired: input.tasks.filter((t) => t.status === 'dismissed' && t.resolved_by === 'system' && after(t.resolved_at)).length,
    added: input.tasks.filter((t) => t.origin === 'system' && after(t.created_at)).length,
    onHold: input.onHold,
  };
  return { at, what: said.slice(0, 3), more: Math.max(0, said.length - 3), records, tasks, blocked };
}
