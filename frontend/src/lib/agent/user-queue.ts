/**
 * Everything in the project that is waiting on the user, in one list (12 Nov).
 * Pure.
 *
 * A client: "If one answer clears three blockers, Go should ask once, apply
 * the answer everywhere it matters, and keep going." Go planned for the stage
 * it was on and asked one question at a time. A reserved approval two stages
 * on, a finding nobody had decided on an earlier table, a row carried forward
 * as unmet and a question it had set aside each came up as its own stop, one
 * after another, and a question set aside was listed and never asked.
 *
 * The list is read from what the project already holds — the outstanding
 * work, the approvals not given, the questions kept in the run — and each
 * item says what it holds up, counted from the workflow's own order. What an
 * answer does is not decided here: it is recorded as a fact, the items it
 * settles are closed by the user's own words (`settle.ts`), and what relied on
 * the opposite is reopened by the change check.
 */
import type { OutstandingItem } from '@/lib/workflow/engine';
import { isDone, type WorkflowState, type WorkflowTemplate } from '@/lib/workflow/types';
import type { StageArtifactBundle } from '@/lib/workflow/digest';

import type { KeptQuestion } from './account';

export type QueueKind = 'approval' | 'finding' | 'carried' | 'kept_question';

export interface QueueItem {
  /** `kind:stage:ref`: the same item is the same id from one read to the next. */
  id: string;
  kind: QueueKind;
  stageId: string;
  stageLabel: string;
  /** What is asked, as the project words it. */
  text: string;
  /** A carried row: the note recorded on it. */
  note?: string;
  /** One-click answers the project already holds for it. */
  choices?: string[];
  criterionId?: string;
  rowId?: string;
  stepId?: string;
  /** The stages that cannot finish until it is answered, in order, by name. */
  holdsUp: string[];
  /** Whether the project cannot be called finished with it open. */
  blocksFinish: boolean;
}

/** At most this many items on one stop: more than a screenful is a page of its own. */
export const QUEUE_MAX = 8;

const idOf = (kind: QueueKind, stageId: string, ref: string) => `${kind}:${stageId}:${ref}`;

/**
 * What waits on the user across every stage, most held up first.
 *
 * - a reserved approval on a stage that is written and not finished;
 * - a finding nobody has decided, where its table names the rows;
 * - a row carried forward as unmet that nothing has settled;
 * - a question Go set aside and has not had answered.
 *
 * With routine decisions handed to Go, an approval it may give itself is not
 * the user's wait and is left out.
 */
