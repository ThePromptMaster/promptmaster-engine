/**
 * The current facts, and how they are named to a model and to the user (F1,
 * 7 Oct). Pure; the rows come from `lib/supabase/facts.ts`.
 */
import type { Project, ProjectFact } from '@/types/project';
import { supersededValues, type SupersededValue } from './fact-values';

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
export function factSource(f: Pick<ProjectFact, 'source_kind' | 'source_ref' | 'created_at' | 'accepted_by'>): string {
  const file = typeof f.source_ref?.name === 'string' ? ` ${f.source_ref.name}` : '';
  const base =
    f.source_kind === 'file' && file
      ? `from${file}`
      : f.source_kind === 'chat' && f.source_ref?.via === 'front door'
        ? 'from your conversation'
        : f.source_ref?.via === 'go answer'
          ? 'your answer to Go'
          : SOURCE_WORDS[f.source_kind];
  const by = f.accepted_by === 'policy' ? ', accepted under your routine-decision policy' : '';
  const when = day(f.created_at);
  return `${base}${when ? `, ${when}` : ''}${by}`;
}

/** What a request carries: the current facts, each with its source in words. */
export function factsForRequest(facts: readonly ProjectFact[] | undefined) {
  const byId = new Map((facts ?? []).map((f) => [f.id, f]));
  return currentFacts(facts)
    .slice(-MAX_FACTS_SENT)
    .map((f) => {
      // The value it replaced rides with it, so every prompt is told what is
      // no longer true rather than left to reconcile two dates (8 Oct).
      const replaced = f.supersedes ? byId.get(f.supersedes)?.statement : undefined;
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
  return currentFacts(facts).flatMap((f) => {
    const old = f.supersedes ? byId.get(f.supersedes) : undefined;
    return old ? supersededValues(old.statement, f.statement) : [];
  });
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
