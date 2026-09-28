/**
 * What the planner is told about the project (B2's AgentState). Pure.
 *
 * The same shape the backend validates; trimmed here because the planner runs
 * on every step and a whole manuscript in every call would be paying for the
 * same context over and over.
 *
 * Until B0 the excerpt was the stage's head version and nothing else. The
 * Outline stage keeps its outline on a separate artifact and the long-form
 * stages keep their chapters in `artifacts.long_form`, so on both the planner
 * read "(empty — nothing drafted yet)" on a finished book and chose
 * mark_blocked (Sean, 28 Sep, items 1 and 2, screenshot 3). The digest now
 * says what exists: the outline, the sections written, the findings decided.
 */

import { countNamedSections, parseOutlineDocument } from '@/lib/outline/model';
import { manuscriptArtifactFor } from '@/lib/workflow/context';
import { formatManuscript, type StageArtifactBundle } from '@/lib/workflow/digest';
import { nextSuggestedStage } from '@/lib/workflow/engine';
import { effectiveRenderer, isTriaged, itemSchemaFor, parseItems } from '@/lib/workflow/stage-artifact';
import type { StageContext, StageDefinition, StageEvaluation, WorkflowState, WorkflowTemplate } from '@/lib/workflow/types';
import type { OutlineSection } from '@/types';
import type { AgentStep } from '@/types/agent';
import type { Evaluation } from '@/types/project';
import type { AgentTools } from './policy';
import { NO_TOOLS } from './policy';

/** The backend's cap on `artifact_excerpt` (AgentState in promptmaster/agent.py) — marker included. */
export const ARTIFACT_EXCERPT_CHARS = 12_000;
/** A manuscript is excerpted shorter: the planner needs its shape, not its text. */
export const MANUSCRIPT_EXCERPT_CHARS = 6_000;
const TRIMMED = '\n[… trimmed …]';
export const RECENT_STEPS = 8;
const LIST_MAX = 60;
const SAMPLE_MAX = 8;

export interface AgentStateDigest {
  stage_id: string;
  stage_label: string;
  stage_instruction: string;
  artifact_excerpt: string;
  criteria_met: string[];
  criteria_unmet: string[];
  evaluation: string;
  next_stage_label: string;
  prior_stages: string[];
  recent_steps: { action_key: string; status: string; execution_label: string | null; output: string }[];
  outline?: { sections: string[]; named_count: number; approved: boolean };
  manuscript?: { total: number; complete: number; pending_jobs: number; written: string[]; unwritten: string[] };
  findings?: { total: number; triaged: number; sample: string[] };
  tools: AgentTools;
}

function cap(text: string, max: number): string {
  // The marker counts against the cap: slicing to the full cap and then
  // appending it made every stage over 12,000 characters a 422, and Go mode
  // could not take a single step on it.
  return text.length > max ? text.slice(0, max - TRIMMED.length) + TRIMMED : text;
}

function firstField(item: Record<string, string | undefined>): string {
  const entry = Object.entries(item).find(
    ([key, value]) => key !== 'id' && key !== 'status' && key !== 'reason' && (value ?? '').trim()
  );
  return (entry?.[1] ?? '').replace(/\s+/g, ' ').trim().slice(0, 140);
}

