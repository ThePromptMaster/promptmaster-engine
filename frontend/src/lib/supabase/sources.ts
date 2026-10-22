import { createClient } from './client';
import type { ProjectSource } from '@/types/project';

/**
 * The project's saved web sources (20 Oct; Sean: "web search and source
 * retrieval … with citations and saved sources").
 *
 * Append-only: a source is saved or retired, never edited (the table's trigger
 * refuses anything else), and saved only while the project's Web access is on
 * (its insert policy). The browser writes under RLS; the backend owns no data
 * and is sent the current sources with every request (`inputsFrom`).
 */

const COLUMNS = 'id, seq, project_id, user_id, url, title, excerpt, query, stage_id, provider, origin, agent_run_id, retrieved_at, retired_at, created_at';

export interface NewSource {
  url: string;
  title: string;
  excerpt: string;
}

/**
 * In the order they were saved (`seq`), which is the order they are cited in.
 * Not `created_at`: one search's sources share one (22 Oct).
 */
export async function listProjectSources(projectId: string): Promise<ProjectSource[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('project_sources').select(COLUMNS).eq('project_id', projectId).order('seq', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as ProjectSource[];
}

/** Save what a search returned, one row per source; one already saved and current is not saved twice. */
export async function saveSources(
  project: { id: string; user_id: string; sources?: ProjectSource[] },
  found: readonly NewSource[],
  search: { query: string; stageId?: string | null; agentRunId?: string | null }
): Promise<ProjectSource[]> {
  const have = new Set((project.sources ?? []).filter((s) => !s.retired_at).map((s) => s.url));
  const fresh = found.filter((s, i) => !have.has(s.url) && found.findIndex((o) => o.url === s.url) === i);
  if (!fresh.length) return [];
  const supabase = createClient();
  const rows = fresh.map((s) => ({
    project_id: project.id,
    user_id: project.user_id,
    url: s.url,
    title: s.title.slice(0, 300),
    excerpt: s.excerpt.slice(0, 600),
    query: search.query.slice(0, 400),
    stage_id: search.stageId ?? null,
    origin: search.agentRunId ? 'agent' : 'user',
    agent_run_id: search.agentRunId ?? null,
  }));
  const { data, error } = await supabase.from('project_sources').insert(rows).select(COLUMNS);
  if (error) throw error;
  // In the order they were saved, as the reply cited them and as a reload lists them.
  return ((data ?? []) as unknown as ProjectSource[]).sort((a, b) => a.seq - b.seq);
}

/** Take a source out of the current list; it stays in the history. */
export async function retireSource(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from('project_sources').update({ retired_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}
