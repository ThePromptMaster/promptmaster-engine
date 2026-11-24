import { createClient } from './client';
import { dbError } from './errors';
import { appendWorkflowEvent, getLatestTemplate, getTemplateById, publishUserTemplate } from './workflow';
import { createArtifact } from './versions';
import { createProject } from './projects';
import { copyOf, mergeFromMaster, withStageEdit, type MergeResult } from '@/lib/folders/template-lineage';
import { validateTemplate } from '@/lib/workflow/validate';
import type { StageDefinition, WorkflowTemplate } from '@/lib/workflow/types';

/**
 * Workflows a folder offers, copied from a master and kept up to date with it on
 * the user's word (Sean, 23 Nov: "Copy and edit templates at any level. Show
 * which version a copy came from. If the master changes later, show what changed
 * and let the team choose whether to apply it to an active search.").
 */

export interface FolderTemplateRow {
  id: string;
  user_id: string;
  folder_id: string;
  template_key: string;
  removed_at: string | null;
  created_at: string;
}

export type TemplateWithLineage = WorkflowTemplate & { id: string; copied_from_id: string | null };

const ROW_COLUMNS = 'id, user_id, folder_id, template_key, removed_at, created_at';

/** The workflows offered in these folders, oldest first. */
export async function listFolderTemplates(folderIds: readonly string[]): Promise<FolderTemplateRow[]> {
  if (!folderIds.length) return [];
  const { data, error, status } = await createClient()
    .from('folder_templates')
    .select(ROW_COLUMNS)
    .in('folder_id', [...folderIds])
    .is('removed_at', null)
    .order('created_at', { ascending: true });
  if (error) throw dbError(error, status);
  return (data ?? []) as unknown as FolderTemplateRow[];
}

/** Offer a workflow (its key, so every later version) in a folder. */
export async function addFolderTemplate(folder: { id: string; user_id: string }, key: string): Promise<void> {
  const { error, status } = await createClient().from('folder_templates').insert({ user_id: folder.user_id, folder_id: folder.id, template_key: key });
  if (error) throw dbError(error, status);
}

export async function removeFolderTemplate(id: string): Promise<void> {
  const { error, status } = await createClient().from('folder_templates').update({ removed_at: new Date().toISOString() }).eq('id', id).is('removed_at', null);
  if (error) throw dbError(error, status);
}

/** Where a version came from, by id. */
async function copiedFrom(ids: readonly string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (!ids.length) return out;
  const { data, error, status } = await createClient().from('workflow_templates').select('id, copied_from_id').in('id', [...ids]);
  if (error) throw dbError(error, status);
  for (const r of (data ?? []) as { id: string; copied_from_id: string | null }[]) out.set(r.id, r.copied_from_id);
  return out;
}

/** The latest version of each key, with what it was copied from. */
export async function latestWithLineage(keys: readonly string[]): Promise<Map<string, TemplateWithLineage>> {
  const latest = await Promise.all([...new Set(keys)].map((k) => getLatestTemplate(k).catch(() => null)));
  const found = latest.filter((t): t is WorkflowTemplate & { id: string } => Boolean(t));
  const from = await copiedFrom(found.map((t) => t.id));
  return new Map(found.map((t) => [t.key, { ...t, copied_from_id: from.get(t.id) ?? null }]));
}

export async function templateWithLineage(id: string): Promise<TemplateWithLineage | null> {
  const t = await getTemplateById(id);
  if (!t) return null;
  return { ...t, copied_from_id: (await copiedFrom([id])).get(id) ?? null };
}

function newKey(): string {
  return `custom_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
}

function checked(template: WorkflowTemplate): WorkflowTemplate {
  const problems = validateTemplate(template, { requireHints: false, requireAuthority: false });
  if (problems.length) throw new Error(problems[0]);
  return template;
}

/** Copy a workflow's latest version into a folder: a key of its own, version 1, that remembers its master. */
export async function copyIntoFolder(source: WorkflowTemplate & { id: string }, folder: { id: string; user_id: string }): Promise<TemplateWithLineage> {
  const copy = await publishUserTemplate(checked(copyOf(source, newKey())), folder.user_id, { listed: false, copiedFromId: source.id });
  const { error, status } = await createClient().from('folder_templates').insert({ user_id: folder.user_id, folder_id: folder.id, template_key: copy.key });
  if (error) throw dbError(error, status);
  return { ...copy, copied_from_id: source.id };
}

/** A copy's next version, with one stage's wording changed. */
export async function editCopyStage(
  copy: TemplateWithLineage,
  stageId: string,
  edit: Partial<Pick<StageDefinition, 'label' | 'entry_prompt_hint' | 'entry_guidance'>>,
  userId: string
): Promise<TemplateWithLineage> {
  const next = await publishUserTemplate(checked(withStageEdit(copy, stageId, edit)), userId, { listed: false, copiedFromId: copy.copied_from_id });
  return { ...next, copied_from_id: copy.copied_from_id };
}

/** What the master of a copy is now, and the version the copy was made from; null when it has none or none newer. */
export async function masterUpdate(copy: TemplateWithLineage): Promise<{ base: WorkflowTemplate & { id: string }; master: WorkflowTemplate & { id: string } } | null> {
  if (!copy.copied_from_id) return null;
  const base = await getTemplateById(copy.copied_from_id);
  if (!base || base.key === copy.key) return null;
  const master = await getLatestTemplate(base.key);
  return master && master.version > base.version ? { base, master } : null;
}

/** Take the master's changes into the copy, as its next version; the copy then remembers the master's version. */
export async function applyMasterToCopy(copy: TemplateWithLineage, userId: string): Promise<{ copy: TemplateWithLineage; kept: MergeResult['keptOurs'] }> {
  const update = await masterUpdate(copy);
  if (!update) throw new Error('The master has not changed since this copy was made.');
  const merged = mergeFromMaster(update.base, copy, update.master);
  const next = await publishUserTemplate(checked(merged.template), userId, { listed: false, copiedFromId: update.master.id });
  return { copy: { ...next, copied_from_id: update.master.id }, kept: merged.keptOurs };
}

/**
 * A new project filed in the folder, pinned to this version of the workflow. Its
 * brief is filled in on its first stage, as any project's is.
 */
export async function startProjectFrom(
  template: WorkflowTemplate & { id: string },
  folder: { id: string; user_id: string },
  language?: string,
  /** What the project is for, asked before it is made: its first stage drafts itself against it. */
  objective = '',
  /** Material to start with (the sample's transcript). */
  context = ''
): Promise<string> {
  const goal = objective.trim();
  const title = goal ? (goal.length > 80 ? `${goal.slice(0, 79).replace(/\s+\S*$/, '')}…` : goal) : template.name;
  const project = await createProject(
    { title, objective: goal, workflow: template.key, folder_id: folder.id, ...(context ? { context } : {}), ...(language ? { language } : {}) },
    folder.user_id
  );
  const first = template.stages[0];
  const { error } = await createClient()
    .from('projects')
    .update({ workflow_template_id: template.id, stage: first?.id ?? '' })
    .eq('id', project.id);
  if (error) throw error;
  await createArtifact(project.id, folder.user_id, 'output', 'Output');
  await appendWorkflowEvent(project.id, folder.user_id, { type: 'project_created', stage_id: first?.id ?? '' });
  return project.id;
}
