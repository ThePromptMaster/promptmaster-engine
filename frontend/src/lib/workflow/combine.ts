/**
 * Combining several recommendations into one revision — FR-15.
 *
 * Pure, deterministic, and **never a model call**. Two reasons, and the second
 * is the load-bearing one:
 *
 * 1. A conflict warning that costs money and latency is a warning that gets
 *    switched off, and one that sometimes fails is worse than none.
 * 2. Asking a model "do these two instructions conflict?" gets a different
 *    answer on Tuesday. FR-15 says obvious conflicts trigger a warning *where
 *    detectable*; a closed tag vocabulary is what makes "detectable" a fact
 *    about the data rather than a judgement.
 *
 * ## The tag vocabulary
 *
 * `axis:direction` over six axes. Closed on both halves: a tag outside it is
 * ignored rather than guessed at, because a mis-parsed tag would produce a
 * warning about a conflict that does not exist, and users who see one false
 * warning stop reading the true ones.
 *
 * Tags are assigned deterministically from evaluation scores in
 * `recommend.ts` (`tagsFromSignals`), never by the model that wrote the
 * suggestion — a model asked to tag its own advice tags two contradictory
 * pieces of it identically, and the warning would never fire.
 *
 * ## Non-blocking, deliberately
 *
 * A detected conflict warns in `--pm-tertiary` and leaves Combine **enabled**.
 * The house rule is "guidance is suggestive, not restrictive" — the same rule
 * that keeps the transition bar's Advance button live with criteria unmet —
 * and FR-12 explicitly grants the user leave to proceed without applying a
 * recommendation. Two instructions that pull opposite ways are frequently
 * exactly what someone means: shorten the argument *and* add evidence for the
 * part that survives. The system's job is to say so, then get out of the way.
 */

import type { ProposedRecommendation, RecommendationScope } from './recommend';

// --- the closed vocabulary --------------------------------------------------

export const CONFLICT_AXES = {
  length: ['longer', 'shorter'],
  depth: ['deeper', 'shallower'],
  tone: ['formal', 'plain'],
  scope: ['broaden', 'narrow'],
  evidence: ['more', 'fewer'],
  structure: ['more', 'less'],
} as const;

export type ConflictAxis = keyof typeof CONFLICT_AXES;

export function isConflictAxis(value: string): value is ConflictAxis {
  return Object.prototype.hasOwnProperty.call(CONFLICT_AXES, value);
}

export interface ParsedTag {
  axis: ConflictAxis;
  direction: string;
}

/**
 * Parse `axis:direction`, rejecting anything outside the vocabulary.
 *
 * Returns null rather than throwing: a row written by an older build, or by a
 * later one this bundle predates, must degrade to "no conflict information"
 * rather than break the panel it appears in.
 */
export function parseTag(tag: string): ParsedTag | null {
  const [axis, direction] = tag.split(':');
  if (!axis || !direction || !isConflictAxis(axis)) return null;
  const directions: readonly string[] = CONFLICT_AXES[axis];
  return directions.includes(direction) ? { axis, direction } : null;
}

// --- detection --------------------------------------------------------------

export interface Conflict {
  /** 'axis' for opposing directions; 'overlap' for two scopes over one range. */
  reason: 'axis' | 'overlap';
  /** Present for an axis conflict. */
  axis?: ConflictAxis;
  /** The two recommendations that disagree, by category key. */
  between: [string, string];
  /** One sentence, shown as-is. */
  message: string;
}

/** FR-15 asks for "a limited number". More than four warnings is noise. */
export const MAX_CONFLICTS = 4;

function overlaps(a: RecommendationScope, b: RecommendationScope): boolean {
  // Derivable from the scope alone, which is the point: no content is read and
  // no anchor is inferred. Two selections that share a character are two
  // instructions about the same words.
  if (!a.selection || !b.selection) return false;
  return a.selection.start < b.selection.end && b.selection.start < a.selection.end;
}

interface Combinable {
  category: string;
  title: string;
  tags: string[];
  scope: RecommendationScope;
}

/**
 * Which of the selected recommendations pull against each other.
 *
 * Two kinds of conflict, both decidable from the row:
 *
 * - **Opposing directions on one axis.** `length:longer` beside
 *   `length:shorter` is a genuine contradiction whichever order they are
 *   applied in.
 * - **Overlapping selections.** Two instructions addressing the same
 *   characters will fight, whatever they say, because the second is applied to
 *   text the first has already rewritten.
 *
 * Pairs are reported once each, worst-listed-first by input order, capped at
 * `MAX_CONFLICTS`.
 */
export function detectConflicts(selected: readonly Combinable[]): Conflict[] {
  const conflicts: Conflict[] = [];

  for (let i = 0; i < selected.length; i += 1) {
    for (let j = i + 1; j < selected.length; j += 1) {
      const a = selected[i];
      const b = selected[j];

      const aTags = a.tags.map(parseTag).filter((t): t is ParsedTag => t !== null);
      const bTags = b.tags.map(parseTag).filter((t): t is ParsedTag => t !== null);

      let axisFound: ConflictAxis | null = null;
      for (const at of aTags) {
        for (const bt of bTags) {
          if (at.axis === bt.axis && at.direction !== bt.direction) {
            axisFound = at.axis;
            break;
          }
        }
        if (axisFound) break;
      }

      if (axisFound) {
        conflicts.push({
          reason: 'axis',
          axis: axisFound,
          between: [a.category, b.category],
          message: `"${a.title}" and "${b.title}" pull opposite ways on ${axisFound}. Applying both means the model choosing which one wins.`,
        });
      } else if (overlaps(a.scope, b.scope)) {
        conflicts.push({
          reason: 'overlap',
          between: [a.category, b.category],
          message: `"${a.title}" and "${b.title}" address the same passage. The second will be applied to text the first has already rewritten.`,
        });
      }

      if (conflicts.length >= MAX_CONFLICTS) return conflicts;
    }
  }

  return conflicts;
}

// --- the combined instruction -----------------------------------------------

/**
 * The instruction block the user reads before applying — FR-15's "the combined
 * instruction is visible".
 *
 * **This renders byte-identically to `_format_findings_block` in
 * `backend/promptmaster/audit_findings.py`.** That is not a coincidence to be
 * maintained by care; it is the point. `/api/apply-recommendations` casts each
 * recommendation to the `AuditFinding` shape the existing prompt builder takes
 * — `{id, category: kind, summary: title, suggested_change: instruction}` —
 * and `build_apply_audit_prompt` then formats exactly these lines into the
 * prompt. So the string shown in the preview dialog IS the string spliced into
 * the model's context, rather than a summary of it that could drift.
 *
 * That equality is testable without a model, and it is tested from both sides:
 * a vitest over this function and a pytest over `_format_findings_block`,
 * asserting the same literal.
 *
 * The empty case matches the Python fallback for the same reason.
 */
export function buildCombinedInstruction(
  selected: readonly Pick<ProposedRecommendation, 'kind' | 'title' | 'instruction'>[]
): string {
  if (selected.length === 0) return '(no findings selected)';
  return selected
    .map((r) => `- [${r.kind}] ${r.title} → ${r.instruction}`)
    .join('\n');
}

/** The `AuditFinding` cast the backend expects. One place, so the shapes agree. */
export function asFinding(rec: {
  category: string;
  kind: string;
  title: string;
  instruction: string;
}): { id: string; category: string; summary: string; suggested_change: string } {
  return {
    id: rec.category,
    category: rec.kind,
    summary: rec.title,
    suggested_change: rec.instruction,
  };
}
