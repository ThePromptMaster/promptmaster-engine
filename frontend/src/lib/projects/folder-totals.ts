/**
 * Projects held in the folders inside a folder (26 Nov). The list and the counts are of
 * projects filed directly in a folder, so a workspace whose projects all sit in its clients'
 * searches read "Nothing in … yet". Pure.
 */
import type { ProjectFolder } from '@/types/project';

/** Projects in `folderId` and every folder below it. `counts` is per folder id ('' is Unfiled). */
export function totalWithin(folderId: string, folders: readonly ProjectFolder[], counts: Readonly<Record<string, number>>): number {
  const seen = new Set<string>();
  const walk = (id: string): number => {
    if (seen.has(id)) return 0;
    seen.add(id);
    return (counts[id] ?? 0) + folders.filter((f) => f.parent_id === id).reduce((sum, f) => sum + walk(f.id), 0);
  };
  return walk(folderId);
}

/** The folders directly inside `folderId` that hold projects somewhere below, with how many. */
export function foldersHolding(
  folderId: string,
  folders: readonly ProjectFolder[],
  counts: Readonly<Record<string, number>>
): { folder: ProjectFolder; total: number }[] {
  return folders
    .filter((f) => f.parent_id === folderId)
    .map((folder) => ({ folder, total: totalWithin(folder.id, folders, counts) }))
    .filter((x) => x.total > 0);
}
