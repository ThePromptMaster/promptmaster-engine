import { createClient } from './client';
import type { FolderKind, ProjectFolder } from '@/types/project';

/**
 * A user's folders for projects (client, 21 Oct, email 5: "organizing
 * projects and folders ... however someone wants to freely organize").
 * Up to five levels deep (workspace › client › search › subfolder, Sean, 23
 * Nov); the database refuses deeper or circular trees.
 */

const COLUMNS = 'id, user_id, parent_id, name, position, kind, created_at, updated_at';

/** How deep folders go; the database refuses a sixth level. */
export const MAX_FOLDER_DEPTH = 5;

/**
 * The kind a new folder takes under its parent: a client under a workspace, a
 * search under a client. A top-level folder is a plain folder until its owner
 * calls it a workspace; nobody filing projects is made to think in workspaces.
 */
export function kindUnder(parent: Pick<ProjectFolder, 'kind'> | null | undefined): FolderKind | null {
  if (!parent) return null;
  if (parent.kind === 'workspace') return 'client';
  if (parent.kind === 'client') return 'search';
  return parent.kind ? 'folder' : null;
}

export const FOLDER_NAME_MAX = 80;

export async function listFolders(): Promise<ProjectFolder[]> {
  const { data, error } = await createClient()
    .from('project_folders')
    .select(COLUMNS)
    .order('position', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw error;
  return (data ?? []) as ProjectFolder[];
}

export async function createFolder(userId: string, name: string, parentId: string | null = null, kind: FolderKind | null = null): Promise<ProjectFolder> {
  const { data, error } = await createClient()
    .from('project_folders')
    .insert({ user_id: userId, name: name.trim().slice(0, FOLDER_NAME_MAX), parent_id: parentId, ...(kind ? { kind } : {}) })
    .select(COLUMNS)
    .single();
  if (error || !data) throw error ?? new Error('The folder could not be made.');
  return data as ProjectFolder;
}

export async function renameFolder(id: string, name: string): Promise<void> {
  const { error } = await createClient()
    .from('project_folders')
    .update({ name: name.trim().slice(0, FOLDER_NAME_MAX) })
    .eq('id', id);
  if (error) throw error;
}

/** What the folder stands for: a label only, used in wording. */
export async function setFolderKind(id: string, kind: FolderKind | null): Promise<void> {
  const { error } = await createClient().from('project_folders').update({ kind }).eq('id', id);
  if (error) throw error;
}

export async function moveFolder(id: string, parentId: string | null): Promise<void> {
  const { error } = await createClient().from('project_folders').update({ parent_id: parentId }).eq('id', id);
  if (error) throw error;
}

/** Its projects become Unfiled and the folders inside it move to the top level; nothing else is deleted. */
export async function deleteFolder(id: string): Promise<void> {
  const { error } = await createClient().from('project_folders').delete().eq('id', id);
  if (error) throw error;
}

/** How many live projects each folder holds, and how many are Unfiled (key ''). */
export async function folderCounts(): Promise<Record<string, number>> {
  const { data, error } = await createClient().from('projects').select('folder_id').is('deleted_at', null);
  if (error) throw error;
  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as { folder_id: string | null }[]) {
    const key = row.folder_id ?? '';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

export interface FolderNode extends ProjectFolder {
  depth: number;
  children: FolderNode[];
}

/** The folders as a tree, in order; a folder whose parent is missing shows at the top. */
export function folderTree(folders: readonly ProjectFolder[]): FolderNode[] {
  const ids = new Set(folders.map((f) => f.id));
  const build = (parent: string | null, depth: number, seen: Set<string>): FolderNode[] =>
    folders
      .filter((f) => (parent === null ? !f.parent_id || !ids.has(f.parent_id) : f.parent_id === parent) && !seen.has(f.id))
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
      .map((f) => {
        const next = new Set(seen).add(f.id);
        return { ...f, depth, children: build(f.id, depth + 1, next) };
      });
  return build(null, 0, new Set());
}

/** The tree flattened in display order, each with its depth. */
export function flattenTree(nodes: readonly FolderNode[]): FolderNode[] {
  return nodes.flatMap((n) => [n, ...flattenTree(n.children)]);
}

/** A folder and everything under it: where a folder may not be moved into. */
export function descendantsOf(folders: readonly ProjectFolder[], id: string): Set<string> {
  const out = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) {
      if (f.parent_id && out.has(f.parent_id) && !out.has(f.id)) {
        out.add(f.id);
        grew = true;
      }
    }
  }
  return out;
}
