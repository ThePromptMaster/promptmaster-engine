/**
 * Accepted fixes land in the manuscript itself (17 Nov). Pure.
 *
 * Sean, Hidden Innovation (15–16 Nov): the review after the manuscript accepted
 * fixes, and nothing in the workflow wrote them into the chapters. There was no
 * revision stage, and Go has no move that edits a finished manuscript. So Go
 * added a "Manuscript corrections" stage and then a "Consolidated manuscript",
 * and tried to go back and was refused. Review then read the main manuscript,
 * still at v1, which was also what the export delivered. "I'd expect an accepted
 * fix to land in the manuscript that Review checks next, with the version clearly
 * shown."
 *
 * Now the findings a review accepted are carried into the chapters they concern:
 * the manuscript's repair (`recheckManuscript`) rewrites only those sections. A
 * new stage that would only copy or correct the manuscript is refused.
 */

import type { StageArtifactBundle } from '@/lib/workflow/digest';
import { effectiveRenderer, itemSchemaFor, parseItems } from '@/lib/workflow/stage-artifact';
import { isSuperseded } from '@/lib/workflow/superseded-rows';
import { CARRIED_OUT_REASON, isTriageTable } from '@/lib/workflow/triage';
import type { WorkflowEvent, WorkflowTemplate } from '@/lib/workflow/types';
import type { AgentStep } from '@/types/agent';

export interface FixToCarry {
  /** "<stage id>:<row id>", so the same row is carried once. */
  key: string;
  /** The row as the repair is told it: "[h2] (Review) the change — what was found". */
  text: string;
}

/**
 * The manuscript stage the reviews after it have no later stage to carry their
 * accepted findings into: the last long-form stage of the workflow. Null when
 * the deliverable is not a manuscript.
 */
export function loneManuscript(template: Pick<WorkflowTemplate, 'stages'>, holderId: string | undefined): string | null {
  if (!holderId) return null;
  const at = template.stages.findIndex((s) => s.id === holderId);
  if (at < 0 || template.stages[at].renderer !== 'long_form') return null;
  return template.stages.slice(at + 1).some((s) => s.renderer === 'long_form') ? null : holderId;
}

/**
 * The accepted findings of the review stages after the manuscript, not yet
 * carried into it by an earlier repair. A row Go recorded as "already carried
 * out" is left out, as are proposals and superseded rows.
 */
export function fixesToCarry(
  template: Pick<WorkflowTemplate, 'stages'>,
  bundles: Record<string, StageArtifactBundle | undefined>,
  holderId: string | undefined,
  carried: ReadonlySet<string>
): FixToCarry[] {
  const manuscript = loneManuscript(template, holderId);
  if (!manuscript) return [];
  const at = template.stages.findIndex((s) => s.id === manuscript);
  return template.stages.slice(at + 1).flatMap((stage) => {
    if (effectiveRenderer(stage) !== 'review') return [];
    const schema = itemSchemaFor(stage);
    if (!isTriageTable(schema)) return [];
    const first = schema.fields.find((f) => f.key !== 'severity')?.key ?? 'finding';
    const items = parseItems(bundles[stage.id]?.versions.at(-1)?.content) ?? [];
    return items
      .filter((i) => i.status === 'accepted' && i.status_source !== 'proposed' && !isSuperseded(i))
      .filter((i) => !(i.status_source === 'model' && (i.reason ?? '').startsWith(CARRIED_OUT_REASON)))
      .map((i) => ({ key: `${stage.id}:${i.id}`, i }))
      .filter(({ key }) => !carried.has(key))
      .map(({ key, i }) => {
        const change = (i.suggested_change ?? '').trim();
        const found = (i[first] ?? '').trim();
        const text = `[${i.id}] (${stage.short_label || stage.label}) ${change || found}${change && found ? ` — what was found: ${found}` : ''}`;
        return { key, text: text.slice(0, 1_200) };
      });
  }).slice(0, 12);
}

/** The rows earlier repairs carried into the manuscript, by key: each is carried once. */
export function carriedKeys(steps: readonly Pick<AgentStep, 'action_key' | 'status' | 'params'>[]): Set<string> {
  const out = new Set<string>();
  for (const s of steps) {
    if (s.action_key !== 'recheck_stage' || s.status !== 'succeeded') continue;
    const keys = s.params?.fix_keys;
    if (Array.isArray(keys)) for (const k of keys) if (typeof k === 'string') out.add(k);
  }
  return out;
}

const COPY = /\b(?:consolidated|corrected|revised|updated|clean|final|amended)\s+(?:manuscript|draft|text|chapters?|version)\b|\b(?:manuscript|chapter)\s+(?:corrections?|fixes|revisions?|edits?)\b|\b(?:corrections?|fixes|revisions?)\s+(?:to|of|for|in(?:to)?)\s+(?:the\s+)?(?:main\s+)?(?:manuscript|chapters?|draft)\b|\bapply\s+(?:the\s+)?(?:accepted|remaining)\b/i;

/** Whether a stage Go wants to add would only copy or correct the manuscript. */
export function copiesTheManuscript(title: string, work: string): boolean {
  return COPY.test(title) || COPY.test(work.slice(0, 600));
}

/**
 * The work a return to a manuscript was for, not yet done (17 Nov, production
 * pass): Go went back to a book's Manuscript to "add one line to Chapter 1", had no
 * move that edits chapters, and asked for the manuscript's approval instead, with
 * the line never added. The latest return to the last long-form stage, with work
 * named, once, whichever stage holds the delivered text.
 */
export function returnWorkToCarry(
  template: Pick<WorkflowTemplate, 'stages'>,
  events: readonly Pick<WorkflowEvent, 'type' | 'to_stage_id' | 'payload' | 'created_at'>[],
  carried: ReadonlySet<string>
): { stageId: string; rows: FixToCarry[] } | null {
  const back = [...events].reverse().find((e) => e.type === 'stage_returned');
  const manuscript = back?.to_stage_id ? loneManuscript(template, back.to_stage_id) : null;
  const work = typeof back?.payload?.work === 'string' ? back.payload.work.trim() : '';
  if (!back || !manuscript || !work) return null;
  const key = `return:${back.created_at}`;
  return carried.has(key) ? null : { stageId: manuscript, rows: [{ key, text: `[went back for] ${work.slice(0, 1_100)}` }] };
}
