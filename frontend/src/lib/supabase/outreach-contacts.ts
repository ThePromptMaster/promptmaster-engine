import { createClient } from './client';
import type { EarlierContact } from '@/lib/outreach/contacts';
import type { OutreachHistoryRow, OutreachSuppression } from '@/types/outreach';

/**
 * Who has been contacted and who must not be (Sean, 26 Nov: "I should be able to record outreach
 * I did outside PromptMaster too … Build in a suppression list that survives another import").
 * Per user, kept apart from any project (`20261221000000_outreach_contacts.sql`).
 */

export async function listHistory(): Promise<OutreachHistoryRow[]> {
  const { data, error } = await createClient()
    .from('outreach_history')
    .select('*')
    .is('retired_at', null)
    .order('occurred_on', { ascending: false, nullsFirst: false })
    .limit(5000);
  if (error) throw error;
  return (data ?? []) as OutreachHistoryRow[];
}

/** A history row as the import's checks read it. */
export function asEarlierContact(row: OutreachHistoryRow): EarlierContact {
  return {
    address: row.address,
    ...(row.person_name ? { name: row.person_name } : {}),
    ...(row.occurred_on ? { on: row.occurred_on } : {}),
    source: row.source,
    ...(row.subject ? { subject: row.subject } : {}),
    ...(row.thread_url ? { thread_url: row.thread_url } : {}),
  };
}

export interface NewHistory {
  address: string;
  person_name?: string;
  company?: string;
  /** YYYY-MM-DD. */
  occurred_on?: string | null;
  channel?: 'email' | 'phone' | 'linkedin' | 'meeting' | 'other';
  /** 'manual': the user's own record; 'mailbox': what their Sent mail showed, recorded on their press. */
  source: 'manual' | 'mailbox';
  project_id?: string | null;
  subject?: string;
  thread_url?: string;
  note?: string;
}

export async function recordContact(userId: string, entry: NewHistory): Promise<OutreachHistoryRow> {
  const address = entry.address.trim().toLowerCase();
  const { data, error } = await createClient()
    .from('outreach_history')
    .insert({
      user_id: userId,
      address,
      domain: address.split('@')[1] ?? '',
      person_name: (entry.person_name ?? '').slice(0, 160),
      company: (entry.company ?? '').slice(0, 160),
      occurred_on: entry.occurred_on ?? null,
      channel: entry.channel ?? 'email',
      source: entry.source,
      project_id: entry.project_id ?? null,
      subject: (entry.subject ?? '').slice(0, 300),
      thread_url: entry.thread_url && /^https:\/\//.test(entry.thread_url) ? entry.thread_url.slice(0, 500) : '',
      note: (entry.note ?? '').slice(0, 500),
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as OutreachHistoryRow;
}

export async function retireContact(id: string): Promise<void> {
  const { error } = await createClient().from('outreach_history').update({ retired_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

export async function listSuppressions(): Promise<OutreachSuppression[]> {
  const { data, error } = await createClient()
    .from('outreach_suppressions')
    .select('id, address, domain, reason, note, created_at')
    .is('lifted_at', null)
    .order('created_at', { ascending: false })
    .limit(5000);
  if (error) throw error;
  return (data ?? []) as OutreachSuppression[];
}

/** Never write to this address, or to anyone at this domain. */
export async function suppress(userId: string, target: { address?: string; domain?: string }, note = ''): Promise<OutreachSuppression> {
  const address = target.address?.trim().toLowerCase() || null;
  const domain = target.domain?.trim().toLowerCase().replace(/^@/, '') || null;
  const { data, error } = await createClient()
    .from('outreach_suppressions')
    .insert({ user_id: userId, address, domain, reason: 'manual', note: note.slice(0, 500) })
    .select('id, address, domain, reason, note, created_at')
    .single();
  if (error) throw error;
  return data as OutreachSuppression;
}

/** A manual one can be lifted; an opt-out or a complaint never (the database refuses). */
export async function liftSuppression(id: string): Promise<void> {
  const { error } = await createClient().from('outreach_suppressions').update({ lifted_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}
