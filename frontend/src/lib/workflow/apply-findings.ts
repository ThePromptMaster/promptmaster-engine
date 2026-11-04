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
import { itemSchemaFor, parseItems, saysNotReproduced, serializeItems, type StageItem, type StageItemSchema } from '@/lib/workflow/stage-artifact';
import type { StageDefinition } from '@/lib/workflow/types';
import type { AuditFinding, GenerateStageArtifactRequest } from '@/types';
import type { Project } from '@/types/project';
import { keepFound, webAccessOf, withWebLine, type WebFound } from '@/lib/workflow/web-found';
import { headingOutline, joinParts, needsParts, partInstruction, splitIntoParts } from '@/lib/workflow/long-prose';
import { splitUserNote } from './user-note';

export interface PendingRevision {
  findings: AuditFinding[];
  before: string;
  after: string;
  instruction: string;
  finishReason: string | null;
  /** Where the findings came from, for the version's change summary. */
  source: string;
  /** The web search the revision made, if any; its sources are already saved (22 Oct). */
  web?: WebFound | null;
  /** A long text revised a part at a time: how many parts, and which (1-based) came back unusable and were kept as they were. */
  parts?: { count: number; kept: number[] };
}

/** Parts revised at once; the rest wait their turn, so one long text is not a burst of calls. */
const PART_CONCURRENCY = 3;

/** How to revise a stage whose draft is a table: the stage, and the generator request for an instruction. */
export interface TableRevision {
  stage: StageDefinition;
  /** May read the chapters fresh first, so it can be async. */
  request: (instruction: string) => GenerateStageArtifactRequest | Promise<GenerateStageArtifactRequest>;
}

/** The findings as one instruction for the table generator. */
export function findingsInstruction(findings: readonly AuditFinding[]): string {
  return [
    'Revise the existing rows so that each point below is addressed. Keep every row a point does not concern exactly as it is, with its id.',
    ...findings.map((f) => `- ${f.summary.trim()}${f.suggested_change.trim() ? ` — ${f.suggested_change.trim()}` : ''}`),
  ].join('\n');
}

const words = (text: string) => (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).join(' ');

/**
 * What the user set on a row survives a regeneration of it: their status and
 * reason, and any field only they fill. Matched by row id — or, on a stage of
 * works, by the work itself, since a rewrite can renumber rows (4 Oct: Go's
 * "Revise this stage" reset every work a lookup had found to "Suggested", and
 * Go then searched again, and revised again).
 */
