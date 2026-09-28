/**
 * Applying findings to a stage's draft as a new version (PM-22), out of the
 * hook (B2a) so Go mode's apply_findings and the "Apply" buttons revise the
 * same way: one model call against exactly the findings chosen, then a
 * version with `applied_findings` provenance. The hook keeps the show-first /
 * keep / discard state; this module holds what actually happens.
 */

import { api } from '@/lib/api/client';
import type { NewVersion } from '@/lib/supabase/versions';
import { inputsFrom } from '@/lib/workflow/stage-requests';
import type { AuditFinding } from '@/types';
import type { Project } from '@/types/project';

export interface PendingRevision {
  findings: AuditFinding[];
  before: string;
  after: string;
  instruction: string;
  finishReason: string | null;
  /** Where the findings came from, for the version's change summary. */
  source: string;
}

/** Revise `content` against `findings`. One model call; nothing is saved. */
export async function reviseWithFindings(args: {
  project: Project;
  content: string;
  findings: AuditFinding[];
  source: string;
  signal?: AbortSignal;
}): Promise<PendingRevision> {
  const { project, content, findings, source, signal } = args;
  const res = await api.applyRecommendations(
    { inputs: inputsFrom(project), content, findings, model: project.model },
    signal
  );
  if (!res.content.trim()) throw new Error('The model returned nothing usable.');
  return {
    findings,
    before: content,
    after: res.content,
    instruction: res.instruction,
    finishReason: res.finish_reason || null,
    source,
  };
}

/** The version a kept revision becomes. */
export function appliedFindingsVersion(rev: PendingRevision, project: Pick<Project, 'model' | 'mode'>): NewVersion {
  return {
    content: rev.after,
    source_operation: 'applied_findings',
    instruction: rev.instruction,
    model: project.model,
    mode: project.mode,
    change_summary:
      rev.findings.length === 1
        ? `Applied from ${rev.source}: ${rev.findings[0].summary.slice(0, 120)}`
        : `Applied ${rev.findings.length} points from ${rev.source}.`,
    finish_reason: rev.finishReason,
  };
}
