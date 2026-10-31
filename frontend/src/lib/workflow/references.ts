/**
 * Another project's material, as this project's prompts receive it (client,
 * 21 Oct, email 5: "the project you are working on can use that information
 * from those other chosen files or projects"). Pure.
 *
 * Each reference rides in every prompt the project makes, so it is capped:
 * 16,000 characters of each, 40,000 in all, shared evenly when the total is
 * over. A cut is said where it is made rather than left for a model to notice.
 */

import type { ReferencedProject } from '@/types';

export const REFERENCE_MAX = 16_000;
export const REFERENCES_TOTAL_MAX = 40_000;
export const MAX_REFERENCES = 5;
const CUT = '\n\n[… the rest is omitted to fit; open the project to read it all …]';

/** What the browser read of a referenced project. */
export interface ReferenceMaterial {
  /** The `project_references` row. */
  referenceId: string;
  projectId: string;
  title: string;
  objective: string;
  /** The referenced project's deliverable stage, by its label. */
  deliverable: string;
  /** That stage's text: the head version, or the manuscript's written chapters. */
  text: string;
  /** Its current accepted facts, when the reference includes them. */
  facts: string[];
  /** In the trash: shown as such, and sent to no prompt. */
  deleted: boolean;
  updatedAt: string;
  /** When this material was taken from the original (31 Oct); absent when read live. */
  snapshotAt?: string | null;
}

function cut(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const room = Math.max(0, max - CUT.length);
  const head = t.slice(0, room);
  const space = head.lastIndexOf(' ');
  return `${(space > room * 0.8 ? head.slice(0, space) : head).trimEnd()}${CUT}`;
}

/** The references as `PMInput.references`, capped, deleted ones left out. */
export function referencePayload(materials: readonly ReferenceMaterial[]): ReferencedProject[] {
  const live = materials.filter((m) => !m.deleted).slice(0, MAX_REFERENCES);
  if (!live.length) return [];
  const each = Math.min(REFERENCE_MAX, Math.floor(REFERENCES_TOTAL_MAX / live.length));
  return live.map((m) => ({
    title: m.title.slice(0, 300),
    objective: m.objective.slice(0, 4_000),
    deliverable: m.deliverable.slice(0, 80),
    excerpt: cut(m.text, each),
    facts: m.facts.filter((f) => f.trim()).slice(0, 30).map((f) => f.slice(0, 500)),
  }));
}

/** The references' text, for the checks that ask "did the user supply this?". */
export function referenceText(materials: readonly ReferenceMaterial[] | undefined): string[] {
  return (materials ?? []).filter((m) => !m.deleted).flatMap((m) => [m.text, ...m.facts]).filter((t) => t.trim());
}
