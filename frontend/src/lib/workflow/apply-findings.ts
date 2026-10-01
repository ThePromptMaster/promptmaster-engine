/**
 * Applying findings to a stage's draft as a new version (PM-22), out of the
 * hook (B2a) so Go mode's apply_findings and the "Apply" buttons revise the
 * same way: one model call against exactly the findings chosen, then a
 * version with `applied_findings` provenance. The hook keeps the show-first /
 * keep / discard state; this module holds what actually happens.
 *
 * A stage that holds a table is revised as a table. Its rows used to be sent
 * as raw JSON through the prose revision, which came back as prose: the
 * version saved from it parsed as no rows at all, and the stage read "No
 * works yet" (found on production, 2026-10-01, when Go applied a check's
 * findings to a Research literature list). Rows now go through the same
 * generator that drafted them, and a result that is not a table is refused.
 */

import { api } from '@/lib/api/client';
import type { NewVersion } from '@/lib/supabase/versions';
import { generationContent, inputsFrom } from '@/lib/workflow/stage-requests';
import { itemSchemaFor, parseItems, serializeItems, type StageItem, type StageItemSchema } from '@/lib/workflow/stage-artifact';
import type { StageDefinition } from '@/lib/workflow/types';
import type { AuditFinding, GenerateStageArtifactRequest } from '@/types';
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

/** How to revise a stage whose draft is a table: the stage, and the generator request for an instruction. */
export interface TableRevision {
  stage: StageDefinition;
  request: (instruction: string) => GenerateStageArtifactRequest;
}

/** The findings as one instruction for the table generator. */
export function findingsInstruction(findings: readonly AuditFinding[]): string {
  return [
    'Revise the existing rows so that each point below is addressed. Keep every row a point does not concern exactly as it is, with its id.',
    ...findings.map((f) => `- ${f.summary.trim()}${f.suggested_change.trim() ? ` — ${f.suggested_change.trim()}` : ''}`),
  ].join('\n');
}

/**
 * What the user set on a row survives a regeneration of it: their status and
 * reason, and any field only they fill. Matched by row id.
 */
export function carryUserFields(before: readonly StageItem[], after: StageItem[], schema: StageItemSchema): StageItem[] {
  const old = new Map(before.map((r) => [r.id, r]));
  const userOnly = schema.fields.filter((f) => f.userOnly).map((f) => f.key);
  return after.map((row) => {
    const was = old.get(row.id);
    if (!was) return row;
    const kept: StageItem = { ...row };
    for (const key of userOnly) if ((was[key] ?? '').trim()) kept[key] = was[key];
    // …and so does what a sandbox run settled: the regenerating model may
    // not claim "completed", so without this the row would lose it.
    if (was.status_source === 'user' || was.status_source === 'sandbox' || (was.status && !was.status_source)) {
      kept.status = was.status;
      kept.reason = was.reason;
      kept.status_source = was.status_source;
      if (was.status_source === 'sandbox') {
        if (was.sandbox_run_id) kept.sandbox_run_id = was.sandbox_run_id;
        if (schema.execution && was[schema.execution.field]) kept[schema.execution.field] = was[schema.execution.field];
      }
    }
    return kept;
  });
}

/** Revise `content` against `findings`. One model call; nothing is saved. */
export async function reviseWithFindings(args: {
  project: Project;
  content: string;
  findings: AuditFinding[];
  source: string;
  signal?: AbortSignal;
  /** Set for a stage whose draft is a table. */
  table?: TableRevision;
}): Promise<PendingRevision> {
  const { project, content, findings, source, signal, table } = args;
  if (table) {
    const instruction = findingsInstruction(findings);
    const res = await api.generateStageArtifact(table.request(instruction), signal);
    const rows = parseItems(generationContent(table.stage, res));
    if (!rows || rows.length === 0) throw new Error('The revised table came back empty');
    return {
      findings,
      before: content,
      after: serializeItems(carryUserFields(parseItems(content) ?? [], rows, itemSchemaFor(table.stage))),
      instruction,
      finishReason: res.finish_reason || null,
      source,
    };
  }
  // A table must never reach the prose revision: what comes back is not rows.
  if (parseItems(content)) throw new Error('This stage is a table and cannot be revised as text');
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
