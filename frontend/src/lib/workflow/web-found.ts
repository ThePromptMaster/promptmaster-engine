import { saveSources, type NewSource } from '@/lib/supabase/sources';
import { renumberCitations, savedNumbers } from '@/lib/workflow/sources';
import { useProjectStore } from '@/stores/project-store';
import type { ProjectSource } from '@/types/project';

/**
 * Every writer may search the web (22 Oct: "every AI agent should have web
 * access"), while the project's Web access switch is on.
 *
 * The backend decides and searches (`web_search.with_web`) and cites what it
 * found as [S n], numbered after the sources the request carried. What comes
 * back here is saved before the work is — so a version never cites a source
 * the project does not hold — and shown where the user is.
 */

/** What a writer's response says about its search; all absent when it did not search. */
export interface WebUse {
  web_query?: string;
  web_sources?: NewSource[];
  web_note?: string;
}

/** A search a writer made, as the page shows it. */
export interface WebFound {
  projectId: string;
  stageId: string | null;
  query: string;
  /** Sources newly saved to the project. */
  saved: number;
  /** Set when the search failed, or its sources could not be saved. */
  note?: string;
}

/** The switch, as every writer's request sends it. */
export function webAccessOf(project: { web_access?: 'on' | 'off' | null }): 'on' | 'off' {
  return project.web_access === 'on' ? 'on' : 'off';
}

/**
 * Save what a writer's search found, in the order it was cited, and tell the
 * page. Never throws: a source that will not save costs the citation, not the
 * work it was found for.
 */
export async function keepFound(
  project: { id: string; user_id: string; sources?: ProjectSource[] },
  res: WebUse,
  where: { stageId?: string | null; agentRunId?: string | null } = {}
): Promise<WebFound | null> {
  const stageId = where.stageId ?? null;
  if (!res.web_query) {
    if (!res.web_note) return null;
    const found: WebFound = { projectId: project.id, stageId, query: '', saved: 0, note: res.web_note };
    tellPage(project.id, [], found);
    return found;
  }
  const query = res.web_query;
  try {
    const saved = res.web_sources?.length ? await saveSources(project, res.web_sources, { query, stageId, agentRunId: where.agentRunId }) : [];
    // A find the project already held is saved under its own number, and the
    // ones after it move up; the work cites them as saved (31 Oct, Sean).
    renumberResponse(res, savedNumbers(project.sources, res.web_sources ?? [], saved));
    const found: WebFound = { projectId: project.id, stageId, query, saved: saved.length };
    tellPage(project.id, saved, found);
    return found;
  } catch (e) {
    const reason = e instanceof Error && e.message ? e.message : 'not stored';
    const found: WebFound = { projectId: project.id, stageId, query, saved: 0, note: `Searched the web for “${query}”, but its sources could not be saved (${reason}).` };
    tellPage(project.id, [], found);
    return found;
  }
}

/**
 * Every text in a writer's response with its citations renumbered, in place:
 * the content, a table's rows, a continued iteration, a chat reply. The
 * response is what its caller saves next, so the version cites what is saved.
 */
export function renumberResponse(res: object, map: ReadonlyMap<number, number>): void {
  if (!map.size) return;
  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') return renumberCitations(value, map);
    if (Array.isArray(value)) {
      value.forEach((v, i) => { value[i] = walk(v); });
      return value;
    }
    if (value && typeof value === 'object') {
      const o = value as Record<string, unknown>;
      for (const k of Object.keys(o)) if (!k.startsWith('web_')) o[k] = walk(o[k]);
    }
    return value;
  };
  walk(res);
}

/** The search as a line: on a version's summary, in Go's report, on the page. */
export function webLine(found: WebFound | null): string {
  if (!found) return '';
  if (found.note) return found.note;
  return `Searched the web for “${found.query}” · ${found.saved ? `${found.saved} new source${found.saved === 1 ? '' : 's'} saved` : 'no new sources'}`;
}

/** A version's summary with its search after it. */
export function withWebLine(summary: string | null | undefined, found: WebFound | null): string {
  const line = webLine(found);
  return [summary?.trim(), line].filter(Boolean).join(' ');
}

function tellPage(projectId: string, saved: ProjectSource[], found: WebFound) {
  const store = useProjectStore.getState();
  if (store.projectId === projectId) store.addSources(saved, found);
}
