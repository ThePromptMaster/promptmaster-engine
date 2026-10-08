/**
 * What a change to the brief reopens (Sean, 5 Oct). Pure.
 *
 * "The user corrects punctuation or formatting without changing meaning.
 * PromptMaster should update the artifact without reopening unrelated
 * analysis." A wording-only edit is caught here, with no model call. Anything
 * else is judged by one call (POST /api/assess-change) against what each
 * finished stage concluded, and recorded as a `brief_changed` event that marks
 * only the stages it names for a recheck (projectState in engine.ts).
 */

import { isDone, type StageDefinition, type WorkflowEvent, type WorkflowState, type WorkflowTemplate } from './types';
import { summariseStageContent, type StageArtifactBundle } from './digest';

export const BRIEF_FIELDS = ['objective', 'audience', 'constraints', 'output_format', 'context'] as const;
export type BriefField = (typeof BRIEF_FIELDS)[number];
/**
 * What a change check watches: the brief's fields, and the accepted facts as
 * one list (F3, 7 Oct) — a fact added, changed or retired reopens what relied
 * on it exactly as an edit of the context does.
 */
export type WatchedField = BriefField | 'facts';

export const BRIEF_FIELD_LABEL: Record<WatchedField, string> = {
  objective: 'objective',
  audience: 'audience',
  constraints: 'constraints',
  output_format: 'output format',
  context: 'project context',
  facts: 'accepted facts',
};

/** The words, without case, punctuation, Markdown markup or spacing. */
export function meaningOf(text: string): string {
  return text
    .toLowerCase()
    .replace(/[*_#`>~[\](){}|]/g, ' ')
    .replace(/[.,;:!?'"“”‘’…–—-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
}

/** True when only presentation changed: punctuation, case, spacing or formatting. */
export function presentationOnly(before: string, after: string): boolean {
  return before !== after && meaningOf(before) === meaningOf(after);
}

export interface StageConclusion {
  stage_id: string;
  label: string;
  summary: string;
  figures: string[];
  computed: boolean;
}

/**
 * What each finished stage concluded: its stored summary and the figures it
 * recorded. Only stages finished before `changedAt`: one finished after the
 * edit was finished with the new text, and has nothing to recheck.
 */
export function finishedConclusions(
  template: WorkflowTemplate,
  state: WorkflowState,
  bundles: Record<string, StageArtifactBundle>,
  changedAt?: string
): StageConclusion[] {
  return template.stages
    .filter((s: StageDefinition) => {
      const st = state.stages[s.id];
      return isDone(st?.status) && (!changedAt || !st?.completed_at || st.completed_at <= changedAt);
    })
    .map((s) => {
      const bundle = bundles[s.id];
      const figures = bundle?.artifact?.key_figures?.figures ?? [];
      return {
        stage_id: s.id,
        label: s.label,
        summary: (bundle?.artifact?.summary?.trim() || summariseStageContent(s, bundle?.versions.at(-1)?.content)).slice(0, 2_000),
        figures: figures.slice(0, 60).map((f) => `${f.name}: ${f.value}`),
        computed: figures.some((f) => f.source === 'sandbox'),
      };
    })
    .slice(0, 40);
}

/** The latest brief change that reopened stages, while any of them is still waiting for a recheck — and not kept as it was. */
export function openBriefChange(
  events: readonly WorkflowEvent[],
  state: WorkflowState
): { event: WorkflowEvent; stageIds: string[] } | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i];
    // A saved revision of an earlier stage reopens what came after it the
    // same way (H1b); the stages it reopened are the ones stale since it.
    if (e.type === 'stage_version_saved') {
      const stageIds = Object.entries(state.stages)
        .filter(([, st]) => st.status === 'stale' && st.stale?.since === e.created_at)
        .map(([id]) => id);
      if (stageIds.length) return { event: e, stageIds };
      continue;
    }
    if (e.type !== 'brief_changed') continue;
    const affected = Array.isArray(e.payload?.affected) ? (e.payload!.affected as { stage_id?: string }[]) : [];
    const stageIds = affected
      .map((a) => a.stage_id ?? '')
      .filter((id) => state.stages[id]?.status === 'stale' && state.stages[id]?.stale?.since === e.created_at);
    return stageIds.length ? { event: e, stageIds } : null;
  }
  return null;
}
