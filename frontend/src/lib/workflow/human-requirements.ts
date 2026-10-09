/**
 * Work only people can do (Q3b). Pure, and pattern-based like `measurable.ts`.
 *
 * Sean, 9 Oct: "if a method genuinely requires independent human coders, the
 * system should not silently substitute two AI passes." A requirement the
 * objective or the constraints state for people — coders, raters,
 * participants, an expert panel, a laboratory measurement — is never met by
 * anything PromptMaster does itself: a run row that names it needs a person,
 * and the objective is not met until a human result is on record as a fact
 * the user accepted.
 */

import type { ProjectFact } from '@/types/project';

const HUMAN = /\b(independent (?:human )?(?:coders?|raters?|annotators?|reviewers?|judges?)|inter-?rater (?:reliability|agreement)|human (?:coders?|raters?|annotators?|judges?|participants|subjects|evaluators?)|(?:expert|review) panel|panel of experts|(?:study|survey|trial) participants|recruited participants|laboratory (?:measurements?|experiments?|tests?)|lab (?:measurements?|experiments?|tests?)|field (?:measurements?|observations?))\b/gi;

/** The human-only requirements a text names, each once, in the words it uses. */
export function humanRequirements(text: string): string[] {
  const seen = new Map<string, string>();
  for (const m of text.matchAll(HUMAN)) {
    const key = m[1].toLowerCase();
    if (!seen.has(key)) seen.set(key, m[1]);
  }
  return [...seen.values()];
}

/** The row asks for something only people can do. */
export function needsPeople(text: string): boolean {
  return humanRequirements(text).length > 0;
}

/**
 * The human-only requirements of the objective and constraints that no fact
 * the user accepted reports a result for. Each one holds "Objective met" back.
 */
export function unmetHumanRequirements(
  project: { objective: string; constraints?: string | null; facts?: readonly ProjectFact[] }
): string[] {
  const asked = humanRequirements(`${project.objective}\n${project.constraints ?? ''}`);
  const reported = (project.facts ?? [])
    .filter((f) => !f.retired_at && f.accepted_by === 'user')
    .map((f) => f.statement.toLowerCase());
  return asked.filter((req) => !reported.some((s) => s.includes(req.toLowerCase()) && /\b(result|completed|done|recorded|agreement|kappa|measured)\b/.test(s)));
}
