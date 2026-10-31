import { createClient } from './client';

/**
 * Make a copy of a project and keep the original (31 Oct: "should it be more
 * like a copy thing rather than combining them so you have the original
 * project too as well kind of like the versions").
 *
 * The database copies every row in one transaction (`copy_project`,
 * 20261124000000_copy_project.sql) and says which stored files the copy's rows
 * now name; they are copied here, under the user's own storage policy. A file
 * that will not copy is named, not hidden: the copy is still made, and the
 * caller says which files it is missing.
 */

export interface CopyObject {
  bucket: string;
  from: string;
  to: string;
}

export interface ProjectCopy {
  projectId: string;
  /** Stored files the copy names but could not be copied. */
  missing: string[];
}

export async function copyProject(projectId: string): Promise<ProjectCopy> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('copy_project', { src: projectId });
  if (error) throw error;
  const result = (data ?? {}) as { project_id?: string; objects?: CopyObject[] };
  if (!result.project_id) throw new Error('The copy could not be made.');
  const missing: string[] = [];
  for (const o of result.objects ?? []) {
    if (!o?.from || !o?.to || o.from === o.to) continue;
    const { error: copyError } = await supabase.storage.from(o.bucket).copy(o.from, o.to);
    if (copyError) missing.push(o.to.split('/').pop() ?? o.to);
  }
  return { projectId: result.project_id, missing };
}
