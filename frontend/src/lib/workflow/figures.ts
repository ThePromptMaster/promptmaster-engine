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
  /** Printed by code that ran, and recorded without a model reading it. */
  source?: 'sandbox';
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
  head: { id: string; content: string } | null | undefined,
  /** What is stored now: the figures a sandbox run printed are carried over, whatever the text says. */
  stored?: { figures?: Figure[] } | null
): Promise<StageFigures | null> {
  if (!head) return null;
  const printed = (stored?.figures ?? []).filter((f) => f.source === 'sandbox');
  const kept: StageFigures | null = printed.length ? { version_id: head.id, figures: printed } : null;
  const text = figureSourceText(stage, head.content);
  if (!/\d/.test(text)) return kept;
  const timeout = new Promise<StageFigures | null>((resolve) => setTimeout(() => resolve(kept), FIGURES_TIMEOUT_MS));
  const call = api
    .extractFigures({ stage_label: stage.label, content: text.slice(0, 400_000), model: project.model })
    .then((res) => ({ version_id: head.id, figures: mergeFigures(res.figures, printed) }))
    .catch(() => kept);
  return Promise.race([call, timeout]);
}

const MAX_RUN_FIGURES = 12;
const sameFigure = (a: Figure, b: Figure) => a.name.trim().toLowerCase() === b.name.trim().toLowerCase() && a.value.trim() === b.value.trim();

/** `extra` after `base`, without repeating a figure `base` already holds. */
export function mergeFigures(base: readonly Figure[], extra: readonly Figure[]): Figure[] {
  return [...base, ...extra.filter((f) => !base.some((b) => sameFigure(b, f)))];
}

/**
 * The labelled results a run printed — `label: value` or `label = value`
 * lines whose value holds a number. Pure, and no model is asked: these are
 * the code's own words (1 Oct, item 32). A traceback, a data dump or a line
 * of prose is not a figure, and is skipped.
 */
export function figuresFromOutput(stdout: string, runId: string): Figure[] {
  const out: Figure[] = [];
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.length > 160 || /^(Traceback|File "|[\[{(])/.test(line)) continue;
    const at = line.search(/[:=]/);
    if (at < 2) continue;
    const name = line.slice(0, at).trim();
    const value = line.slice(at + 1).replace(/^=+/, '').trim();
    if (!/[A-Za-z]/.test(name) || name.length > 80 || !/\d/.test(value) || value.length > 60) continue;
    const figure: Figure = { name, value, context: `Printed by sandbox run ${runId.slice(0, 8)}`, source: 'sandbox' };
    if (!out.some((f) => sameFigure(f, figure))) out.push(figure);
    if (out.length >= MAX_RUN_FIGURES) break;
  }
  return out;
}

/**
 * A run's figures added to what the stage has on record, tied to the stage's
 * head version. Figures an earlier version's text established are dropped —
 * they were about that text; what earlier runs printed is kept.
 */
export function withRunFigures(
  stored: { version_id?: string; figures?: Figure[] } | null | undefined,
  headVersionId: string,
  printed: readonly Figure[]
): StageFigures | null {
  if (!printed.length) return null;
  const before = (stored?.figures ?? []).filter((f) => stored?.version_id === headVersionId || f.source === 'sandbox');
  return { version_id: headVersionId, figures: mergeFigures(before, printed) };
}
