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

/**
 * What someone typed elsewhere, for the start box to pick up once. In this tab's
 * storage rather than the URL: it can be about their work, and a URL ends up in
 * logs and histories.
 */
const START_GOAL_KEY = 'pm.start.goal';

export function rememberStartGoal(goal: string): void {
  try {
    sessionStorage.setItem(START_GOAL_KEY, goal);
  } catch {
    // Storage blocked: the box just starts empty.
  }
}

export function takeStartGoal(): string {
  try {
    const goal = sessionStorage.getItem(START_GOAL_KEY) ?? '';
    sessionStorage.removeItem(START_GOAL_KEY);
    return goal;
  } catch {
    return '';
  }
}
