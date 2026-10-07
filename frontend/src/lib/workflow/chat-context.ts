/**
 * What the side chat is told about where the user is. Pure.
 *
 * Given only the brief and the text on screen, the chat asked the client to
 * "paste the full text of all three chapters back in the box" and to copy the
 * outline in (3 Oct call). It also named buttons the page did not have. The
 * project already holds all of it; this assembles it from the same helpers the
 * stage digest and Go's planner use.
 */

import { buildStageDigest, formatManuscript, type StageArtifactBundle } from './digest';
import { draftingStageId } from './derived-outline';
import { stageContentForChat, itemSchemaFor } from './stage-artifact';
import { parseOutlineDocument } from '@/lib/outline/model';
import { PLACE_WORDS, type StageControl } from './stage-controls';
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
const GO_STEPS_MAX = 12;

export function buildChatContext(input: {
  template: WorkflowTemplate;
  state: WorkflowState;
  project: Pick<Project, 'objective' | 'audience' | 'data_files'>;
  stage: StageDefinition;
  bundles: Record<string, StageArtifactBundle>;
  /** The page's buttons; null for a stage the user is only browsing. */
  controls: StageControl[] | null;
  /** The latest Go run and its steps, so the chat answers "why did it stop?" from the record. */
  goRun?: {
    run: { status: string; policy: string; stop_reason: string | null } | null;
    steps: readonly { action_key: string; status: string; execution_label: string | null; block_kind?: string | null; output: string }[];
    objective?: string;
  };
}): ChatContext {
  const { template, state, project, stage, bundles, controls, goRun } = input;
  const digest = buildStageDigest(template, state, project, bundles, stage.id);
  // A chapter stage's own text already is the manuscript; sending it twice
  // would double the cost of every message.
  const manuscript = stage.renderer === 'long_form'
    ? ''
    : formatManuscript(sectionsOf(template, bundles), CHAT_MANUSCRIPT_MAX);
  return {
    stage_label: stage.label,
    stage_instruction: (stage.entry_prompt_hint ?? '').slice(0, 4_000),
    workflow_label: template.name,
    workflow_stages: template.stages.map((s) => s.label),
    prior_stages: digest.prior_stages,
    outline: stage.renderer === 'outline' ? '' : outlineOf(template, bundles),
    manuscript,
    buttons: controls
      ? controls.slice(0, BUTTONS_MAX).map((c) => ({ label: c.label, where: PLACE_WORDS[c.place] }))
      : null,
    go_run: goRun?.run
      ? {
          status: goRun.run.status,
          policy: goRun.run.policy,
          stop_reason: (goRun.run.stop_reason ?? '').slice(0, 2_000),
          steps: goRun.steps
            .filter((s) => s.status !== 'running')
            .slice(-GO_STEPS_MAX)
            .map((s) => ({
              action: s.action_key,
              status: s.status,
              execution_label: s.execution_label,
              block_kind: s.block_kind ?? null,
              output: s.output.slice(0, 400),
            })),
          objective: (goRun.objective ?? '').slice(0, 2_000),
        }
      : null,
  };
}
