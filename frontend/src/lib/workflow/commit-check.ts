import { parseItems } from './stage-artifact';

/**
 * The one check every new stage version passes before it becomes current.
 *
 * A model's revision is a proposal: it becomes the stage's current work only if
 * it still holds the work. On 4 Oct a revision of a populated Options table
 * came back as prose, was saved as v3, and the stage showed "No claims yet"
 * with its criteria falling from 1/2 to 0/2. The guard that would have caught
 * it lived in one of the two apply paths only; here it sits in front of every
 * append, so a new path cannot ship without it.
 *
 * Pure: it sees the current head and the proposed content, nothing else.
 */

/** Operations the user performs by hand. They may empty a table on purpose. */
const USER_OPERATIONS = new Set(['stage_edit', 'outline_edit', 'restore']);

/** Operations that rewrite the current text rather than add to it. */
const REWRITE_OPERATIONS = new Set(['applied_findings', 'applied_recommendations', 'refine']);

/** A rewrite shorter than this share of the text it replaces lost the work. */
const MIN_REWRITE_SHARE = 0.3;
/** Below this length a short rewrite is plausible and not checked. */
const SHRINK_CHECK_FROM = 400;

export class RefusedRevision extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RefusedRevision';
  }
}

export function checkCommit(input: {
  before: string | null | undefined;
  after: string;
  operation: string;
}): string | null {
  const { before, after, operation } = input;
  const byUser = USER_OPERATIONS.has(operation);

  if (!after.trim()) {
    return byUser ? null : 'The revision came back empty, so the current version was kept.';
  }

  const beforeItems = parseItems(before);
  if (beforeItems && !byUser) {
    const afterItems = parseItems(after);
    if (afterItems === null) {
      return 'The revision came back as text instead of a table, so the current version was kept.';
    }
    if (afterItems.length === 0 && beforeItems.length > 0) {
      return 'The revised table came back with no rows, so the current version was kept.';
    }
  }

  if (!beforeItems && before && REWRITE_OPERATIONS.has(operation)) {
    const was = before.trim().length;
    if (was >= SHRINK_CHECK_FROM && after.trim().length < was * MIN_REWRITE_SHARE) {
      return 'The revision lost most of the text it was revising, so the current version was kept.';
    }
  }

  return null;
}
