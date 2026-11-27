/**
 * The section an approval names in an earlier version, compared in code with
 * the text being judged (28 Nov, Sean, Northline Fixtures; L-329). Pure.
 *
 * "Final review couldn't compare v4's outreach wording against approved Output
 * v2, even though v2 was visible in Timeline. I compared the rendered message
 * text and it matched exactly. Can the verifier open the specific historical
 * version named in an approval and check the approved section before marking
 * the objective met?" The objective check was shown earlier versions only when
 * the deliverable itself said "Output v2", and then only their first 3,000
 * characters; the approval was a fact ("D5 … the OUTREACH message wording as it
 * appears in saved Output v2"), and OUTREACH began at character 1,226 of a long
 * packet. Here the facts are read for the versions they name, and each named
 * section is compared line by line: a model is told the result, never asked to
 * compare two long texts itself.
 */

import type { WorkflowTemplate } from '@/lib/workflow/types';

export interface ApprovedComparison {
  /** The section's name as its heading gives it: "OUTREACH". */
  section: string;
  /** The stage and version the approval names. */
  stage: string;
  version: number;
  /** The version being judged, when known. */
  current: number | null;
  identical: boolean;
  /** Note lines that differ and were set aside: a quoted internal header, "not part of the message". */
  notesAside: string[];
  /** The first lines that differ, "v2: …" and "v4: …". */
  differences: string[];
}

interface Heading {
  at: number;
  level: number;
  /** The heading's own name: "OUTREACH" in "## OUTREACH — Candidate outreach draft". */
  name: string;
  title: string;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function headingsOf(text: string): Heading[] {
  return text.split('\n').flatMap((line, at) => {
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) return [];
    const title = m[2].replace(/[*_`]/g, '').trim();
    const name = title.split(/\s+[—–-]\s+|:\s/)[0].trim();
    return [{ at, level: m[1].length, name, title }];
  });
}

/**
 * The lines under the heading whose name is `name`, up to the next heading of
 * the same or a higher level, or null when no heading has that name.
 */
export function sectionUnder(text: string, name: string): string | null {
  const lines = text.split('\n');
  const all = headingsOf(text);
  const want = name.trim().toLowerCase();
  const h = all.find((x) => x.name.toLowerCase() === want || x.title.toLowerCase() === want);
  if (!h) return null;
  const next = all.find((x) => x.at > h.at && x.level <= h.level);
  return lines.slice(h.at, next ? next.at : lines.length).join('\n');
}

/** The sections of `text` that `statement` names, by their heading's own name (three letters or more). */
export function sectionsNamed(text: string, statement: string): string[] {
  const names = headingsOf(text).filter((h) => h.level > 1 && h.name.length >= 3).map((h) => h.name);
  return [...new Set(names.filter((n) => new RegExp(`(?:^|[^\\p{L}\\p{N}])${escape(n)}(?:$|[^\\p{L}\\p{N}])`, 'iu').test(statement)))];
}

/** A sentence that gives an approval. */
const APPROVES = /\b(?:approv(?:al|ed|es|e)|signed|signs? off|sign-off)\b/i;
/** One that says something is not approved. */
const NOT_APPROVED = /\b(?:unapproved|not (?:yet )?approved|without approval|excluded|does not cover|do(?:es)? not extend)\b/i;

/** A line that annotates the section rather than being part of it. */
const isNote = (line: string) => /^>/.test(line) || /\bnot part of (?:the )?(?:message|text|email|letter|wording)\b/i.test(line);

const lineSet = (section: string) =>
  section
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l && !/^[-*_]{3,}$/.test(l));

const clip = (l: string) => (l.length > 160 ? `${l.slice(0, 159)}…` : l);

/**
 * Every section an approval names in an earlier version of a stage, compared
 * with the same section of `content` (the text being judged). Only sentences
 * that give an approval and name a stage's version ("Output v2") are read, and
 * only the sections of that version whose heading the sentence names.
 */
export function approvedComparisons(
  template: Pick<WorkflowTemplate, 'stages'>,
  bundles: Readonly<Record<string, { versions: readonly { id: string; version_number: number; content?: string | null }[] } | undefined>>,
  content: string,
  current: { id?: string | null; version_number?: number | null } | null | undefined,
  statements: readonly string[]
): ApprovedComparison[] {
  const out: ApprovedComparison[] = [];
  // Read a sentence at a time: "BRIEF and SCREEN in Output v2 remain unapproved"
  // beside D5's approval of OUTREACH in Output v2 names no approved section.
  const sentences = statements.flatMap((st) => st.split(/(?<=[.!?])\s+(?=[A-Z(])/)).filter((x) => APPROVES.test(x) && !NOT_APPROVED.test(x));
  for (const statement of sentences) {
    for (const s of template.stages) {
      const labels = [...new Set([s.short_label, s.label].filter((l): l is string => !!l))];
      if (!labels.length) continue;
      const re = new RegExp(`\\b(?:${labels.map(escape).join('|')})\\s+v(\\d{1,3})\\b`, 'gi');
      for (const m of statement.matchAll(re)) {
        const n = Number(m[1]);
        const v = bundles[s.id]?.versions.find((x) => x.version_number === n);
        if (!v?.content || (current?.id && v.id === current.id)) continue;
        for (const name of sectionsNamed(v.content, statement)) {
          const label = s.short_label || s.label;
          if (out.some((c) => c.section === name && c.stage === label && c.version === n)) continue;
          const was = sectionUnder(v.content, name);
          const now = sectionUnder(content, name);
          if (!was) continue;
          const a = lineSet(was);
          const b = now ? lineSet(now) : [];
          const body = (ls: string[]) => ls.filter((l) => !isNote(l));
          const same = (x: string[], y: string[]) => x.length === y.length && x.every((l, i) => l === y[i]);
          const identical = !!now && same(body(a), body(b));
          const cur = current?.version_number ?? null;
          const tagNow = cur ? `v${cur}` : 'now';
          const notesAside = identical ? [...a.filter((l) => isNote(l) && !b.includes(l)), ...b.filter((l) => isNote(l) && !a.includes(l))].map(clip) : [];
          const differences = identical
            ? []
            : !now
              ? [`${tagNow}: no section named ${name}`]
              : [
                ...body(a).filter((l) => !body(b).includes(l)).slice(0, 3).map((l) => `v${n}: ${clip(l)}`),
                ...body(b).filter((l) => !body(a).includes(l)).slice(0, 3).map((l) => `${tagNow}: ${clip(l)}`),
              ];
          out.push({ section: name, stage: label, version: n, current: cur, identical, notesAside, differences });
        }
      }
    }
  }
  return out;
}

/** One line for the objective check and the record. */
export function comparisonLine(c: ApprovedComparison, judged: string): string {
  const now = c.current ? `${judged} v${c.current}` : judged;
  const head = `${c.section} in ${now} compared in code with ${c.stage} v${c.version}, the version an approval names`;
  if (c.identical) {
    return `${head} — identical word for word${c.notesAside.length ? `, apart from its internal note line${c.notesAside.length === 1 ? '' : 's'}` : ''}`;
  }
  return `${head} — differs: ${c.differences.join(' | ')}`;
}
