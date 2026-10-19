/**
 * Conclusions that no longer follow from a fact that replaced something (18
 * Oct, Sean, Summit: "EBITDA deterioration despite higher revenue" survived a
 * revenue correction through three repairs).
 *
 * `leftoverValues` finds an old value still stated, in code; a conclusion
 * drawn from the old value contains none ("higher revenue" is not "$24
 * million"). Which sentences no longer follow is a reading, so the backend
 * makes one small call (`/api/dependent-claims`) — only when a fact has
 * replaced something — and returns each as a verbatim quote. Whether a quote
 * is still in a repaired text is then checked here, in code.
 */
import type { AuditFinding } from '@/types';
import type { Project } from '@/types/project';
import { api } from '@/lib/api/client';
import { factsForRequest } from './facts';

export interface DependentClaim {
  quote: string;
  fact: string;
  why: string;
}

/** A fact that says it corrects or replaces something, even with no record of what (a figure only in the brief). */
const REPLACING_WORDS = /\b(?:supersed\w*|correct(?:ed|s|ion)|replac\w*|revised|restated|instead of|not \$?\d)/i;

/** The current facts that replaced something: what a conclusion is read against. */
export function changedFacts(project: Pick<Project, 'facts'>): { statement: string; replaces?: string }[] {
  return factsForRequest(project.facts)
    .filter((f) => ('replaces' in f && f.replaces) || REPLACING_WORDS.test(f.statement))
    .map((f) => ({ statement: f.statement, ...('replaces' in f && f.replaces ? { replaces: f.replaces } : {}) }));
}

/** The sentences in `text` whose conclusion no longer follows; none when no fact changed, or the check fails. */
export async function dependentClaimsFor(
  project: Pick<Project, 'facts' | 'model'>,
  stageLabel: string,
  text: string,
  signal?: AbortSignal
): Promise<DependentClaim[]> {
  const changed = changedFacts(project);
  if (!changed.length || !text.trim()) return [];
  const facts = factsForRequest(project.facts).map((f) => f.statement).filter((s) => !changed.some((c) => c.statement === s));
  try {
    const res = await api.dependentClaims({ stage_label: stageLabel, text: text.slice(0, 120_000), changed, facts, model: project.model || undefined }, signal);
    return res.claims ?? [];
  } catch {
    return [];
  }
}

function norm(text: string): string {
  return text.replace(/\\n/g, ' ').replace(/[*_`#>“”"’'|]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** The claims whose sentence `text` still contains, verbatim. */
export function claimsStillIn(text: string, claims: readonly DependentClaim[]): DependentClaim[] {
  const t = norm(text);
  return claims.filter((c) => t.includes(norm(c.quote)));
}

/** How a repair is told what to fix. */
export function claimsInstruction(claims: readonly DependentClaim[]): string {
  if (!claims.length) return '';
  return ` CONCLUSIONS THAT NO LONGER FOLLOW FROM THE CURRENT FACTS — rewrite each so it follows from them, or remove it; never keep it as it is: ${claims
    .map((c) => `"${c.quote}" (${[c.fact && `current fact: ${c.fact}`, c.why].filter(Boolean).join('; ')})`)
    .join('; ')}.`;
}

export const STALE_CONCLUSION = 'Conclusion no longer follows';

/** A finding per claim, for the stage check. */
export function dependentClaimFindings(claims: readonly DependentClaim[]): AuditFinding[] {
  return claims.map((c, i) => ({
    id: `stale-conclusion-${i + 1}`,
    category: STALE_CONCLUSION,
    summary: `"${c.quote}" no longer follows from the current facts${c.why ? `: ${c.why}` : ''}${c.fact ? ` (${c.fact})` : ''}.`,
    suggested_change: 'Rewrite the sentence so its conclusion follows from the facts as they now stand, or remove it.',
  }));
}