export function carryUserFields(before: readonly StageItem[], after: StageItem[], schema: StageItemSchema): StageItem[] {
  const old = new Map(before.map((r) => [r.id, r]));
  const field = schema.lookup?.field;
  const byWork = new Map(
    field ? before.filter((r) => words(r[field] ?? '')).map((r) => [words(r[field] ?? ''), r] as const) : []
  );
  const userOnly = schema.fields.filter((f) => f.userOnly).map((f) => f.key);
  return after.map((row) => {
    const was = old.get(row.id) ?? (field ? byWork.get(words(row[field] ?? '')) : undefined);
    if (!was) return row;
    const kept: StageItem = { ...row };
    for (const key of userOnly) if ((was[key] ?? '').trim()) kept[key] = was[key];
    // …and so does what a sandbox run settled: the regenerating model may
    // not claim "completed", so without this the row would lose it.
    // …and what a lookup found (its record and link are user-only fields, carried above).
    // A "reproduced" the revised row's own words now deny is not carried —
    // unless a run settled it (25 Oct, Sean: the dropdown said Reproduced,
    // the explanation said it was not).
    const denied = (was.status === 'reproduced' || was.status === 'independently_reproduced') && was.status_source !== 'sandbox' && saysNotReproduced(row);
    if (denied) {
      kept.reason = [`Status not kept: the revised row says it was not reproduced (it was "${was.status}").`, row.reason ?? ''].join(' ').trim();
    }
    if (!denied && (was.status_source === 'user' || was.status_source === 'sandbox' || was.status_source === 'tool' || (was.status && !was.status_source))) {
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
  /** Where a web search's sources are saved from: the stage, and Go's run. */
  stageId?: string | null;
  agentRunId?: string | null;
}): Promise<PendingRevision> {
  const { project, content, findings, source, signal, table } = args;
  const where = { stageId: args.stageId ?? table?.stage.id ?? null, agentRunId: args.agentRunId ?? null };
  if (table) {
    const instruction = findingsInstruction(findings);
    const res = await api.generateStageArtifact(await table.request(instruction), signal);
    const web = await keepFound(project, res, where);
    const rows = parseItems(generationContent(table.stage, res));
    if (!rows || rows.length === 0) {
      throw new Error(
        res.finish_reason === 'error'
          ? 'The revised table did not come back in a usable form'
          : 'The revised table came back with no rows'
      );
    }
    return {
      findings,
      before: content,
      after: serializeItems(carryUserFields(parseItems(content) ?? [], rows, itemSchemaFor(table.stage))),
      instruction,
      finishReason: res.finish_reason || null,
      source,
      web,
    };
  }
  // A table must never reach the prose revision: what comes back is not rows.
  if (parseItems(content)) throw new Error('This stage is a table and cannot be revised as text');
  if (needsParts(content)) return reviseInParts({ project, content, findings, source, signal, where });
  const res = await api.applyRecommendations(
    { inputs: inputsFrom(project), content, findings, model: project.model, web_access: webAccessOf(project) },
    signal
  );
  const web = await keepFound(project, res, where);
  if (!res.content.trim()) throw new Error('The model returned nothing usable.');
  return {
    findings,
    before: content,
    // A note to the user is not the end of the document (4 Nov, Lakeside).
    after: splitUserNote(res.content).body,
    instruction: res.instruction,
    finishReason: res.finish_reason || null,
    source,
    web,
  };
}

/**
 * A text too long to come back from one call, revised a part at a time and
 * joined in code, as a repair already is (L-127). 2 Nov, production: Go
 * applied a check's findings to a 13,504-word final report in one call; the
 * new version stopped at 9,249 words, mid-section, and was saved as current.
 * Each part is sent with every finding and told where it sits; a part that is
 * still cut off, or comes back empty, is kept as it was. Only the first part
 * may search the web: the rest use what it saved.
 */
async function reviseInParts(args: {
  project: Project;
  content: string;
  findings: AuditFinding[];
  source: string;
  signal?: AbortSignal;
  where: { stageId: string | null; agentRunId: string | null };
}): Promise<PendingRevision> {
  const { project, content, findings, source, signal, where } = args;
  const chunks = splitIntoParts(content);
  const outline = headingOutline(content);
  const results: { text: string; kept: boolean; instruction: string; web: WebFound | null }[] = new Array(chunks.length);
  const revisePart = async (i: number) => {
    const scope: AuditFinding = { id: 'part', category: 'Scope', summary: `Part ${i + 1} of ${chunks.length}`, suggested_change: partInstruction(i, chunks.length, outline).trim() };
    const res = await api.applyRecommendations(
      { inputs: inputsFrom(project), content: chunks[i], findings: [...findings, scope], model: project.model, web_access: i === 0 ? webAccessOf(project) : 'off' },
      signal
    );
    const web = i === 0 ? await keepFound(project, res, where) : null;
    const kept = !res.content.trim() || res.finish_reason === 'length';
    results[i] = { text: kept ? chunks[i] : splitUserNote(res.content).body, kept, instruction: res.instruction, web };
  };
  await revisePart(0);
  for (let next = 1; next < chunks.length; next += PART_CONCURRENCY) {
    await Promise.all(chunks.slice(next, next + PART_CONCURRENCY).map((_, j) => revisePart(next + j)));
  }
  const kept = results.flatMap((r, i) => (r.kept ? [i + 1] : []));
  if (kept.length === chunks.length) throw new Error('No part of the revision came back usable.');
  return {
    findings,
    before: content,
    after: joinParts(results.map((r) => r.text)),
    instruction: results[0].instruction,
    finishReason: 'stop',
    source,
    web: results[0].web,
    parts: { count: chunks.length, kept },
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
    change_summary: withWebLine(
      rev.findings.length === 1
        ? `Applied from ${rev.source}: ${rev.findings[0].summary.slice(0, 120)}`
        : `Applied ${rev.findings.length} points from ${rev.source}.`,
      rev.web ?? null
    ),
    finish_reason: rev.finishReason,
    base_content: rev.before,
  };
}
