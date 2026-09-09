import { createClient } from './client';
import type { ChatMessage, ChatRole } from '@/types';

interface ConversationMessageRow {
  id: string;
  iteration_number: number;
  role: ChatRole;
  content: string;
  created_at: string;
}

function rowToMessage(row: ConversationMessageRow): ChatMessage {
  return {
    id: row.id,
    iteration_number: row.iteration_number,
    role: row.role,
    content: row.content,
    created_at: row.created_at,
  };
}


/**
 * Load every message for a session, grouped by iteration_number.
 */
export async function loadAllMessagesForSession(
  sessionId: string
): Promise<Record<number, ChatMessage[]>> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return {};

  const { data, error } = await supabase
    .from('conversation_messages')
    .select('id, iteration_number, role, content, created_at')
    .eq('user_id', user.id)
    .eq('session_id', sessionId)
    .order('iteration_number', { ascending: true })
    .order('created_at', { ascending: true });

  if (error || !data) return {};

  const grouped: Record<number, ChatMessage[]> = {};
  for (const row of data as ConversationMessageRow[]) {
    const msg = rowToMessage(row);
    if (!grouped[msg.iteration_number]) grouped[msg.iteration_number] = [];
    grouped[msg.iteration_number].push(msg);
  }
  return grouped;
}

/**
 * Persist a new message. Returns the saved row (with server-generated id +
 * created_at). For unauthenticated users, returns the input unchanged with
 * client-generated id/created_at — chat works in-memory only.
 */
export async function saveMessage(
  msg: Omit<ChatMessage, 'id' | 'created_at'> & { session_id: string }
): Promise<ChatMessage> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return {
      id: crypto.randomUUID(),
      iteration_number: msg.iteration_number,
      role: msg.role,
      content: msg.content,
      created_at: new Date().toISOString(),
    };
  }

  const { data, error } = await supabase
    .from('conversation_messages')
    .insert({
      user_id: user.id,
      session_id: msg.session_id,
      iteration_number: msg.iteration_number,
      role: msg.role,
      content: msg.content,
    })
    .select('id, iteration_number, role, content, created_at')
    .single();

  if (error || !data) {
    return {
      id: crypto.randomUUID(),
      iteration_number: msg.iteration_number,
      role: msg.role,
      content: msg.content,
      created_at: new Date().toISOString(),
    };
  }
  return rowToMessage(data as ConversationMessageRow);
}

// --- the stage-scoped side chat (FR-08) -------------------------------------
//
// The workflow chat is keyed by (project_id, stage_id), not by the legacy
// (session_id, iteration_number). Both readers coexist on one table: the
// functions above serve the imported /session history, these serve the
// workspace. `stage_id` and `meta` were added additively for exactly this —
// see 20260909000000_conversation_stage_key.sql.
//
// `session_id` is `not null` on the table and has no foreign key, so a stage
// thread writes the project id into it. That keeps the legacy grouped reader
// from ever collecting a workflow message into a session it does not belong
// to, and costs nothing: nothing joins on that column.

/** Which side-chat mode a message was sent in. Persisted, never inferred. */
export type ChatMode = 'discuss' | 'instruct';

export interface StageChatMessage extends ChatMessage {
  mode: ChatMode;
  /** Instruct only: what the revision was applied to, for the replayed thread. */
  scope?: string | null;
  /** Instruct only: the version the revision produced, once accepted. */
  appliedVersionId?: string | null;
}

interface StageChatMeta {
  mode?: ChatMode;
  scope?: string | null;
  applied_version_id?: string | null;
}

interface StageRow extends ConversationMessageRow {
  meta: StageChatMeta | null;
}

function rowToStageMessage(row: StageRow): StageChatMessage {
  const meta = row.meta ?? {};
  return {
    ...rowToMessage(row),
    // A row written before modes existed is a discussion: it changed nothing,
    // because nothing at the time could.
    mode: meta.mode === 'instruct' ? 'instruct' : 'discuss',
    scope: meta.scope ?? null,
    appliedVersionId: meta.applied_version_id ?? null,
  };
}

const STAGE_COLUMNS = 'id, iteration_number, role, content, created_at, meta';

/**
 * The chat thread for one stage of one project, oldest first.
 *
 * Returns [] rather than throwing for a signed-out reader or a failed query:
 * the chat is an aid to the work, so a history that cannot be fetched must
 * degrade to an empty panel rather than take the workspace down with it.
 */
export async function loadStageChat(
  projectId: string,
  stageId: string
): Promise<StageChatMessage[]> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('conversation_messages')
    .select(STAGE_COLUMNS)
    .eq('user_id', user.id)
    .eq('project_id', projectId)
    .eq('stage_id', stageId)
    .order('created_at', { ascending: true });

  if (error || !data) return [];
  return (data as StageRow[]).map(rowToStageMessage);
}

/**
 * Persist one side-chat message.
 *
 * Falls back to an in-memory message when there is no signed-in user or the
 * write fails, so the chat still works on the preview surface and does not
 * discard the reply the user is part-way through reading. A caller can tell
 * the difference — an unsaved message carries a client-generated id — but
 * deliberately does not have to.
 */
export async function saveStageChatMessage(msg: {
  project_id: string;
  stage_id: string;
  version_id?: string | null;
  iteration_number: number;
  role: ChatRole;
  content: string;
  mode: ChatMode;
  scope?: string | null;
  applied_version_id?: string | null;
}): Promise<StageChatMessage> {
  const local = (): StageChatMessage => ({
    id: crypto.randomUUID(),
    iteration_number: msg.iteration_number,
    role: msg.role,
    content: msg.content,
    created_at: new Date().toISOString(),
    mode: msg.mode,
    scope: msg.scope ?? null,
    appliedVersionId: msg.applied_version_id ?? null,
  });

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return local();

  const meta: StageChatMeta = {
    mode: msg.mode,
    scope: msg.scope ?? null,
    applied_version_id: msg.applied_version_id ?? null,
  };

  const { data, error } = await supabase
    .from('conversation_messages')
    .insert({
      user_id: user.id,
      // Not null on the table, and no foreign key. See the note above.
      session_id: msg.project_id,
      project_id: msg.project_id,
      stage_id: msg.stage_id,
      version_id: msg.version_id ?? null,
      iteration_number: msg.iteration_number,
      role: msg.role,
      content: msg.content,
      meta,
    })
    .select(STAGE_COLUMNS)
    .single();

  if (error || !data) return local();
  return rowToStageMessage(data as StageRow);
}

/**
 * Record that an instruction was accepted, by pointing its message at the
 * version it produced.
 *
 * Best-effort: the version is already written and recoverable by the time this
 * runs, so a failure here loses a breadcrumb, not work.
 */
export async function markStageChatApplied(
  messageId: string,
  versionId: string,
  scope: string
): Promise<void> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from('conversation_messages')
    .update({ meta: { mode: 'instruct', scope, applied_version_id: versionId } })
    .eq('id', messageId)
    .eq('user_id', user.id);
}
