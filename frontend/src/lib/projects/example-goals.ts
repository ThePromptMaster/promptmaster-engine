/**
 * A new-project link can carry a goal for the box (`/projects/new?goal=…`). The
 * empty list's three goal links are gone: curated examples took their place
 * (`lib/projects/examples`, the client's call, 4 Nov), and they say more.
 */

/** The goal a new-project URL carries, if any: trimmed, and capped like the box itself. */
export function goalFromSearch(search: string, max: number): string {
  const goal = new URLSearchParams(search).get('goal')?.trim() ?? '';
  return goal.slice(0, max);
}
