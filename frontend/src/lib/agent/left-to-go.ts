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
  /** Go said, beside the question, that it asks about this finding (`params.finding_ids`). */
  asked?: true;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Whether `text` names the row `id` (a whole id, not part of a longer one). */
export const mentions = (text: string, id: string) => new RegExp(`(^|[^\\p{L}\\p{N}_])${escape(id)}(?![\\p{L}\\p{N}_])`, 'iu').test(text);

/**
 * The ids Go gave beside its question for the findings it asks about
 * (`finding_id`, `finding_ids`, or `rows` as ids or `{id}`).
 */
export function askedIds(params: Readonly<Record<string, unknown>> | null | undefined): string[] {
  if (!params) return [];
  const raw = [params.finding_id, ...(Array.isArray(params.finding_ids) ? params.finding_ids : []), ...(Array.isArray(params.rows) ? params.rows : [])];
  const ids = raw.map((x) => (typeof x === 'string' ? x : x && typeof x === 'object' && typeof (x as { id?: unknown }).id === 'string' ? (x as { id: string }).id : '')).map((x) => x.trim());
  return [...new Set(ids.filter(Boolean))];
}

/**
 * The open rows a question (or one of its offered answers) names by id, and those
 * Go said it asks about (20 Nov, an inventory-selection pass: the question called the
 * row "Finding 17", its number in the package, and gave its id only as
 * `params.finding_id`; read from the text alone, nothing was named, so the answer
 * decided nothing and the question also said "approving leaves it open").
 */
export function namedRows(texts: readonly string[], open: readonly OpenRow[], asked: readonly string[] = []): NamedRow[] {
  const said = texts.filter(Boolean).join('\n');
  const out: NamedRow[] = [];
  for (const r of open) {
    if (!r.id || out.some((x) => x.id === r.id && x.stageId === r.stageId)) continue;
    const byGo = asked.includes(r.id);
    if (byGo || mentions(said, r.id)) out.push({ id: r.id, stageId: r.stageId, ...(byGo ? { asked: true as const } : {}) });
  }
  return out;
}

export type RowDecision = { id: string; status: 'accepted' | 'rejected'; reason?: string };

// Not "approve": approving a version or a package decides no finding (19 Nov, Sean, Inventory
// Selection: "Approve version 13 as final" was recorded as accepting i8, the one finding named).
const ACCEPT = /\b(?:accept|apply|adopt|agree|keep\s+(?:both|them|the\s+fix))\w*/i;
const REJECT = /\b(?:reject|dismiss|decline|drop|discard|leave\s+(?:it|them|both)\s+out)\w*|\b(?:don'?t|do\s+not|neither)\b/i;
const ALL = /\b(?:both|all|them|these|those|each|every)\b/i;
/** An answer about the approval or the run, not about the finding: it decides no finding. */
const NOT_ABOUT_THE_FINDING = /\b(?:approv\w*|sign(?:ed|s)?[- ]?off|finali[sz]\w*|resume|carry on|continue|keep\s+(?:it|this|them)\s+open|leave\s+(?:it|this|them)\s+open|later|not now|skip\w*|whatever is best)\b/i;
const sameChoice = (a: string, b: string) => a.replace(/\s+/g, ' ').trim().toLowerCase() === b.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * What an answer the user chose ("Accept both h16 and h17", "Accept h16;
 * reject h17") decides for the named rows, read clause by clause. Null when it
 * decides none of them: the answer is then recorded as before, and nothing is
 * guessed.
 *
 * One of the options a question offered about the one finding Go said it asks
 * about ("Hold the package until a vendor confirms nightly export") is the user's
 * decision on that finding: accepted, with the choice as its reason (20 Nov). Not an
 * answer about approving or carrying on, which decides no finding.
 */
export function decisionsFromAnswer(answer: string, rows: readonly NamedRow[], choices: readonly string[] = []): RowDecision[] | null {
  const decided = byVerb(answer, rows);
  if (decided) return decided;
  const [only] = rows;
  if (rows.length === 1 && only.asked && choices.some((c) => sameChoice(c, answer)) && !NOT_ABOUT_THE_FINDING.test(answer)) {
    return [{ id: only.id, status: 'accepted', reason: `You chose: ${answer.trim().slice(0, 300)}` }];
  }
  return null;
}

function byVerb(answer: string, rows: readonly NamedRow[]): RowDecision[] | null {
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
    const decided = decisionsFromAnswer(choice, rows, choices) ?? [];
    const effect = rows
      .map((r) => {
        const d = decided.find((x) => x.id === r.id);
        return `${r.id} ${d ? (d.reason ? `${d.status}, with this as your decision` : d.status) : 'stays undecided'}`;
      })
      .join(', ');
    return `- "${choice.slice(0, 160)}": ${effect}.`;
  });
  return `\n\nWhat each answer does to the findings it names:\n${lines.join('\n')}`;
}