export function userQueue(input: {
  template: Pick<WorkflowTemplate, 'stages'>;
  state: Pick<WorkflowState, 'stages'>;
  outstanding: readonly OutstandingItem[];
  bundles: Record<string, StageArtifactBundle> | null | undefined;
  manualChecks: Record<string, boolean> | null | undefined;
  routine: 'ask' | 'handle' | null | undefined;
  kept?: readonly KeptQuestion[];
}): QueueItem[] {
  const { template, state } = input;
  const order = template.stages.map((s) => s.id);
  const label = (id: string) => {
    const s = template.stages.find((x) => x.id === id);
    return s ? s.short_label || s.label : id;
  };
  const open = (id: string) => {
    const status = state.stages[id]?.status;
    return !isDone(status) && status !== 'skipped';
  };
  // On a stage still open: that stage and every unfinished stage after it
  // wait behind the item. On a finished stage the work has moved on, and what
  // the item holds up is the finish.
  const heldBy = (stageId: string) => {
    const at = order.indexOf(stageId);
    return at < 0 || !open(stageId) ? [] : order.slice(at).filter(open).map(label);
  };
  const out: QueueItem[] = [];

  for (const stage of template.stages) {
    const written = Boolean((input.bundles?.[stage.id]?.versions.at(-1)?.content ?? '').trim());
    if (!written || !open(stage.id)) continue;
    for (const c of stage.exit_criteria) {
      if (c.check !== 'manual' || input.manualChecks?.[c.id]) continue;
      if (c.authority === 'delegable' && input.routine === 'handle') continue;
      out.push({
        id: idOf('approval', stage.id, c.id), kind: 'approval', stageId: stage.id, stageLabel: label(stage.id),
        text: c.label, criterionId: c.id, holdsUp: heldBy(stage.id), blocksFinish: Boolean(c.blocking),
      });
    }
  }

  for (const item of input.outstanding) {
    if (item.kind === 'open_findings' && item.rows?.length) {
      for (const row of item.rows) {
        out.push({
          id: idOf('finding', item.stageId, row.id), kind: 'finding', stageId: item.stageId, stageLabel: label(item.stageId),
          text: row.suggested_change ? `${row.text} — suggested change: ${row.suggested_change}` : row.text,
          rowId: row.id, holdsUp: heldBy(item.stageId), blocksFinish: !item.optional,
        });
      }
    }
    if (item.kind === 'carried_forward') {
      for (const row of item.items ?? []) {
        out.push({
          id: idOf('carried', item.stageId, row.id), kind: 'carried', stageId: item.stageId, stageLabel: label(item.stageId),
          text: row.text, ...(row.note ? { note: row.note } : {}), rowId: row.id, holdsUp: heldBy(item.stageId), blocksFinish: true,
        });
      }
    }
  }

  for (const k of input.kept ?? []) {
    out.push({
      id: idOf('kept_question', k.stageId, k.stepId), kind: 'kept_question', stageId: k.stageId, stageLabel: label(k.stageId),
      text: k.question, ...(k.choices.length ? { choices: k.choices } : {}), stepId: k.stepId, holdsUp: heldBy(k.stageId), blocksFinish: false,
    });
  }

  // Most held up first; what blocks the finish before what does not; then the workflow's own order.
  return out
    .map((item, i) => ({ item, i }))
    .sort((a, b) =>
      b.item.holdsUp.length - a.item.holdsUp.length ||
      Number(b.item.blocksFinish) - Number(a.item.blocksFinish) ||
      order.indexOf(a.item.stageId) - order.indexOf(b.item.stageId) ||
      a.i - b.i
    )
    .map(({ item }) => item)
    .slice(0, QUEUE_MAX);
}

/**
 * The kept questions an answer already covers, by the step that set each
 * aside: one answered from the list (its fact names the step), and one a later
 * answer settled (the settle step names it).
 */
export function answeredKept(
  facts: readonly { source_ref?: Record<string, unknown> | null; retired_at?: string | null }[] | null | undefined,
  steps: readonly { action_key: string; params?: Record<string, unknown> | null }[] = []
): Set<string> {
  const out = new Set<string>();
  for (const f of facts ?? []) {
    if (f.retired_at) continue;
    const ids = f.source_ref?.kept_step_ids;
    if (Array.isArray(ids)) for (const id of ids) if (typeof id === 'string') out.add(id);
  }
  for (const s of steps) {
    const ids = s.params?.kept_settled;
    if (Array.isArray(ids)) for (const id of ids) if (typeof id === 'string') out.add(id);
  }
  return out;
}

/** The queue without the item a stop is already asking about. */
export function restOfQueue(queue: readonly QueueItem[], asking: { criterionId?: string; rowIds?: readonly string[]; question?: string } | null): QueueItem[] {
  if (!asking) return [...queue];
  const rows = new Set(asking.rowIds ?? []);
  const asked = (asking.question ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  return queue.filter((q) => {
    if (asking.criterionId && q.criterionId === asking.criterionId) return false;
    if (q.rowId && rows.has(q.rowId)) return false;
    if (asked && q.kind === 'kept_question' && asked.includes(q.text.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 80))) return false;
    return true;
  });
}

/** What an item holds up, in a few words: "holds up Cap decision, Final pack and the finish". */
export function holdsUpLine(item: Pick<QueueItem, 'holdsUp' | 'blocksFinish'>): string {
  const stages = item.holdsUp.slice(0, 3);
  const more = item.holdsUp.length - stages.length;
  const parts = [...stages, ...(more > 0 ? [`${more} more stage${more === 1 ? '' : 's'}`] : []), ...(item.blocksFinish ? ['the finish'] : [])];
  if (!parts.length) return '';
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

/** The queue as lines the planner reads: asked already or about to be, so it does not ask them itself. */
export function queueLines(queue: readonly QueueItem[]): string[] {
  return queue.map((q) => `${q.stageLabel}: ${q.kind === 'approval' ? `approval "${q.text}"` : q.text.slice(0, 240)}`);
}
