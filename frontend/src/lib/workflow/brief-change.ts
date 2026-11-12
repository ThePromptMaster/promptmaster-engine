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
import { currentFacts, factLine } from './facts';
import type { ProjectFact } from '@/types/project';

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

/**
 * The stages a facts change was answered on in Go, when every fact it added is
 * an answer given to Go there (`source_ref.via === 'go answer'`); otherwise
 * null, and the change is judged everywhere as before.
 *
 * Go's run acts on an answer on the stage it asked from: it reads the answer as
 * its latest step and revises there. Judged as a brief change too, the answer
 * reopened that stage a second time — 4 Nov, production (Lakeside copy):
 * "Make it shorter to leave room under 650 words" was revised into v6, then the
 * change check marked Final proposal for a recheck for the same answer, and Go
 * revised it again into v7 ($0.17). The answer is still judged against every
 * finished stage, and only the stage it was given on is then left to Go
 * (`leftToGo`). Leaving that stage out of the judgment instead (#483) made the
 * judge name the stages before it: "make Section 7 a single sentence" reopened
 * Draft proposal and Check, whose repairs reopened Final proposal anyway
 * (16:36, $0.64).
 *
 * A decision made on an approval (its fact names the approval, 12 Nov) also
 * leaves the stages before it alone: they are what the decision was made from.
 * On production, choosing the $195,000 cap reopened the shortlists written
 * under the $180,000 cap, the brief comparing the two and the check of both —
 * each written to inform that decision — and Go set about revising all three.
 * What the decision changes is written by the stage it was made on and the
 * stages after it. `order` is the workflow's stages, first to last.
 */
export function answeredOnStages(before: string, facts: readonly ProjectFact[] | undefined, order: readonly string[] = []): Set<string> | null {
  const had = new Set(before.split('\n'));
  const added = currentFacts(facts).filter((f) => !had.has(factLine(f)));
  if (!added.length) return null;
  const stages = new Set<string>();
  for (const f of added) {
    const ref = f.source_ref ?? {};
    if (ref.via !== 'go answer' || typeof ref.stage_id !== 'string' || !ref.stage_id) return null;
    stages.add(ref.stage_id);
    const at = typeof ref.criterion_id === 'string' && ref.criterion_id ? order.indexOf(ref.stage_id) : -1;
    for (const earlier of order.slice(0, Math.max(0, at))) stages.add(earlier);
  }
  return stages;
}

/**
 * Whether every fact just added was recorded from a side-chat reply (5 Nov, a
 * rollout pack). Asking about something is not asking to change the work: a pasted
 * report, recorded with a click, reopened the approved pack, and one more click
 * called "Apply and continue" wrote it in. Such a change is judged and offered, and
 * nothing is reopened until the user says so. A fact typed into the facts panel, or
 * given with "Change it", reopens at once, as does one that replaces another.
 */
export function onlyFromTheChat(before: string, facts: readonly ProjectFact[] | undefined): boolean {
  const had = new Set(before.split('\n'));
  const added = currentFacts(facts).filter((f) => !had.has(factLine(f)));
  return added.length > 0 && added.every((f) => f.source_kind === 'chat' && f.source_ref?.via !== 'front door');
}

/** What a recorded fact may affect, offered and not yet decided. */
export interface ProposedChange {
  /** When the change was recorded: what deciding it refers to. */
  at: string;
  stageId: string;
  affected: { stage_id: string; reason: string }[];
}

/** The latest change offered and not yet decided. Null once it is taken, kept on record, or overtaken by a stage it names going stale. */
export function proposedChange(events: readonly WorkflowEvent[]): ProposedChange | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i];
    if (e.type !== 'brief_changed' || !Array.isArray(e.payload?.proposed) || !(e.payload.proposed as unknown[]).length) continue;
    const at = e.created_at ?? '';
    const decided = events.slice(i + 1).some((later) =>
      (later.type === 'brief_changed' && later.payload?.takes_up === at) ||
      (later.type === 'brief_change_dismissed' && later.payload?.change_at === at));
    return decided ? null : { at, stageId: e.stage_id, affected: e.payload.proposed as ProposedChange['affected'] };
  }
  return null;
}

/** The judged stages without those an answer was given on (`answeredOnStages`), and which those were. */
export function leftToGo<A extends { stage_id: string }>(affected: readonly A[], answeredOn: ReadonlySet<string> | null): { affected: A[]; left: string[] } {
  if (!answeredOn?.size) return { affected: [...affected], left: [] };
  return {
    affected: affected.filter((a) => !answeredOn.has(a.stage_id)),
    left: affected.filter((a) => answeredOn.has(a.stage_id)).map((a) => a.stage_id),
  };
}
