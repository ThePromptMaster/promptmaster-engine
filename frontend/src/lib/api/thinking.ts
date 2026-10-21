import type { Thinking } from '@/types/project';

/**
 * The open project's thinking level, sent with every backend call (14 Oct
 * call: "increase the thinking level"). Module-level for the same reason as
 * `setUsageProject`: `apiFetch` is not a component, and threading the level
 * through every API method would be churn for one header. The workspace sets
 * it and clears it on unmount, so the project list and the start page always
 * run at Standard.
 */
let current: Thinking = 'standard';

export const THINKING_HEADER = 'X-PromptMaster-Thinking';

export function setRequestThinking(level: Thinking | null | undefined): void {
  current = level === 'deep' ? 'deep' : 'standard';
}

/** The header to send, or none at Standard (the backend's default). */
export function thinkingHeaders(): Record<string, string> {
  return current === 'deep' ? { [THINKING_HEADER]: 'deep' } : {};
}
