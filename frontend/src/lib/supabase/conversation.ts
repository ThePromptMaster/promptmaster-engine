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
