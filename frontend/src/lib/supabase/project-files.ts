import { createClient } from './client';
import type { DataPreview } from '@/lib/data/preview';
import type { ProjectFile } from '@/types/project';

const BUCKET = 'project-files';
const COLUMNS = 'id, project_id, user_id, name, path, content_type, bytes, preview, created_at';

export async function listProjectFiles(projectId: string): Promise<ProjectFile[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('project_files').select(COLUMNS).eq('project_id', projectId).order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as ProjectFile[];
}

/**
 * Attach a file: the object first, then the row that makes it part of the
 * project. A row without its object would be a file the sandbox is promised
 * and cannot read; an object without its row is only unused storage.
 */
export async function attachProjectFile(
  project: { id: string; user_id: string },
  file: File,
  preview: DataPreview
): Promise<ProjectFile> {
  const supabase = createClient();
  const path = `${project.user_id}/${project.id}/${crypto.randomUUID()}-${file.name}`;
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || 'text/plain' });
  if (upErr) throw upErr;
  const { data, error } = await supabase
    .from('project_files')
    .insert({
      project_id: project.id, user_id: project.user_id, name: file.name, path,
      content_type: file.type || 'text/plain', bytes: file.size, preview,
    })
    .select(COLUMNS)
    .single();
  if (error) {
    await supabase.storage.from(BUCKET).remove([path]).catch(() => undefined);
    throw error;
  }
  return data as unknown as ProjectFile;
}

export async function removeProjectFile(file: Pick<ProjectFile, 'id' | 'path'>): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from('project_files').delete().eq('id', file.id);
  if (error) throw error;
  await supabase.storage.from(BUCKET).remove([file.path]).catch(() => undefined);
}

/**
 * Links that display the given files for an hour, by file id. The bucket is
 * private; a link is made when a page needs to draw the file, never stored.
 */
export async function signedFileUrls(
  files: readonly Pick<ProjectFile, 'id' | 'path'>[],
  seconds = 3600
): Promise<Record<string, string>> {
  if (!files.length) return {};
  const supabase = createClient();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(files.map((f) => f.path), seconds);
  if (error) throw error;
  const byPath = new Map<string, string>();
  for (const d of (data ?? []) as { path: string | null; signedUrl: string }[]) if (d.path) byPath.set(d.path, d.signedUrl);
  const out: Record<string, string> = {};
  for (const f of files) {
    const url = byPath.get(f.path);
    if (url) out[f.id] = url;
  }
  return out;
}
