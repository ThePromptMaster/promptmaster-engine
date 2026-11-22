/**
 * What the project has already decided, for the planner. Pure.
 *
 * A Go run knew its own last few steps and nothing else: a new window, or a
 * new day, started as though nothing had been settled (1 Oct, item 20: "the
 * system should be able to keep going across sessions without losing
 * objective, decisions, accepted findings, rejected routes, evidence,
 * unresolved questions, and next action"). Everything here is read from
 * records that already exist — the event log, the decision trail, earlier
 * runs' steps — so there is no second store of "memory" to drift from them.
 */

import { CONFLICT_CATEGORY, isPendingChangeRow } from '@/lib/workflow/conflict-trail';
import type { Recommendation } from '@/lib/supabase/recommendations';
import type { WorkflowEvent, WorkflowTemplate } from '@/lib/workflow/types';
import type { AgentStep } from '@/types/agent';
import { isDelegatedAnswer } from '@/lib/workflow/answers';
import type { ProjectFact } from '@/types/project';

/** How `replacedReason` (`lib/workflow/approvals.ts`) begins. */
const REPLACED_PREFIX = 'Replaced by your decision on';
import { USER_ANSWER_STEP } from './actions';

export const MEMORY_MAX_LINES = 20;
const LINE_MAX = 240;

const clip = (text: string) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > LINE_MAX ? `${flat.slice(0, LINE_MAX - 1)}…` : flat;
};

export function projectMemory(input: {
  template: WorkflowTemplate;
  events: readonly WorkflowEvent[];
  recommendations: readonly Pick<Recommendation, 'status' | 'title' | 'category' | 'scope'>[];
  /** Steps of this run and the windows before it, oldest first. */
  steps: readonly AgentStep[];
  /**
   * The project's facts, retired ones too (L-275): an answer a later decision replaced is
   * not recalled as standing, and each decision made on an approval is.
   */
  facts?: readonly Pick<ProjectFact, 'source_ref' | 'retired_at' | 'retired_reason'>[];
}): string[] {
  const { template, events, recommendations, steps, facts = [] } = input;
  // Answers a decision on an approval replaced, by the step that recorded them (22 Nov, Sean:
  // the memory still said "the user answered: Approve Option B" after he pressed Option A).
  const replaced = new Set(
    facts
      .filter((f) => f.retired_at && (f.retired_reason ?? '').startsWith(REPLACED_PREFIX))
      .map((f) => (f.source_ref as { step_id?: unknown } | null | undefined)?.step_id)
      .filter((id): id is string => typeof id === 'string')
  );
  const label = (id: string) => template.stages.find((s) => s.id === id)?.label ?? id;
  const lines: string[] = [];

  // Routes the user chose not to take, and overrides, with their reasons.
  for (const e of events) {
    if (e.type === 'stage_skipped') lines.push(`Skipped ${label(e.stage_id)}${e.reason ? `: ${e.reason}` : ''}`);
    else if (e.type === 'stage_advanced' && e.reason) lines.push(`Moved past ${label(e.stage_id)} with something required still open, giving the reason: ${e.reason}`);
    else if (e.type === 'stage_reopened') lines.push(`Reopened ${label(e.stage_id)} to change it`);
  }

  // What the user answered when asked which of two things takes priority.
  // A held change's row is bookkeeping; the answer is the conflict row.
  const settled = recommendations.filter((r) => (r.status === 'accepted' || r.status === 'dismissed') && !isPendingChangeRow(r));
  for (const r of settled) {
    if (r.category?.startsWith(CONFLICT_CATEGORY)) lines.push(`Decided: ${r.title}`);
  }
  // Suggestions taken and turned down (not the run's own authorization).
  for (const r of settled.slice(-10)) {
    if (r.category?.startsWith(CONFLICT_CATEGORY)) continue;
    if ((r.scope as { kind?: string } | null)?.kind === 'agent_authorization') continue;
    lines.push(`${r.status === 'accepted' ? 'Accepted the suggestion' : 'Turned down the suggestion'}: ${r.title}`);
  }

  // What the user told Go when it asked, with the question it was answering.
  steps.forEach((s, i) => {
    if (s.action_key !== USER_ANSWER_STEP || !s.output.trim() || replaced.has(s.id)) return;
    const asked = [...steps.slice(0, i)].reverse().find((p) => p.decision_question || p.params?.conflict_question);
    const question = asked?.decision_question || (asked?.params?.conflict_question ? asked.output : '');
    // Left to Go, this says what that asks for, within the line's limit: clipped,
    // "…tell me what you chose" was lost, and it read as already decided (5 Nov).
    lines.push(isDelegatedAnswer(s.output)
      ? `Asked${question ? ` "${clip(question).slice(0, 120)}"` : ''}, the user left it to you: choose now and say so in your note; what only they can do, say.`
      : `Asked${question ? ` "${clip(question).slice(0, 120)}"` : ''}, the user answered: ${s.output}`);
  });

  // The decisions of record on the approvals, last: they are what stands now.
  for (const f of facts) {
    if (f.retired_at) continue;
    const ref = f.source_ref as { criterion_id?: unknown; choice?: unknown; question?: unknown } | null | undefined;
    if (typeof ref?.criterion_id !== 'string' || typeof ref.choice !== 'string') continue;
    lines.push(`Decided on "${clip(String(ref.question ?? ref.criterion_id)).slice(0, 120)}": ${ref.choice} (this is the decision of record; an earlier answer naming another option no longer stands)`);
  }

  // The most recent are the ones most likely to bear on what comes next.
  return lines.map(clip).slice(-MEMORY_MAX_LINES);
}
