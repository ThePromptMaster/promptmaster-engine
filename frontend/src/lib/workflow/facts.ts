/**
 * The current facts, and how they are named to a model and to the user (F1,
 * 7 Oct). Pure; the rows come from `lib/supabase/facts.ts`.
 */
import type { Project, ProjectFact } from '@/types/project';
import { factValues, supersededValues, type SupersededValue } from './fact-values';

/** Facts sent with a request: enough for every prompt, bounded. */
export const MAX_FACTS_SENT = 200;

export function currentFacts(facts: readonly ProjectFact[] | undefined): ProjectFact[] {
  return (facts ?? []).filter((f) => !f.retired_at);
}

const SOURCE_WORDS: Record<ProjectFact['source_kind'], string> = {
  brief: 'added to the brief',
  file: 'from a file',
  chat: 'from the side chat',
  user_edit: 'edited',
  stage: 'from a stage',
};

function day(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** "from the side chat, 6 Oct" — the provenance chip. */
export function factSource(f: Pick<ProjectFact, 'source_kind' | 'source_ref' | 'created_at' | 'accepted_by' | 'origin'>): string {
  const file = typeof f.source_ref?.name === 'string' ? ` ${f.source_ref.name}` : '';
  const base =
    f.source_kind === 'file' && file
      ? `from${file}`
      : f.source_kind === 'chat' && f.source_ref?.via === 'front door'
        ? 'from your conversation'
        : f.source_ref?.via === 'go answer'
          ? 'your answer to Go'
          : f.source_ref?.via === 'revision'
            ? 'updated with your revision'
            : SOURCE_WORDS[f.source_kind];
  const by = f.accepted_by === 'policy' ? ', accepted under your routine-decision policy' : '';
  // Said apart from what the user said, in the chip and in every prompt (S2b).
  const assumed = f.origin === 'model_assumed' ? ', assumed by PromptMaster (you did not say it)' : '';
  const when = day(f.created_at);
  return `${base}${when ? `, ${when}` : ''}${by}${assumed}`;
}

/**
 * Words in a fact that introduce the value it replaces: "…12 business days,
 * replacing 20 business days", "…$27 million, superseding the earlier $30
 * million", "revenue was $27 million, not $30 million" (a "not" after a comma,
 * before a figure). The last two are how
 * a correction to a figure only the brief stated is written (18 Oct, Sean,
 * Ridgeway): there is no earlier fact to supersede, so the statement itself is
 * the record of what is no longer true.
 */
export const REPLACING =
  /\b(?:replacing|replaces|replaced|instead of|rather than|no longer|previously|formerly|changed from|down from|up from|supersed(?:ing|es|ed)|corrected from|(?<=,\s?)not(?=\s+(?:the\s+)?[$€£]?\d))\b/i;

/**
 * A fact that names what it replaces, split: what it says now, and the clause
 * that names the earlier value, up to the end of that sentence. Null when it
 * names nothing.
 */
export function replacedClause(statement: string): { now: string; was: string } | null {
  const at = statement.search(REPLACING);
  if (at <= 0) return null;
  const rest = statement.slice(at);
  const end = rest.search(/[.;](?=\s|$)/);
  return end > 0 ? { now: statement.slice(0, at) + rest.slice(end), was: rest.slice(0, end) } : { now: statement.slice(0, at), was: rest };
}

/**
 * Of a fact recorded with the user's words, those PromptMaster did not take
 * from them: every figure must be the user's, and without figures most of its
 * words. The front door's drafter can only add what it was told (figures are
 * checked on the server), but a requirement in words of its own is still its
 * assumption, and is recorded as one.
 */
export function assumedByModel(statement: string, userText: string): boolean {
  const said = userText.toLowerCase().replace(/,/g, '');
  const numbers = (statement.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, ''));
  if (numbers.length) return !numbers.every((n) => said.includes(n));
  const words = (statement.toLowerCase().match(/[a-z]{4,}/g) ?? []);
  return !words.length || words.filter((w) => said.includes(w)).length < Math.max(1, Math.ceil(words.length / 2));
}

