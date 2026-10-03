/**
 * The stage digest: what a stage is allowed to know about the work before it.
 *
 * The backend is stateless, so the client assembles this. The rule that makes
 * it affordable is a size bound: **O(stages x constant), never O(project)**.
 * Sending the whole manuscript to generate a claim table would grow without
 * limit across thirteen stages and bury the instruction that matters, so each
 * completed upstream stage contributes at most a few hundred characters.
 *
 * The objective is carried in full — it is short, and every stage is judged
 * against it. The manuscript is the other exception: stages after drafting
 * (continuity, critique, fact-check, final review) exist to read the chapters,
 * and given only summaries they reviewed the summaries. It is bounded by
 * MANUSCRIPT_MAX, and only those stages get it.
 *
 * Summaries are read off the artifact when one has been stored (written when
 * the stage completes) and projected from the artifact's head version
 * otherwise, so a project that predates stored summaries still produces a
 * digest rather than an empty one.
 */

import type { Artifact, ArtifactVersion, Project } from '@/types/project';
import type { OutlineSection } from '@/types';
import { manuscriptSourceFor } from './context';
import type { StageDefinition, WorkflowState, WorkflowTemplate } from './types';
import { parseItems, rendererHoldsItems } from './stage-artifact';
import { isDone } from './types';

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
  /** The drafted chapters; empty for every stage up to and including drafting. */
  manuscript: string;
  /**
   * The project's data files, by name, shape and first rows. Without this a
   * stage planned its runs as though no data existed and marked every one
   * "not run" with data sitting in the project.
   */
  data_files: DataFileBrief[];
  /** Figures earlier stages established, to be quoted rather than worked out again. */
  figures: { stage: string; name: string; value: string; context: string }[];
}

/** What a prompt is told about one data file. Never the file. */
export interface DataFileBrief {
  name: string;
  kind: string;
  columns: string[];
  sample: string[][];
  rows: number;
}

export function dataFileBriefs(project: Pick<Project, 'data_files'>): DataFileBrief[] {
  return (project.data_files ?? []).map((f) => ({
    name: f.name, kind: f.preview.kind, columns: f.preview.columns, sample: f.preview.sample, rows: f.preview.rows,
  }));
}

/**
 * Roughly 30k tokens. A short book fits whole; past this each chapter is cut to
 * an equal share, and the cut is marked so the model does not review a
 * truncation as if the chapter ended there.
 */
export const MANUSCRIPT_MAX = 120_000;

/** The written chapters as one text, bounded. Pure; no model call. */
export function formatManuscript(
  sections: Pick<OutlineSection, 'title' | 'content' | 'status'>[],
  max = MANUSCRIPT_MAX
): string {
  const written = sections
    .map((s, i) => ({ heading: `## ${i + 1}. ${s.title || 'Untitled section'}`, body: (s.content ?? '').trim() }))
    .filter((s) => s.body);
  if (!written.length) return '';

  const whole = written.map((s) => `${s.heading}\n\n${s.body}`).join('\n\n');
  if (whole.length <= max) return whole;

  const marker = '\n\n[… the rest of this section is omitted to fit the review budget …]';
  const share = Math.max(200, Math.floor(max / written.length) - marker.length - 80);
  return written
    .map((s) => {
      if (s.body.length <= share) return `${s.heading}\n\n${s.body}`;
      const cut = s.body.slice(0, share);
      const space = cut.lastIndexOf(' ');
      return `${s.heading}\n\n${(space > share * 0.8 ? cut.slice(0, space) : cut).trimEnd()}${marker}`;
    })
    .join('\n\n');
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

  // A manuscript: name its sections rather than quoting the opening of
  // chapter one as if that were the book.
  if (stage.renderer === 'long_form') {
    const titles = [...content.matchAll(/^## \d+\. (.+)$/gm)].map((m) => m[1].trim());
    if (titles.length) return truncate(`${titles.length} sections: ${titles.join('; ')}`);
  }

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
  project: Pick<Project, 'objective' | 'audience' | 'data_files'>,
  bundles: Record<string, StageArtifactBundle>,
  upToStageId: string
): StageDigest {
  const cutoff = template.stages.findIndex((s) => s.id === upToStageId);
  const prior_stages: StageDigestEntry[] = [];

  template.stages.forEach((stage, index) => {
    if (cutoff >= 0 && index >= cutoff) return;
    if (!isDone(state.stages[stage.id]?.status)) return;

    const bundle = bundles[stage.id];
    const stored = bundle?.artifact?.summary?.trim();
    const head = bundle?.versions.at(-1)?.content;
    const summary = stored ? truncate(stored) : summariseStageContent(stage, head);
    if (!summary) return;

    prior_stages.push({ stage_id: stage.id, label: stage.label, summary });
  });

  // The stages after drafting that are not themselves long-form read the
  // chapters (`manuscriptSourceFor`, shared with Go's planner state).
  const target = template.stages[cutoff];
  const source = target ? manuscriptSourceFor(template, target) : null;
  const sections = source ? (bundles[source.id]?.artifact?.long_form?.outline ?? []) : [];

  return {
    objective: project.objective ?? '',
    audience: project.audience ?? '',
    prior_stages,
    manuscript: formatManuscript(sections),
    data_files: dataFileBriefs(project),
    figures: establishedFigures(template, state, bundles, upToStageId),
  };
}

/**
 * The figures stages before this one established. Kept here, beside the
 * digest that carries them; lib/workflow/figures.ts holds how they are read
 * and stored. Only done stages, and only figures still about the head version.
 */
export function establishedFigures(
  template: WorkflowTemplate,
  state: WorkflowState,
  bundles: Record<string, StageArtifactBundle>,
  upToStageId: string
): StageDigest['figures'] {
  const cutoff = template.stages.findIndex((s) => s.id === upToStageId);
  const out: StageDigest['figures'] = [];
  template.stages.forEach((stage, index) => {
    if (cutoff >= 0 && index >= cutoff) return;
    if (!isDone(state.stages[stage.id]?.status)) return;
    const bundle = bundles[stage.id];
    const stored = bundle?.artifact?.key_figures;
    if (!stored?.figures?.length || stored.version_id !== bundle?.versions.at(-1)?.id) return;
    for (const f of stored.figures) out.push({ stage: stage.label, name: f.name, value: f.value, context: f.context ?? '' });
  });
  return out.slice(0, 60);
}
