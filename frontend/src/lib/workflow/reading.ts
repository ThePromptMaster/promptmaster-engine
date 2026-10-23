/**
 * Another project, read beside this one (client feedback, 21 Oct, email 4:
 * "dual projects at the same time side-by-side like split screen and you can
 * integrate with each other"). Pure: what a stage of the other project says,
 * cut into sections, and the excerpt handed to this project's side chat.
 */

import { manuscriptArtifactFor } from './context';
import { documentText, formatManuscript, type StageArtifactBundle } from './digest';
import type { StageDefinition, WorkflowTemplate } from './types';

/** Long enough for a whole book; the pane scrolls. */
const READING_MAX = 400_000;

/** At most this much of a section goes into the side chat's composer. */
export const QUOTE_MAX = 4_000;

/** A stage's text as it stands: its head version, or the manuscript's written chapters. */
export function stageReadingText(
  template: WorkflowTemplate,
  stage: StageDefinition,
  bundles: Record<string, StageArtifactBundle>
): string {
  if (stage.renderer === 'long_form') {
    return formatManuscript(manuscriptArtifactFor(template, stage, bundles)?.long_form?.outline ?? [], READING_MAX);
  }
  const bundle = bundles[stage.id];
  if (stage.renderer === 'outline') {
    const sections = bundle?.artifact?.long_form?.outline ?? [];
    if (sections.length) return sections.map((s, i) => `## ${i + 1}. ${s.title || 'Untitled section'}\n\n${(s.abstract ?? '').trim()}`).join('\n\n');
  }
  const head = bundle?.versions.at(-1)?.content ?? '';
  return documentText(stage, head) || (bundle?.artifact?.summary ?? '').trim();
}

export interface ReadingSection {
  heading: string;
  body: string;
}

/** The text cut at its Markdown headings; text before the first heading is its own section. */
export function readingSections(text: string): ReadingSection[] {
  const out: ReadingSection[] = [];
  let current: ReadingSection | null = null;
  for (const line of text.split('\n')) {
    const m = /^#{1,4}\s+(.*)$/.exec(line);
    if (m) {
      if (current && (current.heading || current.body.trim())) out.push(current);
      current = { heading: m[1].trim(), body: '' };
    } else {
      current ??= { heading: '', body: '' };
      current.body += `${line}\n`;
    }
  }
  if (current && (current.heading || current.body.trim())) out.push(current);
  return out.map((s) => ({ heading: s.heading, body: s.body.trim() }));
}

/** A section as a quote for the side chat, said where it came from, never longer than QUOTE_MAX. */
export function sideChatQuote(projectTitle: string, stageLabel: string, section: ReadingSection): string {
  const raw = [section.heading ? `**${section.heading}**` : '', section.body].filter(Boolean).join('\n\n');
  const cut = raw.length > QUOTE_MAX ? `${raw.slice(0, QUOTE_MAX).trimEnd()} […]` : raw;
  const quoted = cut.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n');
  return `${quoted}\n\nFrom "${projectTitle || 'Untitled project'}" — ${stageLabel}\n\n`;
}
