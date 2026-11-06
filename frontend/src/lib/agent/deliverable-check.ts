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
import { isDone, type WorkflowEvent, type WorkflowState, type WorkflowTemplate } from '@/lib/workflow/types';

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
  /** Set when only part of the text fitted the check (5 Nov): how much it was shown, in characters. */
  read?: { chars: number; total: number };
}

/**
 * Accepted findings on the triage tables before the deliverable, worded as
 * their table words them. Rows a later fact superseded are left out: they no
 * longer describe what the work must do.
 */
export function acceptedRowsBefore(
  template: WorkflowTemplate,
  bundles: Record<string, StageArtifactBundle>,
  holderId: string,
  /** With the state, a manuscript's own later reviews count, up to the last long-form stage done (5 Nov). */
  state?: Pick<WorkflowState, 'stages'>
): AcceptedRow[] {
  const holderAt = template.stages.findIndex((s) => s.id === holderId);
  // Book's Continuity, Critique and Fact-check come after Drafting, which holds the
  // chapters, so their accepted rows never reached this check. Findings Revision or
  // Editing has not reached yet are left out: nothing has tried to carry them.
  const reached = state && template.stages[holderAt]?.renderer === 'long_form'
    ? template.stages.reduce((last, s, i) => (s.renderer === 'long_form' && isDone(state.stages[s.id]?.status) ? i : last), holderAt)
    : holderAt;
  return template.stages.slice(0, reached < 0 ? template.stages.length : reached).flatMap((stage) => {
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

export interface RecordedTable {
  label: string;
  rows: string;
}

/**
 * The outcome tables before the deliverable, as their rows stand — the tables
 * a write-up reports on (4 Nov, Sean: "In Research, the narrative and evidence
 * table disagreed about what had been reproduced"). A findings table is left
 * out: its accepted rows are sent as findings. Each row is its fields, then its
 * status as the table names it.
 */
export function outcomeTablesBefore(template: WorkflowTemplate, bundles: Record<string, StageArtifactBundle>, holderId: string): RecordedTable[] {
  const end = template.stages.findIndex((s) => s.id === holderId);
  return template.stages.slice(0, end < 0 ? template.stages.length : end).flatMap((stage) => {
    const renderer = effectiveRenderer(stage);
    if (renderer !== 'list' && renderer !== 'review') return [];
    const schema = itemSchemaFor(stage);
    if (!schema.statuses?.length || isTriageTable(schema)) return [];
    const items = parseItems(bundles[stage.id]?.versions.at(-1)?.content) ?? [];
    if (!items.length) return [];
    const rows = items
      .filter((i) => !isSuperseded(i))
      .map((i) => {
        const fields = schema.fields.map((f) => (i[f.key] ?? '').toString().trim()).filter(Boolean).join(' | ');
        const status = schema.statuses?.find((s) => s.value === i.status)?.label ?? 'no status';
        return `- ${i.id}: ${fields} — status: ${status}`;
      })
      .join('\n')
      .slice(0, 8_000);
    return [{ label: stage.short_label || stage.label, rows }];
  }).slice(-4);
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
  const part = r.read && r.read.chars < r.read.total ? ` It read ${r.read.chars.toLocaleString('en-US')} of ${r.read.total.toLocaleString('en-US')} characters.` : '';
  if (!r.issues.length) return ` Checked: ${carried}; no contradiction found.${part}`;
  if (r.bounded) return ` Checked: ${carried}. Still open after ${MAX_CHECK_ROUNDS} repair rounds, so stated as limitations: ${r.issues.join('; ')}.${part}`;
  return ` Checked: ${carried}; ${r.issues.length} issue${r.issues.length === 1 ? '' : 's'} found.${part}`;
}

/** A heading for a note on the document itself. */
const REVIEW_NOTE_HEADING = /^(#{1,6})\s+\**(?:\d+[.)]\s+)?(?:review(?:er'?s?)? notes?|notes? on (?:the|this) (?:review|manuscript|draft|document|book)|what was checked)\b/i;

const normalised = (text: string) =>
  text.replace(/[*_`#>|\\]/g, '').replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();

/** The document's review note, and the rest of it. Null when it has none. */
export function splitReviewNote(text: string): { note: string; rest: string } | null {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => REVIEW_NOTE_HEADING.test(l));
  if (start < 0) return null;
  const level = lines[start].match(/^#+/)![0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    const h = lines[i].match(/^(#{1,6})\s/);
    if (h && h[1].length <= level) {
      end = i;
      break;
    }
  }
  return { note: lines.slice(start, end).join('\n'), rest: [...lines.slice(0, start), ...lines.slice(end)].join('\n') };
}

const QUOTED = /[“"]([^”"\n]{10,400})[”"]/g;

/**
 * Passages the review note quotes that the rest of this version does not hold
 * (5 Nov, a book test). The check judges them: a note may quote an earlier draft
 * or the brief, saying so. Found in code, so it cannot be argued away.
 */
export function noteQuotesNotInText(text: string, max = 12): string[] {
  const parts = splitReviewNote(text);
  if (!parts) return [];
  const rest = normalised(parts.rest);
  const out: string[] = [];
  for (const m of parts.note.matchAll(QUOTED)) {
    const quote = m[1].trim();
    if (quote.split(/\s+/).length < 4) continue;
    if (!rest.includes(normalised(quote).replace(/[.,;:!?]+$/, ''))) out.push(quote);
    if (out.length >= max) break;
  }
  return out;
}

/** "Was not available to me", in a note beside the text it says it could not see. */
const NO_ACCESS =
  /[^.\n]*\b(?:(?:chapters?|manuscript|draft|text)\b[^.\n]{0,60}\b(?:(?:was|were) not (?:available|in front of me)|(?:wasn't|weren't) (?:available|in front of me))|(?:could|can) (?:only inspect|inspect only|not (?:read|inspect|see))\b[^.\n]{0,60}\b(?:chapters?|manuscript|draft|text|outline))[^.\n]*\./i;

/**
 * The note says it could not read the work, and this version holds the work: an
 * issue the check does not have to find (5 Nov: "The text of Chapters 1 to 6 was not
 * in front of me"). Only when the rest of the document is real text.
 */
export function noAccessClaim(text: string): string | null {
  const parts = splitReviewNote(text);
  if (!parts || parts.rest.split(/\s+/).filter(Boolean).length < 200) return null;
  const said = parts.note.match(NO_ACCESS)?.[0]?.trim();
  return said ? `The review note says it could not read the work, and this version holds it: "${said.slice(0, 300)}"` : null;
}
