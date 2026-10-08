/**
 * The current facts, and how they are named to a model and to the user (F1,
 * 7 Oct). Pure; the rows come from `lib/supabase/facts.ts`.
 */
import type { Project, ProjectFact } from '@/types/project';

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
  return currentFacts(facts)
    .slice(-MAX_FACTS_SENT)
    .map((f) => ({ statement: f.statement, subject: f.subject ?? '', kind: f.kind, source: factSource(f) }));
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
