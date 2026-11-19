/**
 * The findings a question of Go's names, and what the user's answer decides
 * about them (18 Nov, Sean, Hidden Innovation). Go asked on the decision memo
 * whether to accept review findings h16 and h17; "Do whatever is best" reopened
 * the memo, which then said both were accepted, while the review still had
 * them undecided, so neither fix reached the manuscript and Go asked again.
 * The rows a question names travel with it, and the answer decides them on
 * their own stage. Pure.
 */

import type { OpenRow } from './needs';

export interface NamedRow {
  id: string;
  stageId: string;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mentions = (text: string, id: string) => new RegExp(`(^|[^\\p{L}\\p{N}_])${escape(id)}(?![\\p{L}\\p{N}_])`, 'iu').test(text);

/** The open rows a question (or one of its offered answers) names by id. */
export function namedRows(texts: readonly string[], open: readonly OpenRow[]): NamedRow[] {
  const said = texts.filter(Boolean).join('\n');
  const out: NamedRow[] = [];
  for (const r of open) {
    if (r.id && mentions(said, r.id) && !out.some((x) => x.id === r.id && x.stageId === r.stageId)) out.push({ id: r.id, stageId: r.stageId });
  }
  return out;
}

export type RowDecision = { id: string; status: 'accepted' | 'rejected' };

// Not "approve": approving a version or a package decides no finding (19 Nov, Sean, Inventory
// Selection: "Approve version 13 as final" was recorded as accepting i8, the one finding named).
const ACCEPT = /\b(?:accept|apply|adopt|agree|keep\s+(?:both|them|the\s+fix))\w*/i;
const REJECT = /\b(?:reject|dismiss|decline|drop|discard|leave\s+(?:it|them|both)\s+out)\w*|\b(?:don'?t|do\s+not|neither)\b/i;
const ALL = /\b(?:both|all|them|these|those|each|every)\b/i;

/**
 * What an answer the user chose ("Accept both h16 and h17", "Accept h16;
 * reject h17") decides for the named rows, read clause by clause. Null when it
 * decides none of them: the answer is then recorded as before, and nothing is
 * guessed.
 */
export function decisionsFromAnswer(answer: string, rows: readonly NamedRow[]): RowDecision[] | null {
  const out = new Map<string, RowDecision['status']>();
  for (const clause of answer.split(/[;.\n]|,\s*(?=(?:and\s+|but\s+)?(?:accept|reject|dismiss|decline|apply|approve|drop))|\bbut\b/i)) {
    const rejects = REJECT.test(clause);
    const accepts = !rejects && ACCEPT.test(clause);
    if (!rejects && !accepts) continue;
    const status = rejects ? 'rejected' : 'accepted';
    const here = rows.filter((r) => mentions(clause, r.id));
    const targets = here.length ? here : ALL.test(clause) || rows.length === 1 ? rows : [];
    for (const r of targets) if (!out.has(r.id)) out.set(r.id, status);
  }
  return out.size ? [...out].map(([id, status]) => ({ id, status })) : null;
}

/**
 * What each offered answer would do to the findings the question names, in the
 * words the question then carries: "If you choose "…": i8 accepted." (19 Nov, Sean:
 * one prompt said approving would drop i8, then that it would leave it open, and the
 * press accepted it). Computed with `decisionsFromAnswer`, the reading the answer is
 * given, so what the question says is what happens.
 */
export function choiceEffects(choices: readonly string[], rows: readonly NamedRow[]): string {
  if (!rows.length || !choices.length) return '';
  const lines = choices.map((choice) => {
    const decided = decisionsFromAnswer(choice, rows) ?? [];
    const effect = rows
      .map((r) => {
        const d = decided.find((x) => x.id === r.id);
        return `${r.id} ${d ? d.status : 'stays undecided'}`;
      })
      .join(', ');
    return `- "${choice.slice(0, 160)}": ${effect}.`;
  });
  return `\n\nWhat each answer does to the findings it names:\n${lines.join('\n')}`;
}