/** What a request carries: the current facts, each with its source in words. */
export function factsForRequest(facts: readonly ProjectFact[] | undefined) {
  const byId = new Map((facts ?? []).map((f) => [f.id, f]));
  return currentFacts(facts)
    .slice(-MAX_FACTS_SENT)
    .map((f) => {
      // The value it replaced rides with it, so every prompt is told what is
      // no longer true rather than left to reconcile two dates (8 Oct).
      // A correction to a figure only the brief stated names it in its own
      // words, with no earlier fact to point at (18 Oct, Ridgeway).
      const replaced = (f.supersedes ? byId.get(f.supersedes)?.statement : undefined) ?? namedReplaced(f.statement);
      return { statement: f.statement, subject: f.subject ?? '', kind: f.kind, source: factSource(f), ...(replaced ? { replaces: replaced } : {}) };
    });
}

/**
 * The values the user's fact changes made untrue: for each current fact that
 * superseded another, what the old one stated that the new one does not.
 * A repair must not leave any of these in place (D2, 8 Oct).
 */
export function supersededFactValues(facts: readonly ProjectFact[] | undefined): SupersededValue[] {
  const byId = new Map((facts ?? []).map((f) => [f.id, f]));
  const current = currentFacts(facts);
  // A value another current fact still states is still true, whatever was
  // replaced: "as of November 7" moved to November 8, but "reconciliation
  // finished November 7" stands, and every repair of Output failed on it
  // (15 Oct, HARBOR: "the new version still states November 7").
  // What each fact states now: not the earlier value it names as replaced.
  const live = current.map((f) => factValues(replacedClause(f.statement)?.now ?? f.statement));
  return current.flatMap((f) => {
    const old = f.supersedes ? byId.get(f.supersedes) : undefined;
    if (old) return supersededValues(old.statement, f.statement);
    // "…to $27 million, superseding the earlier $30 million": the brief's
    // $30 million is what a repair must not leave (18 Oct, Ridgeway).
    const clause = replacedClause(f.statement);
    return clause ? supersededValues(clause.was, clause.now).map((v) => ({ ...v, now: f.statement })) : [];
  }).filter((s) => !live.some((v) => v[s.kind].includes(s.value)));
}

/** "the earlier $30 million for the same quarter": the clause a fact says it replaces, without its leading word. */
function namedReplaced(statement: string): string | undefined {
  const word = statement.match(REPLACING)?.[0] ?? '';
  const was = replacedClause(statement)?.was.slice(word.length).replace(/^[\s,:]+/, '').trim();
  return was && /\d/.test(was) ? was : undefined;
}

/**
 * The facts as one text, for the change check: a fact added, changed or
 * retired is a change to the brief like an edit of its context (C1).
 */
export function factsText(facts: readonly ProjectFact[] | undefined): string {
  return currentFacts(facts)
    .map((f) => `- ${f.kind === 'requirement' ? 'Requirement: ' : ''}${f.subject ? `${f.subject}: ` : ''}${f.statement}`)
    .join('\n');
}

/** Superseded and retired facts, newest first: the history. */
export function retiredFacts(facts: readonly ProjectFact[] | undefined): ProjectFact[] {
  return (facts ?? []).filter((f) => f.retired_at).reverse();
}

/**
 * The documents attached to the project, as their text in the project context
 * ("### From <file>" sections, written when a PDF or Word file is attached).
 */
export function attachedDocuments(context: string | undefined): { name: string; text: string }[] {
  const out: { name: string; text: string }[] = [];
  const parts = (context ?? '').split(/^### From (.+)$/m);
  for (let i = 1; i < parts.length; i += 2) {
    const text = (parts[i + 1] ?? '').trim();
    if (text) out.push({ name: parts[i].trim(), text });
  }
  return out;
}

/** Attached documents whose facts are not on record yet (L-51). */
export function documentsAwaitingFacts(project: Pick<Project, 'context' | 'facts'>): boolean {
  const recorded = new Set(
    currentFacts(project.facts)
      .filter((f) => f.source_kind === 'file' && typeof f.source_ref?.name === 'string')
      .map((f) => f.source_ref.name as string)
  );
  return attachedDocuments(project.context).some((d) => !recorded.has(d.name));
}
