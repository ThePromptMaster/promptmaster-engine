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
  changedAt?: string,
  /**
   * Include drafts in progress. A draft in progress was written against the
   * old value too (8 Oct, production: Summary, not yet finished, kept "Use
   * $18" after the price became $15, and Go confirmed the row). Used where the
   * match is made in code — a changed fact's value found in the text — not for
   * the model's judgment of which finished work relied on a change.
   */
  drafts = false
): StageConclusion[] {
  return template.stages
    .filter((s: StageDefinition) => {
      const st = state.stages[s.id];
      if (drafts && st?.status === 'in_progress' && bundles[s.id]?.versions.at(-1)?.content?.trim()) return true;
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

export interface OpenChange {
  event: WorkflowEvent;
  stageIds: string[];
  /** Why each was reopened, where the event itself does not say (a stage completed again, a return). */
  reasons?: Record<string, string>;
  /** Stages awaiting a recheck for some other change: "Update affected work" repairs them too. */
  alsoWaiting?: string[];
}

/**
 * The latest change that reopened stages, while any of them is still waiting
 * for a recheck — and not kept as it was. Every way a stage is reopened has
 * one (Sean, 14 Oct: "the new go button for revisions doesn't show up
 * sometimes"): a stage completed again on another version, or a return to an
 * earlier stage, reopened work with no notice and no button.
 */
export function openBriefChange(events: readonly WorkflowEvent[], state: WorkflowState): OpenChange | null {
  const found = latestChange(events, state);
  if (!found) return null;
  const alsoWaiting = Object.entries(state.stages)
    .filter(([id, st]) => st.status === 'stale' && !found.stageIds.includes(id))
    .map(([id]) => id);
  return alsoWaiting.length ? { ...found, alsoWaiting } : found;
}

function latestChange(events: readonly WorkflowEvent[], state: WorkflowState): OpenChange | null {
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
    // A later change that reopened nothing new (its stages were already
    // waiting) must not hide the earlier one that did: on production a fact
    // changed then another taken out left no notice, and no "Update affected
    // work and resume" (8 Oct).
    if (stageIds.length) return { event: e, stageIds };
  }
  // Reopened some other way: by the event that made them stale, with its reason.
  const stale = Object.entries(state.stages).filter(([, st]) => st.status === 'stale' && st.stale);
  if (!stale.length) return null;
  const since = stale.map(([, st]) => st.stale!.since).sort().at(-1)!;
  const stageIds = stale.filter(([, st]) => st.stale!.since === since).map(([id]) => id);
  const event =
    [...events].reverse().find((e) => e.created_at === since) ??
    ({ type: 'stage_returned', stage_id: stageIds[0], actor: 'system', created_at: since } as WorkflowEvent);
  return { event, stageIds, reasons: Object.fromEntries(stageIds.map((id) => [id, state.stages[id]!.stale!.reason])) };
}

/** How long "Updated and checked" stays on the page after the last stage it reopened is done. */
const SETTLED_SHOWN_MS = 12 * 60 * 60 * 1000;

/**
 * The last step of "facts recorded → affected work awaiting update → updated
 * and checked" (Sean, 14 Oct, SUMMIT: "Could we make the sequence clearer?").
 * The latest change of the brief or facts that reopened stages, once every one
 * of them has been finished again after it. Null while any is still waiting,
 * or once it is old.
 */
export function settledChange(
  events: readonly WorkflowEvent[],
  state: WorkflowState,
  now: number
): { event: WorkflowEvent; stageIds: string[] } | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i];
    if (e.type !== 'brief_changed' || e.payload?.presentation_only) continue;
    const affected = Array.isArray(e.payload?.affected) ? (e.payload!.affected as { stage_id?: string }[]) : [];
    const stageIds = [...new Set(affected.map((a) => a.stage_id ?? '').filter((id) => state.stages[id]))];
    if (!stageIds.length) continue;
    if (now - Date.parse(e.created_at) > SETTLED_SHOWN_MS) return null;
    const settled = stageIds.every((id) => {
      const st = state.stages[id]!;
      return isDone(st.status) && !!st.completed_at && st.completed_at > e.created_at;
    });
    return settled ? { event: e, stageIds } : null;
  }
  return null;
}
