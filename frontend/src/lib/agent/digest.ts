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
 *
 * It still read them from the store's bundles, which lag the section jobs and
 * never held the outline panel's working copy, while the loop chose its moves
 * from a fresh read (facts.ts). When `facts` is passed, the outline and the
 * manuscript come from that same read (1 Oct, item 1).
 */

import { countNamedSections, parseOutlineDocument } from '@/lib/outline/model';
import { manuscriptArtifactFor } from '@/lib/workflow/context';
import { formatManuscript, type DataFileBrief, type StageArtifactBundle } from '@/lib/workflow/digest';
import { nextSuggestedStage } from '@/lib/workflow/engine';
import { effectiveRenderer, isTriaged, itemSchemaFor, parseItems } from '@/lib/workflow/stage-artifact';
import type { StageContext, StageDefinition, StageEvaluation, WorkflowState, WorkflowTemplate } from '@/lib/workflow/types';
import type { OutlineSection } from '@/types';
import type { AgentStep } from '@/types/agent';
import type { Evaluation } from '@/types/project';
import type { AgentTools } from './policy';
import { NO_TOOLS } from './policy';
import type { StageFacts } from './facts';

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
  /** `complete` counts the sections that hold text. */
  manuscript?: { total: number; complete: number; pending_jobs: number; written: string[]; unwritten: string[] };
  findings?: { total: number; triaged: number; sample: string[] };
  /** What the user has already decided on this project (lib/agent/memory.ts). */
  memory?: string[];
  /** The project's data files, so the planner knows a computation has something to read. */
  data_files?: DataFileBrief[];
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
  /**
   * Whether any outline version is approved, read fresh (B1 facts). The
   * workspace's `approvedOutline` lags by a render right after the approve
   * card's own button, and the planner then asked for an approval that had
   * just been given (production pass, 2026-09-29).
   */
  outlineApproved?: boolean;
  /** How many section jobs are still queued or running on this stage's manuscript. */
  pendingJobs?: number;
  tools?: AgentTools;
  /** What the stage holds, read fresh. Preferred over `bundles` wherever both know. */
  facts?: StageFacts;
  dataFiles?: DataFileBrief[];
  memory?: string[];
}): AgentStateDigest {
  const { template, state, stage, bundles, stageEvaluation, latestEvaluation, steps, context, approvedOutline = [], facts } = input;
  const pendingJobs = facts?.manuscript?.pendingJobs.length ?? input.pendingJobs ?? 0;
  const outlineApproved = facts?.outline?.approved ?? facts?.outlineApproved ?? input.outlineApproved ?? approvedOutline.length > 0;
  const dataFiles = input.dataFiles ?? [];
  const tools = dataFiles.length ? { ...(input.tools ?? NO_TOOLS), datasets: true } : (input.tools ?? NO_TOOLS);
  const head = bundles[stage.id]?.versions.at(-1)?.content ?? '';
  const next = nextSuggestedStage(template, state);
  const index = template.stages.findIndex((s) => s.id === stage.id);
  const ev = latestEvaluation;
  const renderer = effectiveRenderer(stage);

  let excerpt = head;
  let outline: AgentStateDigest['outline'];
  let manuscript: AgentStateDigest['manuscript'];
  let findings: AgentStateDigest['findings'];

  const outlineLine = (s: { title: string; abstract?: string }, i: number) =>
    `${i + 1}. ${s.title.trim() || 'Untitled'}${s.abstract?.trim() ? ` — ${s.abstract.trim().slice(0, 120)}` : ''}`;

  if (stage.renderer === 'outline') {
    // The working copy when there is one: it is what the user sees in the panel.
    const doc = facts?.outline?.doc ?? parseOutlineDocument(head);
    const sections = doc.items.map(outlineLine);
    outline = { sections: sections.slice(0, LIST_MAX), named_count: facts?.outline?.namedSections ?? countNamedSections(doc), approved: outlineApproved };
    excerpt = sections.join('\n');
  } else if (stage.renderer === 'long_form') {
    const sections = facts?.manuscript?.outline ?? manuscriptArtifactFor(template, stage, bundles)?.long_form?.outline ?? [];
    // Written means the section holds text. A section whose last job failed
    // but whose text is on the page was listed as unwritten, and the planner
    // was shown a manuscript with holes the user could not see.
    const hasText = (s: OutlineSection) => (s.content ?? '').trim().length > 0;
    const label = (s: OutlineSection, i: number) =>
      `${i + 1}. ${s.title || 'Untitled section'}${hasText(s) && s.status !== 'complete' ? ` (text kept; last write ${s.status})` : ''}`;
    manuscript = {
      total: sections.length,
      complete: sections.filter(hasText).length,
      pending_jobs: pendingJobs,
      written: sections.map(label).filter((_, i) => hasText(sections[i])).slice(0, LIST_MAX),
      unwritten: sections.map(label).filter((_, i) => !hasText(sections[i])).slice(0, LIST_MAX),
    };
    excerpt = cap(formatManuscript(sections, Number.POSITIVE_INFINITY), MANUSCRIPT_EXCERPT_CHARS);
    // A drafting stage that also holds the outline (a derived one): until
    // sections exist, the outline is what there is to see.
    if (facts?.outline) {
      const lines = facts.outline.doc.items.map(outlineLine);
      outline = { sections: lines.slice(0, LIST_MAX), named_count: facts.outline.namedSections, approved: outlineApproved };
      if (!sections.length && lines.length) excerpt = `The outline, ${outlineApproved ? 'approved' : 'not yet approved'}:\n${lines.join('\n')}`;
    }
  } else if (!head.trim() && stage.exit_criteria.some((c) => c.rule?.type === 'outline_approved')) {
    // A stage whose work is approving the outline holds nothing of its own.
    // Shown as empty, the planner asked the user to "generate the outline"
    // that was already written and approved.
    const outlineStage = template.stages.find((s) => s.renderer === 'outline');
    const saved = parseOutlineDocument(outlineStage ? (bundles[outlineStage.id]?.versions.at(-1)?.content ?? '') : '');
    const items = approvedOutline.length ? approvedOutline : saved.items;
    const sections = items.map(outlineLine);
    if (sections.length) {
      outline = { sections: sections.slice(0, LIST_MAX), named_count: items.filter((i) => i.title.trim()).length, approved: outlineApproved };
      excerpt = `${outlineApproved ? 'The approved outline' : 'The outline waiting for the user\'s approval'}:\n${sections.join('\n')}`;
    }
  } else if (renderer === 'review') {
    const items = parseItems(head) ?? [];
    const schema = itemSchemaFor(stage);
    const counts = context?.findings[stage.id] ?? { total: items.length, triaged: items.filter((i) => isTriaged(i, schema)).length };
    findings = {
      ...counts,
      sample: items.filter((i) => !isTriaged(i, schema)).slice(0, SAMPLE_MAX).map(firstField).filter(Boolean),
    };
    // Rows as "[status] finding" lines: what a reviewer needs, at a fraction
    // of the JSON document's size. Numbered where a computation can carry a
    // row out, so the planner can say which one it is running.
    excerpt = items.map((i, n) => `${schema.execution ? `${n + 1}. ` : ''}[${i.status || 'undecided'}] ${firstField(i)}`).join('\n');
    if (schema.execution && items.length && dataFiles.length) {
      excerpt +=
        `\n\nA row that is not "${schema.execution.status}" can be carried out with run_computation when the project's data allows it: ` +
        'give the row\'s number as `row`, and a run that executes is recorded on that row. A row no code can carry out is the user\'s to decide.';
    }
  }

  return {
    stage_id: stage.id,
    stage_label: stage.label,
    stage_instruction: stage.entry_prompt_hint || stage.entry_guidance,
    artifact_excerpt: cap(excerpt, ARTIFACT_EXCERPT_CHARS),
    criteria_met: stageEvaluation.criteria.filter((c) => c.satisfied).map((c) => c.label),
    // A box only the user ticks cannot be satisfied by rewriting the draft —
    // without saying so, a real planner revised three times to tick one (B4).
    // A box the user has not ticked on an optional criterion is not a reason
    // to stop either: the stage can be left with it open. Left unsaid, the
    // planner asked about "Every audience need maps to a section" before
    // moving on from an approved outline.
    criteria_unmet: stageEvaluation.unmet.map((c) => {
      const notes = [
        ...(c.manual ? ['ticked by the user when satisfied — revising cannot satisfy it'] : []),
        ...(c.blocking ? [] : ['optional — moving on does not need it; do not ask about it']),
      ];
      return notes.length ? `${c.label} (${notes.join('; ')})` : c.label;
    }),
    evaluation: ev
      ? `alignment ${ev.alignment_score}, clarity ${ev.clarity_score}, drift ${ev.drift_score}` +
        (ev.findings?.length ? `; ${ev.findings.length} finding(s)` : '') +
        // PM-25: the evaluator's own "no further pass needed" reaches the planner.
        (ev.further_pass_needed === false
          ? `; evaluator: no further AI pass needed${ev.further_pass_reason ? ` (${ev.further_pass_reason})` : ''}`
          : '')
      : '',
    next_stage_label: next ? (template.stages.find((s) => s.id === next)?.label ?? next) : '',
    // A stage moved past with a requirement unticked stays "in progress, left
    // open"; only the user can close it, so the planner is told not to ask.
    prior_stages: template.stages
      .slice(0, Math.max(0, index))
      .map((s) => {
        const st = state.stages[s.id];
        return st?.status === 'in_progress' && st.left_open
          ? `${s.label}: left open (moved past; only the user can close it — nothing for you to do there)`
          : `${s.label}: ${st?.status ?? 'not_started'}`;
      }),
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
    ...(input.memory?.length ? { memory: input.memory } : {}),
    ...(dataFiles.length ? { data_files: dataFiles } : {}),
    tools,
  };
}
