import { createClient } from './client';
import { dbError } from './errors';
import { listFolders } from './folders';
import { folderChain } from '@/lib/folders/inheritance';
import type { FolderConflict, FolderDocument, FolderException, FolderFact, ProjectFolder } from '@/types/project';

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
  /** Current exceptions recorded in the chain's folders or for the project. */
  exceptions: FolderException[];
  /** Mismatches recorded against the chain's rules. */
  conflicts: FolderConflict[];
}

const EMPTY_SOURCE: InheritedSource = { folders: [], facts: [], documents: [], exceptions: [], conflicts: [] };

/**
 * The folders, and the rules, documents, exceptions and mismatches of every
 * folder from the top down to `folderId` (and the project's own exceptions).
 */
export async function readInherited(folderId: string | null | undefined, withText = true, projectId?: string | null): Promise<InheritedSource> {
  if (!folderId) return EMPTY_SOURCE;
  const folders = await listFolders();
  const ids = folderChain(folders, folderId).map((l) => l.id);
  const [facts, documents, exceptions] = await Promise.all([
    listFolderFacts(ids),
    listFolderDocuments(ids, withText),
    listFolderExceptions(ids, projectId ?? null),
  ]);
  const conflicts = await listFolderConflicts(facts.filter((f) => !f.retired_at).map((f) => f.id));
  return { folders, facts, documents, exceptions, conflicts };
}

const EXCEPTION_COLUMNS =
  'id, user_id, folder_id, project_id, rule_id, statement, authorised_by, how_confirmed, reason, from_note, retired_at, retired_reason, created_at';
const CONFLICT_COLUMNS =
  'id, user_id, upper_fact_id, lower_folder_fact_id, lower_project_fact_id, upper_quote, lower_quote, explanation, dismissed_at, created_at';

/** The current exceptions recorded in these folders, and for this project. */
export async function listFolderExceptions(folderIds: readonly string[], projectId: string | null): Promise<FolderException[]> {
  if (!folderIds.length && !projectId) return [];
  const scope = [
    folderIds.length ? `folder_id.in.(${folderIds.join(',')})` : '',
    projectId ? `project_id.eq.${projectId}` : '',
  ].filter(Boolean).join(',');
  const { data, error, status } = await createClient()
    .from('folder_exceptions')
    .select(EXCEPTION_COLUMNS)
    .or(scope)
    .is('retired_at', null)
    .order('created_at', { ascending: true });
  if (error) throw dbError(error, status);
  return (data ?? []) as unknown as FolderException[];
}

/** The mismatches recorded against these rules, open or not. */
export async function listFolderConflicts(upperIds: readonly string[]): Promise<FolderConflict[]> {
  if (!upperIds.length) return [];
  const { data, error, status } = await createClient()
    .from('folder_conflicts')
    .select(CONFLICT_COLUMNS)
    .in('upper_fact_id', [...upperIds])
    .order('created_at', { ascending: true });
  if (error) throw dbError(error, status);
  return (data ?? []) as unknown as FolderConflict[];
}

export interface NewConflict {
  upper_fact_id: string;
  lower_folder_fact_id?: string | null;
  lower_project_fact_id?: string | null;
  upper_quote: string;
  lower_quote: string;
  explanation?: string;
}

/** Record the mismatches a check found; a pair already on record is left as it is. */
export async function recordConflicts(userId: string, rows: readonly NewConflict[]): Promise<void> {
  if (!rows.length) return;
  const { error, status } = await createClient()
    .from('folder_conflicts')
    .insert(rows.map((r) => ({
      user_id: userId,
      upper_fact_id: r.upper_fact_id,
      lower_folder_fact_id: r.lower_folder_fact_id ?? null,
      lower_project_fact_id: r.lower_project_fact_id ?? null,
      upper_quote: r.upper_quote.slice(0, 600),
      lower_quote: r.lower_quote.slice(0, 600),
      explanation: (r.explanation ?? '').slice(0, 600),
    })));
  // The same pair found again: already on record.
  if (error && error.code !== '23505') throw dbError(error, status);
}

/** "Not a mismatch": the user's word, once. */
export async function dismissConflict(id: string): Promise<void> {
  const { error, status } = await createClient()
    .from('folder_conflicts')
    .update({ dismissed_at: new Date().toISOString() })
    .eq('id', id)
    .is('dismissed_at', null);
  if (error) throw dbError(error, status);
}

export interface NewException {
  rule_id: string;
  folder_id?: string | null;
  project_id?: string | null;
  statement: string;
  authorised_by: string;
  how_confirmed: string;
  reason: string;
  from_note?: Record<string, unknown>;
}

/** Record that a rule does not apply in one place, with who authorised it, how that was confirmed and why. */
export async function recordException(userId: string, e: NewException): Promise<FolderException> {
  const { data, error, status } = await createClient()
    .from('folder_exceptions')
    .insert({
      user_id: userId,
      rule_id: e.rule_id,
      folder_id: e.folder_id ?? null,
      project_id: e.project_id ?? null,
      statement: e.statement.trim(),
      authorised_by: e.authorised_by.trim(),
      how_confirmed: e.how_confirmed.trim(),
      reason: e.reason.trim(),
      from_note: e.from_note ?? {},
    })
    .select(EXCEPTION_COLUMNS)
    .single();
  if (error) throw dbError(error, status);
  return data as unknown as FolderException;
}

/** Revoke an exception: the rule applies there again. */
export async function revokeException(id: string, reason = 'revoked by the user'): Promise<void> {
  const { error, status } = await createClient()
    .from('folder_exceptions')
    .update({ retired_at: new Date().toISOString(), retired_reason: reason.slice(0, 500) })
    .eq('id', id)
    .is('retired_at', null);
  if (error) throw dbError(error, status);
}
