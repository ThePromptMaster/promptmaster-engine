/**
 * What a text says about an amount or item, checked against what the user
 * supplied (4 Nov, Sean, support-software memo: "all $3,380 of option B's
 * upfront payment" called nonrefundable, when the supplied facts said only
 * the $2,880 annual subscription was, and gave no terms for the $500 setup
 * fee; the check and a manual recheck both passed it).
 *
 * The figures were right, so no figure check could see it. Whether a term is
 * attached to the right thing is a reading, so the backend makes one small
 * call (`/api/claim-support`) with each stage check of a written stage, when
 * the project has supplied material, and returns each claim as a verbatim
 * quote — held in code there against the text and the supplied passage.
 */
import type { AuditFinding } from '@/types';
import type { Project } from '@/types/project';
import { api } from '@/lib/api/client';
import { dependentClaimFindings, dependentClaimsFor } from './dependent-claims';
import { factsForRequest } from './facts';

export interface UnsupportedClaim {
  quote: string;
  supplied: string;
  why: string;
}

/** What the user supplied, as the check reads it: their request, then the accepted facts. */
export function suppliedMaterial(project: Pick<Project, 'context' | 'facts'>): string {
  const facts = factsForRequest(project.facts).map((f) => `- ${f.statement}`);
  return [(project.context ?? '').trim(), facts.length ? `ACCEPTED FACTS:\n${facts.join('\n')}` : '']
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 60_000);
}

/** The claims in `text` that say more than was supplied; none when nothing was supplied, or the check fails. */
export async function claimSupportFor(
  project: Pick<Project, 'context' | 'facts' | 'model'>,
  stageLabel: string,
  text: string,
  signal?: AbortSignal
): Promise<UnsupportedClaim[]> {
  const supplied = suppliedMaterial(project);
  if (!supplied || !text.trim()) return [];
  try {
    const res = await api.claimSupport({ stage_label: stageLabel, text: text.slice(0, 120_000), supplied, model: project.model || undefined }, signal);
    return res.claims ?? [];
  } catch {
    return [];
  }
}

export const UNSUPPORTED_CLAIM = 'Says more than the supplied facts';

export function claimSupportFindings(claims: readonly UnsupportedClaim[]): AuditFinding[] {
  return claims.map((c, i) => ({
    id: `unsupported-claim-${i + 1}`,
    category: UNSUPPORTED_CLAIM,
    summary: `"${c.quote}" says more than the supplied facts${c.why ? `: ${c.why}` : ''}${c.supplied ? ` (Supplied: "${c.supplied}")` : ' (Nothing supplied states it.)'}`,
    suggested_change: 'State only what the supplied facts say about it, attached to the item they name; say plainly what they leave unknown. Keep every figure as it is.',
  }));
}

/**
 * The reading checks a written stage's check runs beside the scores, in
 * parallel: conclusions a changed fact undid (18 Oct) and terms attached to
 * the wrong thing (4 Nov). Each reports nothing when it cannot run.
 */
export async function writtenClaimFindings(
  project: Pick<Project, 'context' | 'facts' | 'model'>,
  stageLabel: string,
  text: string,
  signal?: AbortSignal
): Promise<AuditFinding[]> {
  const [stale, unsupported] = await Promise.all([
    dependentClaimsFor(project, stageLabel, text, signal),
    claimSupportFor(project, stageLabel, text, signal),
  ]);
  return [...dependentClaimFindings(stale), ...claimSupportFindings(unsupported)];
}
