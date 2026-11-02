/**
 * The finished deliverable, checked for the findings that were accepted and for
 * its own consistency, before Go may call the objective met (1 Nov). Pure.
 *
 * Sean, 1 Nov: "An 'accepted' finding should not be treated as resolved merely
 * because the decision was recorded", and the final review should check
 * "consistency between explanations, assumptions and decision rules". What the
 * check finds goes to the objective check as failed checks, so "Have Go fix it"
 * repairs it like any other unmet requirement — at most twice a run for a
 * deliverable. After that it is recorded as a stated limitation and the run
 * stops predictably, rather than raising another vague approval ("It needs a
 * bounded review process … explain the remaining issue and stop predictably").
 */

import { effectiveRenderer, itemSchemaFor, parseItems } from '@/lib/workflow/stage-artifact';
import { isSuperseded } from '@/lib/workflow/superseded-rows';
import { isTriageTable } from '@/lib/workflow/triage';
import type { StageArtifactBundle } from '@/lib/workflow/digest';
import type { WorkflowEvent, WorkflowTemplate } from '@/lib/workflow/types';

/** How many times in one run the check's issues are sent back for repair. */
export const MAX_CHECK_ROUNDS = 2;

export interface AcceptedRow {
  id: string;
  stage_label: string;
  finding: string;
  suggested_change: string;
}

export interface CheckResult {
  findings: { id: string; verdict: 'carried' | 'not_carried' | 'not_applicable'; quote: string; note: string }[];
  contradictions: { rule_quote: string; conflicts_quote: string; problem: string; fix: string }[];
}

/** What is saved with the objective assessment, and read back by the next round. */
export interface DeliverableCheckRecord {
  version_id: string | null;
  version_number: number | null;
  /** Accepted findings sent, and how many the text shows carried. */
  accepted: number;
  carried: number;
  /** One line per issue, as it went to the objective check (or into the limitations). */
  issues: string[];
  /** The rounds were used up: the issues are stated limitations, not failed checks. */
  bounded?: boolean;
  /** The check could not run; nothing was concluded from it. */
  failed?: boolean;
}

/**
 * Accepted findings on the triage tables before the deliverable, worded as
 * their table words them. Rows a later fact superseded are left out: they no
 * longer describe what the work must do.
 */
export function acceptedRowsBefore(template: WorkflowTemplate, bundles: Record<string, StageArtifactBundle>, holderId: string): AcceptedRow[] {
  const end = template.stages.findIndex((s) => s.id === holderId);
  return template.stages.slice(0, end < 0 ? template.stages.length : end).flatMap((stage) => {
    if (effectiveRenderer(stage) !== 'review') return [];
    const schema = itemSchemaFor(stage);
    if (!isTriageTable(schema)) return [];
    const items = parseItems(bundles[stage.id]?.versions.at(-1)?.content) ?? [];
    const first = schema.fields.find((f) => f.key !== 'severity')?.key ?? 'finding';
    return items
      .filter((i) => i.status === 'accepted' && i.status_source !== 'proposed' && !isSuperseded(i))
      .map((i) => ({
        id: i.id.slice(0, 40),
        stage_label: stage.short_label || stage.label,
        finding: (i[first] ?? '').slice(0, 1_000),
        suggested_change: (i.suggested_change ?? '').slice(0, 1_000),
      }));
  }).slice(0, 30);
}

/** The check's result as lines the objective check reads as unmet. */
export function issuesFrom(result: CheckResult, rows: readonly AcceptedRow[], label: string): string[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const missing = result.findings
    .filter((f) => f.verdict === 'not_carried')
    .map((f) => {
      const row = byId.get(f.id);
      const what = row ? `${row.finding}${row.suggested_change ? ` — accepted change: ${row.suggested_change}` : ''}` : f.id;
      return `Accepted finding ${f.id}${row?.stage_label ? ` (${row.stage_label})` : ''} is not carried into ${label}: ${what}${f.quote ? ` — the text still says "${f.quote}"` : ''}${f.note ? ` (${f.note})` : ''}`;
    });
  const contradictions = result.contradictions.map(
    (c) => `${label} contradicts itself: "${c.rule_quote}" against "${c.conflicts_quote}" — ${c.problem}${c.fix ? ` Fix: ${c.fix}` : ''}`
  );
  return [...missing, ...contradictions];
}

type Assessed = Pick<WorkflowEvent, 'type' | 'agent_run_id' | 'payload'>;

function recordOf(e: Assessed): DeliverableCheckRecord | null {
  const r = (e.payload as { deliverable_check?: DeliverableCheckRecord } | undefined)?.deliverable_check;
  return r && Array.isArray(r.issues) ? r : null;
}

/** Rounds this run already sent issues back for, on this deliverable. */
export function roundsUsed(events: readonly Assessed[], runId: string, stageId: string): number {
  return events.filter((e) => {
    const basis = (e.payload as { basis?: { stage_id?: string } } | undefined)?.basis;
    const r = e.type === 'objective_assessed' && e.agent_run_id === runId && basis?.stage_id === stageId ? recordOf(e) : null;
    return Boolean(r && r.issues.length && !r.bounded && !r.failed);
  }).length;
}

/** A check already made on this very version: its result stands, without another call. */
export function checkedVersion(events: readonly Assessed[], versionId: string | null): DeliverableCheckRecord | null {
  if (!versionId) return null;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i];
    if (e.type !== 'objective_assessed') continue;
    const r = recordOf(e);
    if (r && !r.failed && r.version_id === versionId) return r;
  }
  return null;
}

/** One sentence for the run's record: what the check found, in counts. */
export function describeCheck(r: DeliverableCheckRecord | null, label: string): string {
  if (!r) return '';
  if (r.failed) return ` The check of ${label} against the accepted findings could not run, so nothing was concluded from it.`;
  const on = `${label}${r.version_number ? ` v${r.version_number}` : ''}`;
  const carried = r.accepted ? `${r.carried} of ${r.accepted} accepted finding${r.accepted === 1 ? '' : 's'} shown carried into ${on}` : `no accepted findings to carry into ${on}`;
  if (!r.issues.length) return ` Checked: ${carried}; no contradiction found.`;
  if (r.bounded) return ` Checked: ${carried}. Still open after ${MAX_CHECK_ROUNDS} repair rounds, so stated as limitations: ${r.issues.join('; ')}.`;
  return ` Checked: ${carried}; ${r.issues.length} issue${r.issues.length === 1 ? '' : 's'} found.`;
}
