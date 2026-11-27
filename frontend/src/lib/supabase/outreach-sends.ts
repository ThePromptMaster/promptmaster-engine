import { createClient } from './client';
import type { Snapshot, SnapshotPurpose } from '@/lib/outreach/snapshot';

/**
 * Approvals and sends (26 Nov, `20261222000000_outreach_sends.sql`). The browser writes an
 * approval (the exact email and its ticket) and asks for sends to be scheduled, paused, held or
 * cancelled through functions that check it is the caller's. It never writes a send's status:
 * the server does, as the email goes.
 */

export interface ApprovalRecord {
  id: string;
  project_id: string;
  stage_id: string;
  draft_id: string;
  purpose: SnapshotPurpose;
  snapshot: Snapshot;
  message_hash: string;
  approved_at: string;
  revoked_at: string | null;
  revoked_reason: string | null;
}

export type SendStatus = 'scheduled' | 'paused' | 'held' | 'submitting' | 'submitted' | 'confirmed' | 'bounced' | 'failed' | 'cancelled';

export interface SendRecord {
  id: string;
  approval_id: string;
  purpose: SnapshotPurpose;
  status: SendStatus;
  status_reason: string;
  scheduled_for: string;
  to_address: string;
  provider_message_id: string;
  thread_url: string;
  sent_copy_matches: boolean | null;
  submitted_at: string | null;
  confirmed_at: string | null;
  failed_at: string | null;
  /** A follow-up's first email. */
  parent_send_id?: string | null;
}

/** What came back for an email (27 Nov): written by the job runner, read here. */
export interface InboundRecord {
  id: string;
  send_id: string;
  kind: 'reply' | 'auto_reply' | 'bounce' | 'opt_out';
  from_address: string;
  subject: string;
  text: string;
  company_domain: string;
  received_at: string | null;
  handled_at: string | null;
}

export async function listInbound(projectId: string): Promise<InboundRecord[]> {
  const { data, error } = await createClient()
    .from('outreach_inbound')
    .select('id, send_id, kind, from_address, subject, text, company_domain, received_at, handled_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as InboundRecord[];
}

/** Ask the job runner to read what came back now (once per ten minutes per project). True when one was queued. */
export async function requestWatch(projectId: string): Promise<boolean> {
  const { data, error } = await createClient().rpc('request_outreach_watch', { p_project: projectId });
  if (error) throw error;
  return Boolean(data);
}

export interface NewApproval {
  id: string;
  stage_id: string;
  message_stage_id: string;
  draft_id: string;
  purpose: SnapshotPurpose;
  snapshot: Snapshot;
  message_hash: string;
  ticket: string;
  batch_id?: string | null;
}

export async function createApprovals(userId: string, projectId: string, rows: NewApproval[]): Promise<void> {
  if (!rows.length) return;
  const { error } = await createClient()
    .from('outreach_approvals')
    .insert(rows.map((r) => ({ ...r, user_id: userId, project_id: projectId })));
  if (error) throw error;
}

export async function listApprovals(projectId: string): Promise<ApprovalRecord[]> {
  const { data, error } = await createClient()
    .from('outreach_approvals')
    .select('id, project_id, stage_id, draft_id, purpose, snapshot, message_hash, approved_at, revoked_at, revoked_reason')
    .eq('project_id', projectId)
    .order('approved_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ApprovalRecord[];
}

/** Withdraw an approval that has no send yet (one with a send is withdrawn by `moveSends`). */
export async function revokeApproval(id: string, reason: string): Promise<void> {
  const { error } = await createClient().from('outreach_approvals').update({ revoked_at: new Date().toISOString(), revoked_reason: reason.slice(0, 500) }).eq('id', id).is('revoked_at', null);
  if (error) throw error;
}

export async function listSends(projectId: string): Promise<SendRecord[]> {
  const { data, error } = await createClient()
    .from('outreach_sends')
    .select('id, approval_id, purpose, status, status_reason, scheduled_for, to_address, provider_message_id, thread_url, sent_copy_matches, submitted_at, confirmed_at, failed_at, parent_send_id')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as SendRecord[];
}

/** Queue approved emails: one job each, `spacingSeconds` apart from `first`. */
export async function scheduleSends(projectId: string, approvalIds: string[], first: Date, spacingSeconds: number): Promise<SendRecord[]> {
  const { data, error } = await createClient().rpc('schedule_outreach_sends', {
    p_project: projectId,
    p_approvals: approvalIds,
    p_first: first.toISOString(),
    p_spacing_seconds: spacingSeconds,
  });
  if (error) throw error;
  return (data ?? []) as SendRecord[];
}

/** Pause, resume (`scheduled`), hold or cancel sends not yet in the mailbox's hands. */
export async function moveSends(sendIds: string[], to: 'paused' | 'scheduled' | 'held' | 'cancelled', reason = '', revoke = false): Promise<number> {
  const { data, error } = await createClient().rpc('move_outreach_sends', { p_sends: sendIds, p_to: to, p_reason: reason, p_revoke: revoke });
  if (error) throw error;
  return Number(data ?? 0);
}
