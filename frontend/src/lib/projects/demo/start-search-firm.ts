import { createClient } from '@/lib/supabase/client';
import { createFolder } from '@/lib/supabase/folders';
import { addFolderDocument, addFolderFact, recordException, retireFolderFact } from '@/lib/supabase/folder-rules';
import { addFolderTemplate, copyIntoFolder, startProjectFrom } from '@/lib/supabase/folder-templates';
import { publishUserTemplate } from '@/lib/supabase/workflow';
import { templateFromDesign } from '@/lib/workflow/custom';
import { withStageEdit } from '@/lib/folders/template-lineage';
import {
  ENGAGEMENT_TERMS,
  MASTER_V2_REVIEW_INSTRUCTION,
  POSITION_SPEC,
  SAMPLE_EXCEPTION,
  SAMPLE_NAMES,
  SAMPLE_RULES,
  SAMPLE_TRANSCRIPT,
  TRANSCRIPT_REVIEW,
} from './search-firm';

/**
 * Make the sample search-firm workspace in the user's account (`search-firm.ts`):
 * the firm, one client with a required reference rule, a format default and its
 * engagement terms, a search with an exception recorded and its position spec,
 * a second search on the client's default, a transcript-review workflow at the
 * firm with a client copy one version behind, and one interview review to run.
 * Nothing is drafted here. Returns the workspace folder and the project.
 */
export async function startSearchFirmSample(userId: string, language?: string): Promise<{ workspaceId: string; projectId: string }> {
  const ws = await createFolder(userId, SAMPLE_NAMES.workspace, null, 'workspace', 'executive_search');
  await addFolderFact(ws, { statement: SAMPLE_RULES.workspace });

  const client = await createFolder(userId, SAMPLE_NAMES.client, ws.id, 'client');
  const refs = await addFolderFact(client, { statement: SAMPLE_RULES.clientRequired, required: true });
  await addFolderFact(client, { statement: SAMPLE_RULES.clientDefault });
  await addFolderDocument(client, { name: 'Engagement terms.txt', text: ENGAGEMENT_TERMS, source_ref: { sample: true, chars: ENGAGEMENT_TERMS.length } });

  const search = await createFolder(userId, SAMPLE_NAMES.searchWithException, client.id, 'search');
  await addFolderDocument(search, { name: 'Position specification.txt', text: POSITION_SPEC, source_ref: { sample: true, chars: POSITION_SPEC.length } });
  const note = await addFolderFact(search, { statement: SAMPLE_RULES.searchNote, source_kind: 'note' });
  await recordException(userId, {
    rule_id: refs.id,
    folder_id: search.id,
    statement: note.statement,
    ...SAMPLE_EXCEPTION,
    from_note: { kind: 'folder_fact', id: note.id, statement: note.statement },
  });
  await retireFolderFact(note.id, 'recorded as an exception');
  await createFolder(userId, SAMPLE_NAMES.searchDefault, client.id, 'search');

  // The firm's workflow, a client copy of it, then a newer firm version the copy has not taken yet.
  const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 10);
  const master = await publishUserTemplate(templateFromDesign(TRANSCRIPT_REVIEW, suffix), userId, { listed: false });
  await addFolderTemplate(ws, master.key);
  const copy = await copyIntoFolder(master, client);
  await publishUserTemplate(withStageEdit(master, master.stages[1].id, { entry_prompt_hint: MASTER_V2_REVIEW_INSTRUCTION }), userId, { listed: false });

  const projectId = await startProjectFrom(
    copy,
    search,
    language,
    "Review Priya Raman's first interview for the Finance Director search: the topics the search must cover, what she said on each, the follow-up questions, and notes for the candidate report.",
    `### From Interview transcript.txt\n\n${SAMPLE_TRANSCRIPT}`
  );
  // Invented material only, like the other samples: nothing from the person's accounts or the web
  // (24 Nov pass: the sample's first draft brought in unrelated emails from a connected account).
  const { error } = await createClient().from('projects').update({ web_access: 'off', account_search: 'off' }).eq('id', projectId);
  if (error) throw error;
  return { workspaceId: ws.id, projectId };
}
