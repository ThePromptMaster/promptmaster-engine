/**
 * The stage digest: what a stage is allowed to know about the work before it.
 *
 * The backend is stateless, so the client assembles this. The rule that makes
 * it affordable is a size bound: **O(stages x constant), never O(project)**.
 * Sending the whole manuscript to generate a claim table would grow without
 * limit across thirteen stages and bury the instruction that matters, so each
 * completed upstream stage contributes at most a few hundred characters.
 *
 * The objective is the one exception, carried in full — it is short, and every
 * stage is judged against it.
 *
 * Summaries are read off the artifact when one has been stored (written when
 * the stage completes) and projected from the artifact's head version
 * otherwise, so a project that predates stored summaries still produces a
 * digest rather than an empty one.
 */

import type { Artifact, ArtifactVersion, Project } from '@/types/project';
import type { StageDefinition, WorkflowState, WorkflowTemplate } from './types';
import { parseItems, rendererHoldsItems } from './stage-artifact';

/** Per-stage budget. Twelve stages of this is a paragraph, not a book. */
export const SUMMARY_MAX = 320;

export interface StageDigestEntry {
  stage_id: string;
  label: string;
  summary: string;
}

export interface StageDigest {
  objective: string;
  audience: string;
  prior_stages: StageDigestEntry[];
}

function truncate(text: string, max = SUMMARY_MAX): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  // Cut at a word boundary so the summary reads as a sentence that stopped,
  // not as a string that was sliced.
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * Project a stage's artifact down to a few lines, deterministically.
 *
 * No model call. A stage summary that costs an LLM round-trip is a stage
 * summary that makes the next stage slower and can differ between two runs
 * over identical text, which reads to a user as a bug.
 */
export function summariseStageContent(
  stage: StageDefinition,
  content: string | null | undefined
): string {
  if (!content) return '';

  if (rendererHoldsItems(stage.renderer)) {
    const items = parseItems(content);
    if (!items) return truncate(content);
    if (items.length === 0) return '';
    // The first declared field of each row is the row's identity — the segment
    // name, the claim, the finding. That is what a later stage needs.
    const lines = items.slice(0, 8).map((item) => {
      const first = Object.entries(item).find(
        ([key, value]) => key !== 'id' && key !== 'status' && key !== 'reason' && (value ?? '').trim()
      );
      const text = first?.[1] ?? '';
      const status = item.status ? ` [${item.status}]` : '';
      return `${truncate(text, 90)}${status}`;
    });
    const more = items.length > 8 ? ` (+${items.length - 8} more)` : '';
    return truncate(`${lines.join('; ')}${more}`);
  }

  return truncate(content);
}

export interface StageArtifactBundle {
  artifact: Artifact | null;
  versions: ArtifactVersion[];
}

/**
 * Build the digest for the stage about to be generated.
 *
 * Only stages the user actually completed contribute. A skipped stage produced
 * no conclusion, and a stage marked stale is by definition no longer trusted;
 * feeding either forward would have the model build on something the user has
 * already walked away from.
 */
export function buildStageDigest(
  template: WorkflowTemplate,
  state: WorkflowState,
  project: Pick<Project, 'objective' | 'audience'>,
  bundles: Record<string, StageArtifactBundle>,
  upToStageId: string
): StageDigest {
  const cutoff = template.stages.findIndex((s) => s.id === upToStageId);
  const prior_stages: StageDigestEntry[] = [];

  template.stages.forEach((stage, index) => {
    if (cutoff >= 0 && index >= cutoff) return;
    if (state.stages[stage.id]?.status !== 'complete') return;

    const bundle = bundles[stage.id];
    const stored = bundle?.artifact?.summary?.trim();
    const head = bundle?.versions.at(-1)?.content;
    const summary = stored ? truncate(stored) : summariseStageContent(stage, head);
    if (!summary) return;

    prior_stages.push({ stage_id: stage.id, label: stage.label, summary });
  });

  return {
    objective: project.objective ?? '',
    audience: project.audience ?? '',
    prior_stages,
  };
}
