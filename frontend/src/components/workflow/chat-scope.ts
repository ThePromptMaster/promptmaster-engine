/**
 * The smallest seam the side chat needs to talk about *part* of a document.
 *
 * FR-09 requires "selection, section, and full document where feasible", and
 * requires the affected scope to be shown before application. Both need the
 * same three operations: name a scope, find its text in the document, and put
 * a revision back where it came from.
 *
 * **This is deliberately a local seam, not a general one.** A parallel change
 * is building `lib/workflow/apply-scope.ts` with `describeScope`,
 * `resolveAnchor` and `spliceScope` for the recommendation-apply path. These
 * three functions are the same three concepts under the same names, kept in
 * their own file so the two changes do not land on the same lines; on merge
 * this file should be deleted and its callers pointed at that module.
 *
 * Everything here is pure and works on Markdown text, because Markdown is what
 * `artifact_versions.content` holds.
 */

export type ScopeKind = 'selection' | 'section' | 'document';

/** One heading-delimited span of the document. */
export interface DocumentSection {
  id: string;
  title: string;
  /** Character offsets into the document, `end` exclusive. */
  start: number;
  end: number;
}

/** A resolved, splice-ready target: exactly the characters that will change. */
export interface ScopeTarget {
  kind: ScopeKind;
  /** A sentence naming what will change, for the pre-apply preview. */
  label: string;
  text: string;
  start: number;
  end: number;
}

const HEADING = /^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;

/**
 * The document's sections, split on ATX headings.
 *
 * A section runs from its heading to the character before the next heading of
 * any level, so revising "Chapter 3" carries its subsections with it — which
 * is what a user pointing at a heading means. Text before the first heading is
 * not a section: it has no name to show in a scope picker, and offering
 * "(untitled)" as a revision target invites applying to the wrong span.
 *
 * A document with no headings has no sections, which is the honest answer —
 * the section scope is then unavailable rather than silently meaning the whole
 * document.
 */
export function documentSections(content: string): DocumentSection[] {
  const lines = content.split('\n');
  const sections: DocumentSection[] = [];

  let offset = 0;
  let open: { title: string; start: number } | null = null;

  for (const line of lines) {
    const match = HEADING.exec(line);
    if (match) {
      if (open) {
        sections.push({
          id: `s${sections.length}`,
          title: open.title,
          start: open.start,
          // Trailing newline belongs to the section above it, so splicing a
          // replacement in does not weld two headings together.
          end: offset > 0 ? offset - 1 : 0,
        });
      }
      open = { title: match[2].trim(), start: offset };
    }
    offset += line.length + 1;
  }

  if (open) {
    sections.push({
      id: `s${sections.length}`,
      title: open.title,
      start: open.start,
      end: content.length,
    });
  }

  return sections;
}

function words(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

/**
 * Resolve a scope choice to the exact characters it covers.
 *
 * Returns null when the scope cannot be located — an empty document, a
 * selection that is not in this version's text, a section id from a version
 * that has since been replaced. **A null must never be treated as "the whole
 * document"**: silently widening a selection-scoped revision to the entire
 * artifact is the single worst thing this feature could do.
 */
export function resolveScope(
  content: string,
  kind: ScopeKind,
  options: { selection?: string; sectionId?: string } = {}
): ScopeTarget | null {
  if (kind === 'document') {
    if (!content.trim()) return null;
    return {
      kind,
      label: `The whole document — ${words(content)} words`,
      text: content,
      start: 0,
      end: content.length,
    };
  }

  if (kind === 'section') {
    const section = documentSections(content).find((s) => s.id === options.sectionId);
    if (!section) return null;
    const text = content.slice(section.start, section.end);
    return {
      kind,
      label: `The section “${section.title}” — ${words(text)} words`,
      text,
      start: section.start,
      end: section.end,
    };
  }

  const selection = (options.selection ?? '').trim();
  if (!selection) return null;

  const start = content.indexOf(selection);
  // Not found means the user selected across rendered Markdown that does not
  // appear verbatim in the source, or the version moved under them. Better to
  // refuse than to apply to the wrong span.
  if (start === -1) return null;

  return {
    kind,
    label: `The selected passage — ${words(selection)} words`,
    text: selection,
    start,
    end: start + selection.length,
  };
}

/** A short, quoted preview of what will change — FR-09's "shown before". */
export function describeScope(target: ScopeTarget, limit = 280): string {
  const text = target.text.trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit).trimEnd()}…`;
}

/**
 * Put a revision back where its scope came from.
 *
 * Offset-based rather than a find-and-replace: the revised text may legally be
 * identical to a passage elsewhere in the document, and a string replace would
 * then edit whichever one came first.
 */
export function spliceScope(
  content: string,
  target: ScopeTarget,
  replacement: string
): string {
  return content.slice(0, target.start) + replacement + content.slice(target.end);
}

/** The word used in the UI and in the change summary. */
export function scopeNoun(kind: ScopeKind): string {
  return kind === 'document' ? 'the whole document' : `the ${kind}`;
}
