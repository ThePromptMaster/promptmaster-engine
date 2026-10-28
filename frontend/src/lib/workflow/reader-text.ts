/**
 * The finished document as its reader gets it (28 Oct).
 *
 * Sean, HarborDesk test: "The final documents also sometimes include internal
 * version and review terminology that makes them harder to read." The prompts
 * ask the model to keep it out (`reader_text.py`); this is the half that does
 * not depend on the model listening. What leaves PromptMaster as the work —
 * the finished screen, Word, PDF, LaTeX — loses its notes about the revision:
 * a version stamp, a line narrating what changed ("I removed …", "The summary
 * now includes …"), and a section headed as such ("## What changed in this
 * version"). Unless the user asked for a change log: then that is the work.
 * What is left that still reads as process talk is named, not rewritten
 * (`internalMentions`), for the user to decide. Pure.
 */

import { isChangeNote } from './preservation';
import { withoutStamps } from './version-stamp';

/** A heading for a note about the revision, not part of the document. */
const NOTE_HEADING =
  /^(#{1,6})\s+\**(?:what changed|changes? (?:in|to|made in|from|since) (?:this|the|that|an?) (?:previous |earlier |last |prior )?(?:version|revision|draft)|revision notes?|change notes?|notes? on (?:this|the) (?:version|revision|draft)|reviewer'?s? notes?|review notes?)\b/i;

/** The document without the notes about how it was made. */
export function forReader(text: string, keepChangeLog = false): string {
  const bare = withoutStamps(text);
  if (keepChangeLog) return bare;
  const out: string[] = [];
  let skipping = 0; // the heading level of a note section being dropped, 0 when none
  for (const line of bare.split('\n')) {
    const heading = line.match(/^(#{1,6})\s/);
    if (skipping && heading && heading[1].length <= skipping) skipping = 0;
    if (skipping) continue;
    const note = line.match(NOTE_HEADING);
    if (note) {
      skipping = note[1].length;
      continue;
    }
    if (isChangeNote(line)) continue;
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Process talk a reader would trip over: versions, drafts, review rounds, PromptMaster itself. */
const MENTION =
  /\b(?:v\d{1,3}\b(?!\.\d)|version \d{1,3}\b(?! of (?:the )?(?:app|api|software|standard|protocol|python))|(?:the |this |that )?(?:previous|earlier|prior|last|original) (?:version|draft)|(?:this|the latest|the current) (?:version|revision|draft) (?:of (?:this|the) (?:document|report|note|pack))?|review rounds?|(?:per|after|following) (?:the |your )?(?:review|reviewer'?s?) (?:feedback|comments|notes)|PromptMaster)\b/gi;

/** What the finished text still says about how it was made, each once, as written. */
export function internalMentions(text: string, keepChangeLog = false, max = 5): string[] {
  if (keepChangeLog) return [];
  const found = new Map<string, string>();
  let fenced = false;
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (fenced || /^\s*(?:\||```)/.test(line)) continue;
    for (const m of line.matchAll(MENTION)) {
      const said = m[0].trim();
      if (!found.has(said.toLowerCase())) found.set(said.toLowerCase(), said);
    }
  }
  return [...found.values()].slice(0, max);
}
