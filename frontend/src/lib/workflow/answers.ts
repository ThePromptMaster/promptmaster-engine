/**
 * An answer to Go's question is a decision of record (8 Oct; Sean, emails 8
 * and 11).
 *
 * "Answer and continue" used to be saved only as a step of the run. Drafting
 * read it, because the next revision was handed it; evaluation, the final
 * review and the objective check did not, because they read the project's
 * facts. So December 10 and $18 were "already decided by the user" in the
 * draft and an "unresolved combination" in the evaluation, and Summary went on
 * waiting for two answers it had been given. The answer now becomes an
 * accepted fact, which every prompt reads (`project_context.context_block`).
 */
import type { NewFact } from '@/lib/supabase/facts';
import { documentText, type StageArtifactBundle } from './digest';
import type { WorkflowTemplate } from './types';

const QUESTION_MAX = 600;
const STATEMENT_MAX = 2_000;

/** The question as the fact records it: the first paragraph, without the pointer to a button. */
export function questionOf(question: string): string {
  const first = question.split(/\n\s*\n/)[0]?.replace(/\s+/g, ' ').trim() ?? '';
  return first.length > QUESTION_MAX ? `${first.slice(0, QUESTION_MAX - 1).trimEnd()}…` : first;
}

/**
 * The fact an answer records. `null` for an answer that decides nothing
 * ("ok", "go on"): recording "ok" as a fact of the project would be noise
 * that every later prompt reads.
 */
export function answerAsFact(
  question: string,
  answer: string,
  ref: { run_id: string; step_id?: string; stage_id: string; contradicted?: { document: string; quote: string } }
): NewFact | null {
  const text = answer.replace(/\s+/g, ' ').trim();
  if (!text || /^(ok(ay)?|yes|no|go( on| ahead)?|continue|proceed|sure|fine|thanks?( you)?)[.!]*$/i.test(text)) return null;
  const asked = questionOf(question);
  const statement = asked
    ? `Decided by the user — asked "${asked}", answered: ${text}`
    : `Decided by the user: ${text}`;
  return {
    statement: statement.slice(0, STATEMENT_MAX),
    subject: 'Decision',
    kind: 'fact',
    source_kind: 'user_edit',
    source_ref: { via: 'go answer', question: asked, ...ref },
  };
}

/** Per stage, at most this much of its latest saved text goes to the answer check (L-65). */
const ANSWER_DOC_MAX = 20_000;
const ANSWER_DOCS_MAX = 120_000;

/**
 * The saved documents an answer is read against (L-65): every stage's latest
 * saved version, as text, in workflow order, within a budget.
 */
export function answerDocuments(
  template: WorkflowTemplate,
  bundles: Record<string, StageArtifactBundle>
): { label: string; version: number | null; text: string }[] {
  const out: { label: string; version: number | null; text: string }[] = [];
  let used = 0;
  for (const stage of template.stages) {
    const head = bundles[stage.id]?.versions.at(-1);
    const text = documentText(stage, head?.content ?? '').slice(0, ANSWER_DOC_MAX);
    if (!text.trim() || used + text.length > ANSWER_DOCS_MAX) continue;
    used += text.length;
    out.push({ label: stage.label, version: head?.version_number ?? null, text });
  }
  return out;
}