export function buildAgentState(input: {
  template: WorkflowTemplate;
  state: WorkflowState;
  stage: StageDefinition;
  bundles: Record<string, StageArtifactBundle>;
  stageEvaluation: StageEvaluation;
  latestEvaluation?: Evaluation | null;
  steps: readonly AgentStep[];
  /** Per-stage facts (A1): the review counts come from here. */
  context?: StageContext;
  /** The approved outline drafting is bound to, if any. */
  approvedOutline?: readonly OutlineSection[];
  /** How many section jobs are still queued or running on this stage's manuscript. */
  pendingJobs?: number;
  tools?: AgentTools;
}): AgentStateDigest {
  const { template, state, stage, bundles, stageEvaluation, latestEvaluation, steps, context, approvedOutline = [], pendingJobs = 0 } = input;
  const tools = input.tools ?? NO_TOOLS;
  const head = bundles[stage.id]?.versions.at(-1)?.content ?? '';
  const next = nextSuggestedStage(template, state);
  const index = template.stages.findIndex((s) => s.id === stage.id);
  const ev = latestEvaluation;
  const renderer = effectiveRenderer(stage);

  let excerpt = head;
  let outline: AgentStateDigest['outline'];
  let manuscript: AgentStateDigest['manuscript'];
  let findings: AgentStateDigest['findings'];

  if (stage.renderer === 'outline') {
    const doc = parseOutlineDocument(head);
    const sections = doc.items.map((s, i) => `${i + 1}. ${s.title.trim() || 'Untitled'}${s.abstract?.trim() ? ` — ${s.abstract.trim().slice(0, 120)}` : ''}`);
    outline = { sections: sections.slice(0, LIST_MAX), named_count: countNamedSections(doc), approved: approvedOutline.length > 0 };
    excerpt = sections.join('\n');
  } else if (stage.renderer === 'long_form') {
    const sections = manuscriptArtifactFor(template, stage, bundles)?.long_form?.outline ?? [];
    const written = sections.filter((s) => s.status === 'complete');
    const label = (s: { title: string }, i: number) => `${i + 1}. ${s.title || 'Untitled section'}`;
    manuscript = {
      total: sections.length,
      complete: written.length,
      pending_jobs: pendingJobs,
      written: sections.map(label).filter((_, i) => sections[i].status === 'complete').slice(0, LIST_MAX),
      unwritten: sections.map(label).filter((_, i) => sections[i].status !== 'complete').slice(0, LIST_MAX),
    };
    excerpt = cap(formatManuscript(sections, Number.POSITIVE_INFINITY), MANUSCRIPT_EXCERPT_CHARS);
  } else if (renderer === 'review') {
    const items = parseItems(head) ?? [];
    const schema = itemSchemaFor(stage);
    const counts = context?.findings[stage.id] ?? { total: items.length, triaged: items.filter((i) => isTriaged(i, schema)).length };
    findings = {
      ...counts,
      sample: items.filter((i) => !isTriaged(i, schema)).slice(0, SAMPLE_MAX).map(firstField).filter(Boolean),
    };
    // Rows as "[status] finding" lines: what a reviewer needs, at a fraction
    // of the JSON document's size.
    excerpt = items.map((i) => `[${i.status || 'undecided'}] ${firstField(i)}`).join('\n');
  }

  return {
    stage_id: stage.id,
    stage_label: stage.label,
    stage_instruction: stage.entry_prompt_hint || stage.entry_guidance,
    artifact_excerpt: cap(excerpt, ARTIFACT_EXCERPT_CHARS),
    criteria_met: stageEvaluation.criteria.filter((c) => c.satisfied).map((c) => c.label),
    // A box only the user ticks cannot be satisfied by rewriting the draft —
    // without saying so, a real planner revised three times to tick one (B4).
    criteria_unmet: stageEvaluation.unmet.map((c) =>
      c.manual ? `${c.label} (ticked by the user when satisfied — revising cannot satisfy it)` : c.label
    ),
    evaluation: ev
      ? `alignment ${ev.alignment_score}, clarity ${ev.clarity_score}, drift ${ev.drift_score}` +
        (ev.findings?.length ? `; ${ev.findings.length} finding(s)` : '') +
        // PM-25: the evaluator's own "no further pass needed" reaches the planner.
        (ev.further_pass_needed === false
          ? `; evaluator: no further AI pass needed${ev.further_pass_reason ? ` (${ev.further_pass_reason})` : ''}`
          : '')
      : '',
    next_stage_label: next ? (template.stages.find((s) => s.id === next)?.label ?? next) : '',
    prior_stages: template.stages
      .slice(0, Math.max(0, index))
      .map((s) => `${s.label}: ${state.stages[s.id]?.status ?? 'not_started'}`),
    recent_steps: steps
      .filter((s) => s.status !== 'running')
      .slice(-RECENT_STEPS)
      .map((s) => ({
        action_key: s.action_key,
        status: s.status,
        execution_label: s.execution_label,
        output: s.output.slice(0, 600),
      })),
    ...(outline ? { outline } : {}),
    ...(manuscript ? { manuscript } : {}),
    ...(findings ? { findings } : {}),
    tools,
  };
}
