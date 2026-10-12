/**
 * The accepted facts a revision changes (Sean, 10 Oct, emails 4–5).
 *
 * Sean changed a lunch invitation from Thursday at 12:30, under 120 words, to
 * Wednesday at 1:00 p.m., under 70 words, with "Change it". The version was
 * saved, but the facts still said Thursday, 12:30 and 120 words, and every
 * prompt is told that a fact outranks a stage's text, so the next Go pass
 * "corrected" the draft back. A revision the user applies is their later word:
 * where it changes a value a fact states, the fact is offered for update in
 * the same step, so the record and the document cannot disagree unnoticed.
 *
 * Matched in code, never by a model: a value of the same kind (a weekday, a
 * time, a date, an amount, a length limit) that the old version stated, the
 * revision no longer states, and the instruction or the new text replaces.
 * Pure.
 */

import type { ProjectFact } from '@/types/project';
import { describeValue, valueMentions, type FactValues, type ValueMention } from './fact-values';
import { currentFacts } from './facts';

/** Kinds a revision can change; a bare number is too easily something else. */
const RECONCILED: readonly (keyof FactValues)[] = ['dates', 'money', 'weekdays', 'times', 'limits'];

export interface FactValueChange {
  /**
   * A value matched in code; 'meaning': a change the model found and quoted
   * (L-72); 'new': a standing change the instruction states, to record as a
   * new fact (12 Oct).
   */
  kind: keyof FactValues | 'meaning' | 'new';
  was: string;
  now: string;
}

export interface FactChange {
  fact: Pick<ProjectFact, 'id' | 'statement' | 'subject' | 'kind'>;
  changes: FactValueChange[];
  /** The fact as it would read with the revision's values. */
  proposed: string;
}

function byKind(text: string): Map<keyof FactValues, ValueMention[]> {
  const out = new Map<keyof FactValues, ValueMention[]>();
  for (const m of valueMentions(text)) {
    if (!RECONCILED.includes(m.kind)) continue;
    out.set(m.kind, [...(out.get(m.kind) ?? []), m]);
  }
  return out;
}

const has = (list: readonly ValueMention[] | undefined, value: string) => (list ?? []).some((m) => m.value === value);
/** A limit is replaced only by a limit on the same unit: "70 words" does not replace "one page". */
const sameUnit = (a: string, b: string) => a.split(':')[0] === b.split(':')[0];

/**
 * For each current fact, the values the revision replaced.
 *
 * - A weekday, time, date or amount: the old version stated the fact's value,
 *   the new version does not, and the instruction or the new version states a
 *   different value of that kind.
 * - A length limit is not written in the document, so only the instruction
 *   can change it: "under 70 words" replaces the fact's "under 120 words".
 */
export function factChangesFromRevision(input: {
  facts: readonly ProjectFact[] | undefined;
  instruction: string;
  before: string;
  after: string;
}): FactChange[] {
  const said = byKind(input.instruction);
  const before = byKind(input.before);
  const after = byKind(input.after);
  const out: FactChange[] = [];
  for (const fact of currentFacts(input.facts)) {
    const changes: FactValueChange[] = [];
    let proposed = fact.statement;
    for (const m of valueMentions(fact.statement)) {
      if (!RECONCILED.includes(m.kind)) continue;
      const newer = [
        ...(said.get(m.kind) ?? []),
        ...(after.get(m.kind) ?? []).filter((a) => !has(before.get(m.kind), a.value)),
      ].filter((n) => n.value !== m.value && (m.kind !== 'limits' || sameUnit(n.value, m.value)));
      if (!newer.length) continue;
      if (m.kind === 'limits') {
        if (!has(said.get(m.kind), newer[0].value)) continue;
      } else if (!has(before.get(m.kind), m.value) || has(after.get(m.kind), m.value)) {
        continue;
      }
      // The user's own words where they gave them, else the new version's.
      const replacement = newer[0];
      if (changes.some((c) => c.kind === m.kind && c.was === describeValue(m))) continue;
      changes.push({ kind: m.kind, was: describeValue(m), now: describeValue(replacement) });
      // "p.m." before the fact's own full stop would read "p.m..".
      const words = m.raw.endsWith('.') ? replacement.raw : replacement.raw.replace(/\.$/, '');
      // "Under 120 words" stays capitalised as "Under 70 words".
      const cased = /^[A-Z]/.test(m.raw) ? words.charAt(0).toUpperCase() + words.slice(1) : words;
      proposed = proposed.split(m.raw).join(cased);
    }
    if (changes.length && proposed !== fact.statement) {
      out.push({ fact: { id: fact.id, statement: fact.statement, subject: fact.subject, kind: fact.kind }, changes, proposed });
    }
  }
  return out;
}

