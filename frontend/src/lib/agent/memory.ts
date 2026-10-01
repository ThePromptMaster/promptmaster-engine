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

import { CONFLICT_CATEGORY } from '@/lib/workflow/conflict-trail';
import type { Recommendation } from '@/lib/supabase/recommendations';
import type { WorkflowEvent, WorkflowTemplate } from '@/lib/workflow/types';
import type { AgentStep } from '@/types/agent';
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
}): string[] {
  const { template, events, recommendations, steps } = input;
  const label = (id: string) => template.stages.find((s) => s.id === id)?.label ?? id;
  const lines: string[] = [];

  // Routes the user chose not to take, and overrides, with their reasons.
  for (const e of events) {
    if (e.type === 'stage_skipped') lines.push(`Skipped ${label(e.stage_id)}${e.reason ? `: ${e.reason}` : ''}`);
    else if (e.type === 'stage_advanced' && e.reason) lines.push(`Moved past ${label(e.stage_id)} with something required still open, giving the reason: ${e.reason}`);
    else if (e.type === 'stage_reopened') lines.push(`Reopened ${label(e.stage_id)} to change it`);
  }

  // What the user answered when asked which of two things takes priority.
  const settled = recommendations.filter((r) => r.status === 'accepted' || r.status === 'dismissed');
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
    if (s.action_key !== USER_ANSWER_STEP || !s.output.trim()) return;
    const asked = [...steps.slice(0, i)].reverse().find((p) => p.decision_question || p.params?.conflict_question);
    const question = asked?.decision_question || (asked?.params?.conflict_question ? asked.output : '');
    lines.push(`Asked${question ? ` "${clip(question).slice(0, 120)}"` : ''}, the user answered: ${s.output}`);
  });

  // The most recent are the ones most likely to bear on what comes next.
  return lines.map(clip).slice(-MEMORY_MAX_LINES);
}
