import { createClient } from './client';
import { dbError } from './errors';
import { listFolders } from './folders';
import { folderChain } from '@/lib/folders/inheritance';
import type { FolderDocument, FolderFact, ProjectFolder } from '@/types/project';

/**
 * A folder's rules and documents (Sean, 23 Nov: "Workspace: ... facts and
 * requirements ... Client folder: agreements, contacts, and requirements that
 * carry across searches ... Search folder: the position spec, prerequisites,
 * instructions for that assignment").
 *
 * Append-only, like a project's facts: a rule is recorded, superseded by a new
 * one, or retired; a document is added or taken out. The browser writes under
 * RLS; every project below a folder sends what is in force with each request
 * (`lib/folders/inheritance.ts`).
 */

const FACT_COLUMNS =
  'id, folder_id, user_id, statement, subject, kind, required, source_kind, source_ref, origin, supersedes, overrides, retired_at, retired_reason, created_at';
const DOC_COLUMNS = 'id, folder_id, user_id, name, text, source_ref, retired_at, retired_reason, created_at';
/** A document's text without its body, for lists that only name it. */
const DOC_HEAD_COLUMNS = 'id, folder_id, user_id, name, source_ref, retired_at, retired_reason, created_at';

export const FOLDER_DOC_MAX_CHARS = 1_000_000;

export interface NewFolderFact {
  statement: string;
  subject?: string | null;
  kind?: FolderFact['kind'];
  required?: boolean;
  source_kind?: FolderFact['source_kind'];
  source_ref?: Record<string, unknown>;
  /** A default of a folder above this one, replaced here and below. Never a required rule. */
  overrides?: string | null;
}

/** Every rule, current and retired, of the given folders; oldest first. */
export async function listFolderFacts(folderIds: readonly string[]): Promise<FolderFact[]> {
  if (!folderIds.length) return [];
  const { data, error, status } = await createClient()
    .from('folder_facts')
    .select(FACT_COLUMNS)
    .in('folder_id', [...folderIds])
    .order('created_at', { ascending: true });
  if (error) throw dbError(error, status);
  return (data ?? []) as unknown as FolderFact[];
}

/** The current documents of the given folders, with their text; oldest first. */
export async function listFolderDocuments(folderIds: readonly string[], withText = true): Promise<FolderDocument[]> {
  if (!folderIds.length) return [];
  const { data, error, status } = await createClient()
    .from('folder_documents')
    .select(withText ? DOC_COLUMNS : DOC_HEAD_COLUMNS)
    .in('folder_id', [...folderIds])
    .is('retired_at', null)
    .order('created_at', { ascending: true });
  if (error) throw dbError(error, status);
  return ((data ?? []) as unknown as FolderDocument[]).map((d) => ({ ...d, text: d.text ?? '' }));
}

export async function addFolderFact(folder: { id: string; user_id: string }, fact: NewFolderFact): Promise<FolderFact> {
  const kind = fact.required ? 'requirement' : (fact.kind ?? 'requirement');
  const { data, error, status } = await createClient()
    .from('folder_facts')
    .insert({
      folder_id: folder.id,
      user_id: folder.user_id,
      statement: fact.statement.trim(),
      subject: fact.subject?.trim() || null,
      kind,
      required: Boolean(fact.required),
      source_kind: fact.source_kind ?? 'typed',
      source_ref: fact.source_ref ?? {},
      ...(fact.overrides ? { overrides: fact.overrides } : {}),
    })
    .select(FACT_COLUMNS)
    .single();
  if (error) throw dbError(error, status);
  return data as unknown as FolderFact;
}

/**
 * Change a rule: a new row that supersedes it, keeping what it replaces; the
 * database retires the old one in the same insert. `required` may change.
 */
export async function supersedeFolderFact(
  old: Pick<FolderFact, 'id' | 'folder_id' | 'user_id' | 'kind' | 'subject' | 'required' | 'overrides'>,
  statement: string,
  required: boolean = old.required
): Promise<FolderFact> {
  const { data, error, status } = await createClient()
    .from('folder_facts')
    .insert({
      folder_id: old.folder_id,
      user_id: old.user_id,
      statement: statement.trim(),
      subject: old.subject,
      kind: required ? 'requirement' : old.kind,
      required,
      source_kind: 'typed',
      source_ref: { supersedes: old.id },
      supersedes: old.id,
      ...(old.overrides ? { overrides: old.overrides } : {}),
    })
    .select(FACT_COLUMNS)
    .single();
  if (error) throw dbError(error, status);
  return data as unknown as FolderFact;
}

/** Take a rule out; it stays in the folder's history. */
export async function retireFolderFact(id: string, reason: string): Promise<void> {
  const { error, status } = await createClient()
    .from('folder_facts')
    .update({ retired_at: new Date().toISOString(), retired_reason: reason.slice(0, 500) })
    .eq('id', id)
    .is('retired_at', null);
  if (error) throw dbError(error, status);
}

export async function addFolderDocument(
  folder: { id: string; user_id: string },
  doc: { name: string; text: string; source_ref?: Record<string, unknown> }
): Promise<FolderDocument> {
  const { data, error, status } = await createClient()
    .from('folder_documents')
    .insert({
      folder_id: folder.id,
      user_id: folder.user_id,
      name: doc.name.trim().slice(0, 300) || 'Document',
      text: doc.text.slice(0, FOLDER_DOC_MAX_CHARS),
      source_ref: doc.source_ref ?? {},
    })
    .select(DOC_COLUMNS)
    .single();
  if (error) throw dbError(error, status);
  return data as unknown as FolderDocument;
}

export async function retireFolderDocument(id: string, reason = 'taken out by the user'): Promise<void> {
  const { error, status } = await createClient()
    .from('folder_documents')
    .update({ retired_at: new Date().toISOString(), retired_reason: reason.slice(0, 500) })
    .eq('id', id)
    .is('retired_at', null);
  if (error) throw dbError(error, status);
}

/** What a place's folders hand down, as read: resolve it with `resolveInherited`. */
export interface InheritedSource {
  folders: ProjectFolder[];
  facts: FolderFact[];
  documents: FolderDocument[];
}

/** The folders, and the rules and documents of every folder from the top down to `folderId`. */
export async function readInherited(folderId: string | null | undefined, withText = true): Promise<InheritedSource> {
  if (!folderId) return { folders: [], facts: [], documents: [] };
  const folders = await listFolders();
  const ids = folderChain(folders, folderId).map((l) => l.id);
  const [facts, documents] = await Promise.all([listFolderFacts(ids), listFolderDocuments(ids, withText)]);
  return { folders, facts, documents };
}
