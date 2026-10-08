/**
 * The stage digest: what a stage is allowed to know about the work before it.
 *
 * The backend is stateless, so the client assembles this. The rule that makes
 * it affordable is a size bound: **O(stages x constant), never O(project)**.
 * Sending the whole manuscript to generate a claim table would grow without
 * limit across thirteen stages and bury the instruction that matters, so the
 * earlier stages' saved documents share one budget (DOCUMENTS_MAX), and only
 * a stage past it falls back to a few hundred characters of summary.
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
import { itemSchemaFor, parseItems, primaryArtifactKind, rendererHoldsItems } from './stage-artifact';
import { carriesForward, isDone } from './types';

/** Per-stage budget for a summary, used only where no saved text is sent. */
export const SUMMARY_MAX = 320;

/**
 * The earlier stages' saved documents, all together: roughly 30k tokens.
 *
 * Until 8 Oct each earlier stage reached later ones as a 320-character summary
 * written when it was completed. A consistency check then called facts missing
 * that the saved FAQ stated, a research report said its cycles were "not run"
 * while Analysis held the proofs, and a final review judged Output v1 after the
 * user had saved v2. The documents are the record; the budget is filled from
 * the latest stage backwards, since that is the work the next stage builds on.
 */
export const DOCUMENTS_MAX = 120_000;
/** Below this much room a document is not worth cutting; its summary goes instead. */
const DOCUMENT_MIN_SHARE = 2_000;

export interface StageDigestEntry {
  stage_id: string;
  label: string;
  summary: string;
  /**
   * The latest saved version, in full (rows as lines for a table stage), within
   * DOCUMENTS_MAX across every stage. Empty when the stage has no saved text,
   * holds the manuscript (sent separately) or fell outside the budget.
   */
  text?: string;
  version?: number;
  truncated?: boolean;
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
  /**
   * The instruction the user reviewed for the deliverable — the head of the
   * latest earlier stage whose artifact is a prompt. Sent in full: it is what
   * the deliverable is produced from (3 Oct, Single Output: the prompt and the
   * deliverable are separate artifacts).
   */
  reviewed_prompt?: string;
  /** Figures earlier stages established, to be quoted rather than worked out again. */
  figures: { stage: string; name: string; value: string; context: string }[];
  /**
   * The stages after this one, by label: their content is out of scope here.
   * A Diagnosis draft spent much of itself on Turnaround Options and the
   * 12-month plan, two stages later (4 Oct).
   */
  later_stages?: string[];
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
  // Images are placed in the work, not read by code; they reach prompts as
  // captions (lib/data/images.ts), never as "data the project holds".
  return (project.data_files ?? []).filter((f) => f.preview.kind !== 'image').map((f) => ({
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
      // A proposal is not yet the user's decision; a later stage must not read it as one.
      const status = item.status ? ` [${item.status_source === 'proposed' ? 'proposed: ' : ''}${item.status}]` : '';
      return `${truncate(text, 90)}${status}`;
    });
    const more = items.length > 8 ? ` (+${items.length - 8} more)` : '';
    return truncate(`${lines.join('; ')}${more}`);
  }

  return truncate(content);
}

/**
 * A stage's saved version as a later stage should read it: prose as written,
 * a table as one line per row with every field and its status. '' for the
 * manuscript, which travels on its own (`manuscript`).
 */
export function documentText(stage: StageDefinition, content: string | null | undefined): string {
  if (!content?.trim() || stage.renderer === 'long_form') return '';
  if (!rendererHoldsItems(stage.renderer)) return content.trim();
  const items = parseItems(content);
  if (!items) return content.trim();
  const labels = new Map(itemSchemaFor(stage).fields.map((f) => [f.key, f.label || f.key]));
  return items
    .map((item, i) => {
      const fields = Object.entries(item)
        .filter(([key, value]) => !['id', 'status', 'reason', 'status_source', 'status_history'].includes(key) && typeof value === 'string' && value.trim())
        .map(([key, value]) => `${labels.get(key) ?? key}: ${String(value).trim()}`);
      const status = item.status
        ? ` [status: ${item.status_source === 'proposed' ? 'proposed, not yet decided: ' : ''}${item.status}${item.reason ? ` — ${String(item.reason).trim()}` : ''}]`
        : ' [status: undecided]';
      return `${i + 1}. ${fields.join(' | ')}${status}`;
    })
    .join('\n');
}

function cutDocument(text: string, room: number): string {
  const cut = text.slice(0, room);
  const space = cut.lastIndexOf(' ');
  return `${(space > room * 0.8 ? cut.slice(0, space) : cut).trimEnd()}\n[… the rest of this document is not shown …]`;
}

