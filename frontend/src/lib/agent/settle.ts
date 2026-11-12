/**
 * Which open rows to read against the user's own words, and how the answer
 * marks them (12 Nov). Pure: the call is `POST /api/agent/settles`, and the
 * rows are saved by whoever asked.
 *
 * Only the user's own words settle a row: the note they wrote on it, and facts
 * they stated or decided. A fact PromptMaster assumed or Go recorded under the
 * routine-decision policy is not theirs, and is not offered as a statement.
 */
import { currentFacts } from '@/lib/workflow/facts';
import { markSettled, type CarriedRow } from '@/lib/workflow/settled-rows';
import { parseItems, serializeItems } from '@/lib/workflow/stage-artifact';
import type { WorkflowTemplate } from '@/lib/workflow/types';
import type { ProjectFact } from '@/types/project';

export interface SettleItem { id: string; stage: string; text: string; note: string }
export interface SettleStatement { id: string; text: string }
export interface SettleVerdict { id: string; by: string; quote: string; why?: string }
export interface SettleMark { stageId: string; rowId: string; quote: string; source: 'note' | 'fact'; ref?: string }

const SEP = '::';
const MAX_ITEMS = 12;
const MAX_STATEMENTS = 80;

/**
 * The carried rows to ask about, each named by stage and row. One the user
 * kept open after being told it looked settled is theirs to close. A note is
 * sent only when the user wrote it: a reason Go or the policy recorded is not
 * the user's answer.
 */
export function settleItems(
  template: Pick<WorkflowTemplate, 'stages'>,
  carried: Record<string, CarriedRow[]> | null | undefined,
  only?: { stageId: string; rowId: string }
): SettleItem[] {
  const out: SettleItem[] = [];
  for (const stage of template.stages) {
    for (const row of carried?.[stage.id] ?? []) {
      if (row.keptOpen) continue;
      if (only && (only.stageId !== stage.id || only.rowId !== row.id)) continue;
      out.push({
        id: `${stage.id}${SEP}${row.id}`, stage: stage.short_label || stage.label,
        text: row.text.slice(0, 2_400), note: row.source === 'user' ? row.note.slice(0, 1_400) : '',
      });
    }
  }
  return out.slice(0, MAX_ITEMS);
}

/** What the user stated or decided, newest last, with the fact each statement stands for. */
export function userStatements(facts: readonly ProjectFact[] | null | undefined): { statements: SettleStatement[]; factOf: Map<string, string> } {
  const theirs = currentFacts(facts ?? undefined)
    .filter((f) => f.origin !== 'model_assumed' && f.origin !== 'policy' && f.accepted_by !== 'policy')
    .slice(-MAX_STATEMENTS);
  const factOf = new Map<string, string>();
  const statements = theirs.map((f, i) => {
    const id = `f${i + 1}`;
    factOf.set(id, f.id);
    return { id, text: f.statement.slice(0, 2_400) };
  });
  return { statements, factOf };
}

/** Nothing to read a row against: no note of the user's on any, and no statement of theirs. */
export const nothingSaid = (items: readonly SettleItem[], statements: readonly SettleStatement[]): boolean =>
  !statements.length && !items.some((i) => i.note.trim());

/** What was asked, as one string: the same rows and words are not asked about twice. */
export function settleKey(items: readonly SettleItem[], statements: readonly SettleStatement[]): string {
  return JSON.stringify([items.map((i) => [i.id, i.note]), statements.map((s) => s.text)]);
}

/** The verdicts as marks on rows. One that names nothing that was sent is dropped. */
export function settleMarks(verdicts: readonly SettleVerdict[] | null | undefined, items: readonly SettleItem[], factOf: ReadonlyMap<string, string>): SettleMark[] {
  const sent = new Set(items.map((i) => i.id));
  const out: SettleMark[] = [];
  for (const v of verdicts ?? []) {
    if (!sent.has(v.id) || !v.quote?.trim()) continue;
    const at = v.id.indexOf(SEP);
    const stageId = v.id.slice(0, at);
    const rowId = v.id.slice(at + SEP.length);
    if (v.by === 'note') out.push({ stageId, rowId, quote: v.quote, source: 'note' });
    else if (factOf.has(v.by)) out.push({ stageId, rowId, quote: v.quote, source: 'fact', ref: factOf.get(v.by) });
  }
  return out;
}

/** A table's content with its rows marked; null when nothing in it was marked. */
export function withMarks(content: string | null | undefined, stageId: string, marks: readonly SettleMark[]): string | null {
  const here = marks.filter((m) => m.stageId === stageId);
  let items = parseItems(content);
  if (!items || !here.length) return null;
  const before = serializeItems(items);
  for (const m of here) items = markSettled(items, m.rowId, { quote: m.quote, source: m.source, ref: m.ref ?? null });
  const after = serializeItems(items);
  return after === before ? null : after;
}

/** One line for the record: which rows, and the words that settled each. */
export function describeSettled(marks: readonly SettleMark[], stageLabel: (id: string) => string): string {
  const lines = marks.map((m) => `${m.rowId} (${stageLabel(m.stageId)}): "${m.quote}"`);
  return `Settled by your own ${marks.every((m) => m.source === 'note') ? 'note' : 'answer'}, so ${marks.length === 1 ? 'it is' : 'they are'} no longer open: ${lines.join('; ')}. The status you set is unchanged; "Keep it open instead" on the row reopens it.`;
}
