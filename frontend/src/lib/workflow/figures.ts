/**
 * Recording a stage's figures when it is completed, and handing them on.
 *
 * Later stages are given earlier ones as summaries of a few lines; the
 * numbers in them did not survive, so a validation stage re-derived one and
 * got a different answer (1 Oct, item 32). When a stage is completed, its
 * figures are read out once (`/api/extract-figures`, which keeps a value only
 * if the stage's own text contains it exactly) and stored on its artifact
 * with the version they came from. `establishedFigures` (digest.ts) is what
 * later stages are given: only from stages that are done, and only while the stored
 * figures are still about the stage's head version — an edit after
 * completion makes them stale, and stale figures are not passed on.
 */

import { api } from '@/lib/api/client';
import { itemSchemaFor, rendererHoldsItems, stageContentForChat } from './stage-artifact';
import type { StageDefinition } from './types';
import type { Project } from '@/types/project';

export interface Figure {
  name: string;
  value: string;
  context: string;
}

/** What is stored on `artifacts.key_figures`. */
export interface StageFigures {
  version_id: string;
  figures: Figure[];
}

/** Give up waiting after this long: a stage move must not hang on a nicety. */
export const FIGURES_TIMEOUT_MS = 12_000;

/** The stage's work as text a reader would follow (rows are rendered, not sent as JSON). */
export function figureSourceText(stage: StageDefinition, content: string): string {
  return rendererHoldsItems(stage.renderer) ? stageContentForChat(itemSchemaFor(stage), content) : content;
}

/**
 * Read the figures out of a stage's head version. Resolves to null when there
 * is nothing to read, when it takes too long, or when the call fails — never
 * rejects: completing a stage does not depend on this.
 */
export async function readStageFigures(
  project: Pick<Project, 'model'>,
  stage: StageDefinition,
  head: { id: string; content: string } | null | undefined
): Promise<StageFigures | null> {
  const text = head ? figureSourceText(stage, head.content) : '';
  if (!head || !/\d/.test(text)) return null;
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), FIGURES_TIMEOUT_MS));
  const call = api
    .extractFigures({ stage_label: stage.label, content: text.slice(0, 400_000), model: project.model })
    .then((res) => ({ version_id: head.id, figures: res.figures }))
    .catch(() => null);
  return Promise.race([call, timeout]);
}