export interface StageArtifactBundle {
  artifact: Artifact | null;
  versions: ArtifactVersion[];
}

/**
 * Build the digest for the stage about to be generated.
 *
 * Only stages the user completed, or moved past and left open, contribute. A
 * skipped stage produced no conclusion, and a stage marked stale is by
 * definition no longer trusted; feeding either forward would have the model
 * build on something the user has already walked away from. A stage left open
 * is labelled so, since its work was never signed off.
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

  // A workflow that loops starts each round with a return, so the last
  // round's stages sit after the one being worked on. The round is built on
  // them, so they are shown, labelled as last round's, rather than dropped.
  // Not only the stale ones: the stage a round was started from (Next
  // question) is usually still open, and on production round two never saw
  // the question round one ended on (4 Oct).
  const loops = template.stages.some((s) => s.transitions.loop_to);
  const texts: string[] = [];
  template.stages.forEach((stage, index) => {
    const st = state.stages[stage.id];
    const lastRound = loops && index > cutoff && Boolean(st) && st!.status !== 'not_started' && st!.status !== 'skipped';
    if (!lastRound && cutoff >= 0 && index >= cutoff) return;
    const bundle = bundles[stage.id];
    const headVersion = bundle?.versions.at(-1);
    // A stage reopened for editing, or waiting for a recheck, still holds the
    // latest saved work. Dropping it (as before 8 Oct) left a final review
    // reading nothing of an Output the user had just revised; it is shown,
    // labelled for what it is.
    const pending = !lastRound && !carriesForward(st) && Boolean(headVersion?.content?.trim())
      && (st?.status === 'in_progress' || st?.status === 'stale' || st?.status === 'blocked');
    if (!lastRound && !carriesForward(st) && !pending) return;
    const leftOpen = !lastRound && !pending && !isDone(st?.status);

    const stored = bundle?.artifact?.summary?.trim();
    const head = headVersion?.content;
    const summary = stored ? truncate(stored) : summariseStageContent(stage, head);
    const text = documentText(stage, head);
    if (!summary && !text) return;

    const label = lastRound
      ? `${stage.label} (last round)`
      : st?.status === 'stale'
        ? `${stage.label} (awaiting a recheck — may be out of date)`
        : pending
          ? `${stage.label} (being revised — latest saved, not yet signed off)`
          : leftOpen ? `${stage.label} (left open)` : stage.label;
    prior_stages.push({ stage_id: stage.id, label, summary, ...(headVersion?.version_number ? { version: headVersion.version_number } : {}) });
    texts.push(text);
  });

  // Fill the budget from the latest stage backwards.
  let room = DOCUMENTS_MAX;
  for (let i = prior_stages.length - 1; i >= 0; i -= 1) {
    const text = texts[i];
    if (!text) continue;
    if (text.length <= room) {
      prior_stages[i].text = text;
      room -= text.length;
    } else if (room >= DOCUMENT_MIN_SHARE) {
      prior_stages[i].text = cutDocument(text, room);
      prior_stages[i].truncated = true;
      room = 0;
    }
    if (!prior_stages[i].text && !prior_stages[i].summary) prior_stages[i].summary = summariseStageContent(template.stages.find((s) => s.id === prior_stages[i].stage_id)!, text);
  }

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
    later_stages: cutoff >= 0 ? template.stages.slice(cutoff + 1).map((s) => s.label.slice(0, 120)) : [],
    ...reviewedPrompt(template, state, bundles, cutoff),
  };
}

const PROMPT_MAX = 20_000;

/**
 * The prompt a later stage is produced from: the head version of the latest
 * stage before `cutoff` whose primary artifact is a prompt, when it holds one
 * and was not skipped. By kind, never by workflow.
 */
function reviewedPrompt(
  template: WorkflowTemplate,
  state: WorkflowState,
  bundles: Record<string, StageArtifactBundle>,
  cutoff: number
): { reviewed_prompt?: string } {
  if (cutoff < 0) return {};
  if (primaryArtifactKind(template.stages[cutoff]) === 'prompt') return {};
  for (let i = cutoff - 1; i >= 0; i -= 1) {
    const stage = template.stages[i];
    if (primaryArtifactKind(stage) !== 'prompt') continue;
    if (state.stages[stage.id]?.status === 'skipped') return {};
    const text = bundles[stage.id]?.versions.at(-1)?.content?.trim();
    return text ? { reviewed_prompt: text.slice(0, PROMPT_MAX) } : {};
  }
  return {};
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
