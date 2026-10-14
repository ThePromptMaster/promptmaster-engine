/**
 * "Don't invent details" (14 Oct, Sean's wedding speech).
 *
 * Told "do not invent memories or stories" and, for the revision, "add no new
 * personal details", the rewrite still added "a lifelong pattern of Emma being
 * the organized one". When the project says so, every prompt carries a fact
 * boundary (backend `project_context.FACT_BOUNDARY`, read from the same
 * wording) and each revision is checked for personal details nobody supplied
 * (`api.checkNewClaims`). The two readings of the wording must agree; the
 * backend's tests and these use the same sentences.
 */

import { api } from '@/lib/api/client';
import { currentFacts } from './facts';
import type { Project } from '@/types/project';

const NO_INVENTION =
  /\b(?:do not|don['’]t|never|no|without)\s+(?:invent(?:ing|ed)?|mak(?:e|ing) up|fabricat\w*|embellish\w*|add(?:ing)?\s+(?:any\s+)?new)\b[^.\n]{0,40}?\b(?:memor\w*|stor\w*|details?|anecdotes?|facts?|events?|claims?)\b|\b(?:add|invent)\s+no\s+(?:new\s+)?(?:personal\s+)?(?:details?|memor\w*|stor\w*)/i;

/** Whether these words (a brief, an instruction) say not to invent details. */
export function saysNoInvention(...texts: readonly (string | null | undefined)[]): boolean {
  return texts.some((t) => Boolean(t && NO_INVENTION.test(t)));
}

/** Whether the project, or an instruction the user gave, says not to invent details. */
export function noInventedDetails(project: Pick<Project, 'objective' | 'constraints'> & Partial<Pick<Project, 'facts'>>, instructions: readonly string[] = []): boolean {
  const required = currentFacts(project.facts).filter((f) => f.kind === 'requirement').map((f) => f.statement);
  return saysNoInvention(project.objective, project.constraints, ...required, ...instructions);
}

/** Everything the user supplied: the brief, the facts, and their own messages. */
export function suppliedText(project: Pick<Project, 'objective' | 'constraints' | 'context'> & Partial<Pick<Project, 'facts'>>, said: readonly string[] = []): string {
  return [
    project.objective,
    project.constraints,
    project.context,
    ...currentFacts(project.facts).map((f) => f.statement),
    ...said,
  ]
    .filter((t): t is string => Boolean(t?.trim()))
    .join('\n')
    .slice(0, 60_000);
}

export interface AddedClaim {
  quote: string;
  why: string;
}

/** The personal details a revision added that nobody supplied; [] when the check fails. */
export async function addedClaims(req: { before: string; after: string; supplied: string; instruction?: string; model?: string }): Promise<AddedClaim[]> {
  try {
    return (await api.checkNewClaims(req)).claims;
  } catch {
    return [];
  }
}

/** The instruction that takes added details back out. */
export function removeClaimsInstruction(claims: readonly AddedClaim[]): string {
  return `Take out these details I did not supply, and change nothing else: ${claims.map((c) => `"${c.quote}"`).join('; ')}. Where one replaced something I did say, put my version back.`;
}
