/**
 * The one saved text a project delivers (5 Nov, a six-chapter book test). Pure.
 *
 * A designed workflow can write the chapters on a long-form stage and then finish
 * them on a prose stage: "Finished book and review note". `deliverableStage` says
 * the chapters are the deliverable, which is right for Book and Research, where
 * Revision and Editing rewrite them in place. Here it meant two copies. The review's
 * corrections went into the finished stage, while the export, the objective check
 * and "Have Go fix it" all used the chapters. The client's download had Sam approving
 * 2:30; Go, describing the finished stage, said 2pm on three conditions.
 *
 * What holds the work is read from the text, not the stage's name: a later required
 * prose stage is the deliverable only if it holds the work. A stage that only holds
 * a note goes after the chapters. Between the two it may be a partial retype (a long
 * book does not fit one prose stage), so the chapters stay, with a notice. Either
 * way nothing written is lost, and nothing is printed twice.
 */
import { manuscriptArtifactFor } from './context';
import { formatManuscript, type StageArtifactBundle } from './digest';
import { deliverableStage } from './engine';
import type { StageDefinition, WorkflowTemplate } from './types';

/** A later prose stage holding at least this share of the chapters' words holds the work. */
export const HOLDS_THE_WORK = 0.8;
/** Under this share it is a note on the work, not a copy of it. */
export const ONLY_A_NOTE = 0.15;

type Head = StageArtifactBundle['versions'][number];

export interface DeliverableDocument {
  /** The stage the project delivers: what is judged, and what a repair reopens. */
  stage: StageDefinition;
  /** The saved version that is exactly this text; null when no version is. */
  version: Head | null;
  text: string;
  /** A later stage shorter than the chapters but more than a note: the chapters are delivered, and this is said. */
  partial?: { label: string; chapters: string };
}

const wordsIn = (text: string) => text.split(/\s+/).filter(Boolean).length;

function headWithText(bundles: Record<string, StageArtifactBundle>, stageId: string): Head | null {
  const head = bundles[stageId]?.versions.at(-1);
  return head && (head.content ?? '').trim() ? head : null;
}

export function deliverableDocument(template: WorkflowTemplate, bundles: Record<string, StageArtifactBundle>): DeliverableDocument | null {
  const base = deliverableStage(template);
  if (!base) return null;
  if (base.renderer !== 'long_form') {
    const head = bundles[base.id]?.versions.at(-1) ?? null;
    return { stage: base, version: head, text: head?.content ?? '' };
  }
  const chapters = formatManuscript(manuscriptArtifactFor(template, base, bundles)?.long_form?.outline ?? [], Number.POSITIVE_INFINITY);
  const saved = bundles[base.id]?.versions.at(-1);
  const manuscript: DeliverableDocument = { stage: base, version: saved && saved.content === chapters ? saved : null, text: chapters };

  const lastLongForm = template.stages.map((s) => s.renderer).lastIndexOf('long_form');
  const later = template.stages
    .slice(lastLongForm + 1)
    .filter((s) => s.required && s.renderer === 'prose' && headWithText(bundles, s.id))
    .reverse();
  if (!later.length) return manuscript;

  const total = wordsIn(chapters);
  const share = (s: StageDefinition) => (total ? wordsIn(headWithText(bundles, s.id)!.content) / total : 1);
  const holder = later.find((s) => share(s) >= HOLDS_THE_WORK);
  if (holder) {
    const head = headWithText(bundles, holder.id)!;
    return { stage: holder, version: head, text: head.content };
  }
  const last = later[0];
  if (share(last) < ONLY_A_NOTE) {
    return { stage: base, version: null, text: `${chapters}\n\n## ${last.label}\n\n${headWithText(bundles, last.id)!.content.trim()}` };
  }
  return { ...manuscript, partial: { label: last.label, chapters: base.label } };
}
