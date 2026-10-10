/**
 * Goals a first-time user can start from (Harold, via Sean, 9 Oct: someone
 * starting from a blank slate "can't really answer any questions until they get
 * the ball rolling"). Each fits Single output, the workflow first testers are
 * shown, and carries a figure so the facts and the checks have something to hold.
 */
export const EXAMPLE_GOALS: { label: string; goal: string }[] = [
  {
    label: 'A recommendation memo',
    goal: 'Write a one-page memo recommending whether our 12-person team should move from Slack to Microsoft Teams. Budget is $8,000 a year.',
  },
  {
    label: 'A short briefing',
    goal: 'Write a two-page briefing for a board on the main risks of adopting AI tools in a 200-person accounting firm, with a recommended first step.',
  },
  {
    label: 'A plan with numbers',
    goal: 'Draft a 90-day plan to cut customer support response time from 24 hours to 8 hours for a team of 6 agents, without new hires.',
  },
];

/** The URL that opens a new project with this goal already in the box. */
export function newProjectHref(goal: string): string {
  return `/projects/new?goal=${encodeURIComponent(goal)}`;
}

/** The goal a new-project URL carries, if any: trimmed, and capped like the box itself. */
export function goalFromSearch(search: string, max: number): string {
  const goal = new URLSearchParams(search).get('goal')?.trim() ?? '';
  return goal.slice(0, max);
}
