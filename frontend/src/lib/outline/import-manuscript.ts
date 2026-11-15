/**
 * A manuscript the user brought, made the book's chapters (15 Nov: a tester
 * wanted a long-form project made out of his book; Sean's 417,000-character
 * manuscript was cut to its first 200,000).
 *
 * At Start, a project whose workflow writes chapters (a long-form stage) gets
 * the manuscript's chapters as its outline — one version, labelled "Imported" —
 * and each chapter's text, word for word, as the written section under the same
 * item id. Approving the outline stays the user's: `longFormFromOutline` keeps
 * prose already written by item id, so on approval the drafting stage is
 * complete with the user's own text and nothing is generated over it.
 */

import { type Chapter } from '@/lib/data/chapters';
import { outlineStageFor } from './actions';
import { serializeOutlineDocument } from './model';
import { draftingStageId } from '@/lib/workflow/derived-outline';
import { appendVersion, createArtifact, saveLongForm } from '@/lib/supabase/versions';
import { ensureOutlineArtifact } from '@/lib/supabase/outline';
import type { LongFormState, OutlineSection } from '@/types';
import type { OutlineDocument } from '@/types/outline';
import type { WorkflowTemplate } from '@/lib/workflow/types';

/** Whether a workflow can take a manuscript as its chapters. */
export function takesManuscript(template: Pick<WorkflowTemplate, 'stages' | 'outline_stage'>): boolean {
  return Boolean(draftingStageId(template as WorkflowTemplate) && outlineStageFor(template as WorkflowTemplate));
}

/** A chapter's first sentence, as the outline's short description of it. */
export function abstractOf(text: string): string {
  const first = text.replace(/\s+/g, ' ').trim().match(/^.{20,240}?[.!?](?=\s|$)/)?.[0] ?? text.replace(/\s+/g, ' ').trim().slice(0, 200);
  return first.trim();
}

/** The outline and the written sections for a manuscript, under the same ids. Pure. */
export function manuscriptOutline(
  chapters: readonly Chapter[],
  mint: () => string = () => crypto.randomUUID(),
  now = new Date().toISOString()
): { doc: OutlineDocument; sections: OutlineSection[] } {
  const items = chapters.map((c) => ({ id: mint(), title: c.title.slice(0, 200), abstract: abstractOf(c.text) }));
  const sections: OutlineSection[] = items.map((item, i) => ({
    id: item.id,
    title: item.title,
    abstract: item.abstract,
    status: 'complete',
    content: chapters[i].text,
    revision: 1,
    finish_reason: 'imported',
    error: null,
    generated_at: now,
  }));
  return { doc: { schema: 1, items, orphans: [] }, sections };
}

/**
 * Write the manuscript into a new project: the outline version, then the
 * chapters on the drafting stage's artifact. Returns how many chapters.
 */
export async function importManuscript(
  project: { id: string; user_id: string },
  template: WorkflowTemplate,
  chapters: readonly Chapter[],
  name: string
): Promise<number> {
  const outlineStage = outlineStageFor(template);
  const drafting = draftingStageId(template);
  if (!outlineStage || !drafting || !chapters.length) return 0;
  const { doc, sections } = manuscriptOutline(chapters);
  const outlineArtifact = await ensureOutlineArtifact(project.id, project.user_id, outlineStage.id);
  const version = await appendVersion(outlineArtifact, {
    content: serializeOutlineDocument({ ...doc, forked_from_version_id: null }),
    source_operation: 'initial',
    instruction: `From ${name}`,
    change_summary: `${chapters.length} chapters from ${name}, as written.`,
  });
  // A derived outline keeps the manuscript on its own row; a book's drafting stage has its own.
  const target = outlineStage.id === drafting
    ? outlineArtifact
    : await createArtifact(project.id, project.user_id, 'output', template.stages.find((s) => s.id === drafting)?.label ?? 'Drafting', drafting);
  const now = new Date().toISOString();
  const state: LongFormState = {
    state: 'review_outline',
    current_section_index: sections.length,
    outline: sections.map((s) => ({ ...s, outline_version_id: version.id })),
    continuity_snapshot: null,
    started_at: now,
    completed_at: null,
  };
  await saveLongForm(target.id, state);
  return chapters.length;
}

/** The note the project context keeps in the manuscript's place: the chapters hold the text. */
export function manuscriptNote(name: string, chapters: number, chars: number): string {
  return `### From ${name}\n\n[Imported as the book's ${chapters} chapters (${chars.toLocaleString('en-US')} characters). The chapters hold the text, word for word.]`;
}