/** "Thursday → Wednesday; 12:30 p.m. → 1:00 p.m." */
export function describeFactChange(c: FactChange): string {
  return c.changes.map((v) => (v.kind === 'meaning' || v.kind === 'new' ? v.now : `${v.was} → ${v.now}`)).join('; ');
}

/** The id a standing change carries until it is recorded: it is not a fact yet. */
const NEW_PREFIX = 'new:';

export function isNewFact(c: FactChange): boolean {
  return c.fact.id.startsWith(NEW_PREFIX);
}

/**
 * The facts a revision contradicts in meaning, not by a value (L-72, 11 Oct:
 * in-office to fully remote). One small AI call for the facts the value
 * matcher did not already offer; each is kept only with a quote from the new
 * text. A failed check adds nothing.
 */
export async function withMeaningChanges(
  valueChanges: FactChange[],
  input: { facts: readonly ProjectFact[] | undefined; instruction: string; before: string; after: string; model?: string },
  check: (req: { instruction: string; before: string; after: string; facts: { id: string; statement: string }[]; model?: string }) => Promise<{
    changes: { fact_id: string; proposed: string; quote: string; why: string }[];
    additions?: { statement: string; kind: 'fact' | 'requirement'; quote: string }[];
  }>
): Promise<FactChange[]> {
  const offered = new Set(valueChanges.map((c) => c.fact.id));
  const rest = currentFacts(input.facts).filter((f) => !offered.has(f.id));
  // A standing change can come only from the user's own instruction (12 Oct,
  // Atlas: "the permitted evidence is now S1–S7"), so with none there is
  // nothing to add, and with no facts left there is nothing to contradict.
  const said = input.instruction.trim();
  if ((!rest.length && !said) || !input.after.trim() || input.before.trim() === input.after.trim()) return valueChanges;
  try {
    const res = await check({
      instruction: said || 'The user changed the text to the revised text themselves; every difference is theirs.',
      before: input.before, after: input.after, model: input.model,
      facts: rest.map((f) => ({ id: f.id, statement: f.statement })),
    });
    const byId = new Map(rest.map((f) => [f.id, f]));
    const meaning = res.changes.flatMap((m): FactChange[] => {
      const fact = byId.get(m.fact_id);
      return fact
        ? [{ fact: { id: fact.id, statement: fact.statement, subject: fact.subject, kind: fact.kind }, changes: [{ kind: 'meaning', was: fact.statement, now: m.why ? `${m.why} — “${m.quote}”` : `“${m.quote}”` }], proposed: m.proposed }]
        : [];
    });
    const added = said
      ? (res.additions ?? []).map((a, i): FactChange => ({
          fact: { id: `${NEW_PREFIX}${i}`, statement: '', subject: null, kind: a.kind === 'requirement' ? 'requirement' : 'fact' },
          changes: [{ kind: 'new', was: '', now: `from your instruction — “${a.quote}”` }],
          proposed: a.statement,
        }))
      : [];
    return [...valueChanges, ...meaning, ...added];
  } catch {
    return valueChanges;
  }
}

/**
 * How a version the user chose is recorded: their own instruction in the side
 * chat, an edit by hand, a restore. Go's versions and the stage's own drafts
 * are not on the list.
 */
export const USER_CHOSEN_OPERATIONS: ReadonlySet<string> = new Set(['chat_instruct', 'stage_edit', 'restore']);

/**
 * The values of the user's own latest version that a generated revision would
 * put back to what an accepted fact says (10 Oct, Sean: Go "corrected" the
 * Wednesday draft back to the Thursday the facts still held). Such a revision
 * is not saved; the user is asked which is right.
 */
export function revertsUserVersion(input: {
  facts: readonly ProjectFact[] | undefined;
  userText: string;
  generated: string;
  /** When the user's version was saved: a fact recorded after it is their later word, and wins. */
  userChosenAt?: string;
}): FactValueChange[] {
  const mine = byKind(input.userText);
  const next = byKind(input.generated);
  const at = input.userChosenAt ? Date.parse(input.userChosenAt) : NaN;
  const older = currentFacts(input.facts).filter((f) => Number.isNaN(at) || !(Date.parse(f.created_at) > at));
  const stated = byKind(older.map((f) => f.statement).join('\n'));
  const out: FactValueChange[] = [];
  for (const [kind, values] of mine) {
    if (kind === 'limits') continue;
    for (const v of values) {
      if (has(next.get(kind), v.value)) continue;
      const back = (next.get(kind) ?? []).find((n) => !has(mine.get(kind), n.value) && has(stated.get(kind), n.value));
      if (back && !out.some((o) => o.kind === kind && o.was === describeValue(v))) {
        out.push({ kind, was: describeValue(v), now: describeValue(back) });
      }
    }
  }
  return out;
}
