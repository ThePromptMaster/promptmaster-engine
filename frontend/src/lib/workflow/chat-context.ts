/**
 * What the side chat is told about where the user is. Pure.
 *
 * Given only the brief and the text on screen, the chat asked the client to
 * "paste the full text of all three chapters back in the box" and to copy the
 * outline in (3 Oct call). It also named buttons the page did not have. The
 * project already holds all of it; this assembles it from the same helpers the
 * stage digest and Go's planner use.
 */

import { describePreview } from '@/lib/data/preview';
import { buildStageDigest, formatManuscript, type StageArtifactBundle } from './digest';
import { measuredLines } from './context';
import { draftingStageId } from './derived-outline';
import { stageContentForChat, itemSchemaFor } from './stage-artifact';
import { parseOutlineDocument } from '@/lib/outline/model';
import { PLACE_WORDS, type StageControl } from './stage-controls';
import { madeBy } from './chat-changes';
import type { StageDefinition, WorkflowState, WorkflowTemplate } from './types';
import type { ChatContext, OutlineSection } from '@/types';
import type { Project } from '@/types/project';

/** Chat runs on every message, so the chapters are bounded tighter than a review's. */
export const CHAT_MANUSCRIPT_MAX = 60_000;
const OUTLINE_MAX = 30_000;
const BUTTONS_MAX = 40;

/** "1. Title — what it covers", one per line. */
export function outlineLines(items: readonly { title: string; abstract?: string }[]): string {
  return items
    .filter((i) => (i.title ?? '').trim() || (i.abstract ?? '').trim())
    .map((i, n) => `${n + 1}. ${(i.title ?? '').trim() || 'Untitled section'}${(i.abstract ?? '').trim() ? ` — ${i.abstract!.trim()}` : ''}`)
    .join('\n')
    .slice(0, OUTLINE_MAX);
}

/** The chapters the project holds, wherever they were drafted. */
function sectionsOf(template: WorkflowTemplate, bundles: Record<string, StageArtifactBundle>): OutlineSection[] {
  const drafting = draftingStageId(template);
  return (drafting ? bundles[drafting]?.artifact?.long_form?.outline : undefined) ?? [];
}

/** The outline: the approved one drafting works to, else the Outline stage's latest version. */
function outlineOf(template: WorkflowTemplate, bundles: Record<string, StageArtifactBundle>): string {
  const sections = sectionsOf(template, bundles);
  if (sections.length) return outlineLines(sections);
  const outlineStage = template.stages.find((s) => s.renderer === 'outline');
  const content = outlineStage ? bundles[outlineStage.id]?.versions.at(-1)?.content : undefined;
  return content ? outlineLines(parseOutlineDocument(content).items) : '';
}

/**
 * The text of the stage on screen, as the chat reads it. An outline stage
 * stores JSON with titles and abstracts, which the generic table reader turned
 * into blank lines; a chapter stage keeps its text in the chapters, not in a
 * version.
 */
export function chatContentFor(
  template: WorkflowTemplate,
  stage: StageDefinition,
  bundles: Record<string, StageArtifactBundle>,
  versionContent: string
): string {
  if (stage.renderer === 'outline') return outlineLines(parseOutlineDocument(versionContent).items);
  if (stage.renderer === 'long_form') {
    const written = formatManuscript(sectionsOf(template, bundles), CHAT_MANUSCRIPT_MAX);
    return written || versionContent;
  }
  return stageContentForChat(itemSchemaFor(stage), versionContent);
}

/** Go steps the chat is shown: enough to answer "why did it stop?". */
export const GO_STEPS_MAX = 12;
/**
 * How much of a step's output the chat reads (17 Nov: a cut at 400 dropped "still being
 * written when the wait ran out", and the chat misread the run).
 */
export const STEP_OUTPUT_SENT = 1_200;

type ChatStep = NonNullable<ChatContext['go_run']>['steps'][number];

/**
 * One Go step as the chat reads it, live or from the record (26 Nov, Sean: "the side chat
 * lags behind"). The record's copy cut each step to 400 characters with no stage, so the
 * chat read less than the page did; one formatter now serves both. A step still running
 * is sent too, as running, so the chat knows what Go is doing now.
 */
export function chatStep(
  s: { action_key: string; status: string; execution_label: string | null; block_kind?: string | null; output?: string | null; stage_id?: string | null; params?: Record<string, unknown> | null; started_at?: string | null },
  stageName: (stageId: string) => string | undefined,
  now = Date.now()
): ChatStep {
  const stageId = String(s.params?.stage_id ?? '') || s.stage_id || '';
  const stage = stageId ? stageName(stageId) : undefined;
  const started = Date.parse(s.started_at ?? '');
  const runningFor = s.status === 'running' && Number.isFinite(started) ? Math.max(0, Math.round((now - started) / 60_000)) : null;
  return {
    action: s.action_key,
    status: s.status,
    execution_label: s.execution_label,
    block_kind: s.block_kind ?? null,
    output: (s.output ?? '').slice(0, STEP_OUTPUT_SENT),
    ...(stage ? { stage: stage.slice(0, 200) } : {}),
    ...(runningFor !== null ? { running_minutes: runningFor } : {}),
  };
}
const FILES_MAX = 40;
/** Versions the chat is shown: the latest, which is what it is asked about. */
const VERSIONS_MAX = 8;

