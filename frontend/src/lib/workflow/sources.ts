import type { ProjectSource } from '@/types/project';

/**
 * The saved web sources a prompt cites (20 Oct): the current ones, oldest
 * first, so [S1] keeps its number as more are saved. Pure.
 */
export const MAX_SOURCES_SENT = 40;

export function currentSources(sources: readonly ProjectSource[] | undefined): ProjectSource[] {
  return (sources ?? []).filter((s) => !s.retired_at).slice(0, MAX_SOURCES_SENT);
}

/** As `PMInput.sources`: numbered by position. */
export function sourcesForRequest(sources: readonly ProjectSource[] | undefined) {
  return currentSources(sources).map((s) => ({ url: s.url, title: s.title, excerpt: s.excerpt, retrieved: s.retrieved_at.slice(0, 10) }));
}
