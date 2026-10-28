/**
 * Parts the user asked the finished work to include, checked when it is
 * finished (28 Oct).
 *
 * Sean, HarborDesk test: "one requested change log was missing". Nothing
 * looked for a part asked for beside the main text — a change log, a cover
 * note, an executive summary — so a document without one finished as if
 * complete. Read in code from the brief, the requirements and the
 * instructions the user applied, never by a model: the finished screen names
 * what is missing and never stops the finish. English wording only.
 */

import type { Project } from '@/types/project';

interface Part {
  /** How a request names it. */
  asked: RegExp;
  /** How the work shows it, beyond being named the way it was asked. */
  shown?: RegExp;
}

const PARTS: readonly Part[] = [
  {
    asked: /\b(change ?logs?|log of (?:the )?changes|revision (?:log|history)|summary of (?:the )?changes|list of (?:the )?changes)\b/i,
    shown: /^#{1,6}\s.*\b(changes|revisions?|what changed)\b/im,
  },
  { asked: /\b(cover (?:note|letter|email|memo))\b/i },
  { asked: /\b(executive summary)\b/i },
  { asked: /\b(glossary)\b/i },
  { asked: /\b(faqs?|frequently asked questions)\b/i },
  { asked: /\b(bibliography|reference list|list of references)\b/i },
];

/** "no change log", "without a cover note", "remove the glossary": not asked for. */
const DECLINED = /\b(no|without|not|never|don'?t|do not|remove|drop|omit|exclude|skip)\b(?:\W+\w+){0,3}\W*$/i;

/** The user's own words about what the work must contain. */
function requestText(project: Pick<Project, 'objective' | 'constraints' | 'output_format' | 'facts' | 'applied_instructions'>): string[] {
  return [
    project.objective,
    project.constraints,
    project.output_format,
    ...(project.facts ?? []).filter((f) => f.kind === 'requirement' && !f.retired_at).map((f) => f.statement),
    ...(project.applied_instructions ?? []).map((i) => i.instruction),
  ].filter((s): s is string => !!s?.trim());
}

/**
 * The parts asked for that the finished text does not have, each in the words
 * the request used ("change log"), once each.
 */
export function missingParts(
  project: Pick<Project, 'objective' | 'constraints' | 'output_format' | 'facts' | 'applied_instructions'>,
  finished: string
): string[] {
  if (!finished.trim()) return [];
  const missing: string[] = [];
  for (const part of PARTS) {
    let named: string | null = null;
    for (const text of requestText(project)) {
      for (const m of text.matchAll(new RegExp(part.asked.source, 'gi'))) {
        // In order: the brief, then the requirements, then the instructions
        // oldest first, so a later "drop the change log" undoes an earlier ask.
        named = DECLINED.test(text.slice(Math.max(0, (m.index ?? 0) - 40), m.index)) ? null : m[1].toLowerCase();
      }
    }
    if (!named) continue;
    if (part.asked.test(finished) || part.shown?.test(finished)) continue;
    missing.push(named);
  }
  return missing;
}