/** The stage's status in words (31 Oct): done, in progress, reopened and why, stuck and why. */
export function stageStatusLine(st: WorkflowState['stages'][string] | undefined): string {
  if (!st) return 'not started';
  const clip = (s: string) => (s.length > 400 ? `${s.slice(0, 399)}…` : s);
  switch (st.status) {
    case 'stale':
      return `reopened, waiting for a recheck: ${clip(st.stale?.reason ?? 'something it relied on changed')}`;
    case 'blocked': {
      const kinds = (st.blocked?.kinds ?? (st.blocked ? [st.blocked.kind] : [])).map((k) => k.replace(/_/g, ' '));
      return `marked stuck${kinds.length ? ` (${kinds.join(', ')})` : ''}: ${clip(st.blocked?.reason ?? '')}`;
    }
    default:
      return st.status.replace(/_/g, ' ');
  }
}

export function buildChatContext(input: {
  template: WorkflowTemplate;
  state: WorkflowState;
  project: Pick<Project, 'objective' | 'audience' | 'data_files'> & Partial<Pick<Project, 'constraints' | 'output_format' | 'facts' | 'code_runs'>>;
  stage: StageDefinition;
  bundles: Record<string, StageArtifactBundle>;
  /** The page's buttons; null for a stage the user is only browsing. */
  controls: StageControl[] | null;
  /** The latest Go run and its steps, so the chat answers "why did it stop?" from the record. */
  goRun?: {
    run: { status: string; policy: string; stop_reason: string | null; questions?: readonly string[] } | null;
    steps: readonly { action_key: string; status: string; execution_label: string | null; block_kind?: string | null; output: string; stage_id?: string; params?: Record<string, unknown>; started_at?: string | null }[];
    objective?: string;
    /** What Go says it is doing now, as the page shows it ("4 of 12 sections written"). */
    progress?: string | null;
    /** The stage Go is working on now. */
    currentStageId?: string | null;
  };
  /** The version on screen; the latest when not given. */
  shownVersionId?: string | null;
  /**
   * Names as the page shows them, in the interface's language (client, 21
   * Oct): the chat and Go then name the stage and its buttons in the words
   * the user can see. The template's own words otherwise.
   */
  display?: { stageName: (s: StageDefinition) => string; workflowName: string };
}): ChatContext {
  const { template, state, project, stage, bundles, controls, goRun, display, shownVersionId } = input;
  const versions = bundles[stage.id]?.versions ?? [];
  const shown = (shownVersionId && versions.find((v) => v.id === shownVersionId)) || versions.at(-1);
  const nameOf = display?.stageName ?? ((s: StageDefinition) => s.label);
  const stageNameOf = (id: string) => {
    const found = template.stages.find((x) => x.id === id);
    return found ? nameOf(found) : undefined;
  };
  const digest = buildStageDigest(template, state, project, bundles, stage.id);
  // A chapter stage's own text already is the manuscript; sending it twice
  // would double the cost of every message.
  const manuscript = stage.renderer === 'long_form'
    ? ''
    : formatManuscript(sectionsOf(template, bundles), CHAT_MANUSCRIPT_MAX);
  return {
    stage_label: nameOf(stage),
    stage_instruction: (stage.entry_prompt_hint ?? '').slice(0, 4_000),
    workflow_label: display?.workflowName ?? template.name,
    workflow_stages: template.stages.map(nameOf),
    // Every stage's status, not only this one's (26 Nov: the chat lagged behind what Go had finished
    // while the user looked at an earlier stage).
    workflow_stage_status: template.stages.map((s) => stageStatusLine(state.stages[s.id]).slice(0, 300)),
    prior_stages: digest.prior_stages,
    outline: stage.renderer === 'outline' ? '' : outlineOf(template, bundles),
    manuscript,
    buttons: controls
      // What each does, so the chat picks a button by its effect (17 Nov: "Realign" for a retitle).
      ? controls.slice(0, BUTTONS_MAX).map((c) => ({ label: c.label, where: PLACE_WORDS[c.place], ...(c.does ? { does: c.does.slice(0, 300) } : {}) }))
      : null,
    go_run: goRun?.run
      ? {
          status: goRun.run.status,
          policy: goRun.run.policy,
          stop_reason: (goRun.run.stop_reason ?? '').slice(0, 2_000),
          steps: goRun.steps.slice(-GO_STEPS_MAX).map((s) => chatStep(s, stageNameOf)),
          objective: (goRun.objective ?? '').slice(0, 2_000),
          ...(goRun.progress?.trim() ? { progress: goRun.progress.trim().slice(0, 600) } : {}),
          ...(goRun.currentStageId && stageNameOf(goRun.currentStageId) ? { current_stage: stageNameOf(goRun.currentStageId)!.slice(0, 200) } : {}),
          ...(goRun.run.questions?.length ? { questions: goRun.run.questions.slice(0, 8).map((q) => q.slice(0, 600)) } : {}),
        }
      : null,
    files: (project.data_files ?? []).slice(0, FILES_MAX).map((f) => ({ name: f.name.slice(0, 300), note: describePreview(f.preview).slice(0, 600) })),
    stage_status: stageStatusLine(state.stages[stage.id]),
    // What code counted on the text on screen, so a count in the chat comes
    // from here (8 Nov: a card said 236 words, the chat had said 170).
    ...(shown?.content
      ? {
          measured: measuredLines({ ...project, constraints: project.constraints ?? '' }, template, stage, shown.content)
            .slice(0, 20)
            .map((m) => `${m.label}: ${m.value}${m.met === false ? ' (not met)' : ''}`.slice(0, 400)),
          measured_version: shown.version_number,
        }
      : {}),
    versions: versions.slice(-VERSIONS_MAX).map((v) => ({
      number: v.version_number,
      made_by: madeBy(v.source_operation),
      cut_off: v.finish_reason === 'length',
      shown: v.id === shown?.id,
    })),
  };
}
