/**
 * What the drain reads and writes for a send (26 Nov), with the service-role client: the send
 * and its approval, the email as it would go now (from the saved draft, message, sender,
 * signature and logo), what blocks it, and the record of what happened, which only
 * `record_outreach_send` writes, and only while this drain holds the job's lease.
 */
import { replacedIn } from '@/lib/outreach/holds';
import type { ProjectFact } from '@/types/project';
import { addBusinessDays } from '@/lib/outreach/business-days';
import type { SupabaseClient } from '@supabase/supabase-js';

import { parseDrafts, parseMessage } from '@/lib/outreach/drafts';
import { buildSnapshot, type Snapshot } from '@/lib/outreach/snapshot';
import type { OutreachLogo, OutreachSender, OutreachSignature } from '@/types/outreach';
import type { ApprovalRow, Blockers, InboundEvent, OutreachStore, SendPatch, SendRow } from './outreach-job';

const DAY_MS = 24 * 60 * 60 * 1000;

const SEND_COLUMNS = 'id, user_id, project_id, approval_id, job_id, purpose, status, to_address, parent_send_id, provider_thread_id, submitted_at, scheduled_for';
const APPROVAL_COLUMNS = 'id, user_id, project_id, stage_id, message_stage_id, draft_id, purpose, snapshot, message_hash, ticket, revoked_at';
const WATCH_DAYS = 14;

export class SupabaseOutreachStore implements OutreachStore {
  constructor(private readonly db: SupabaseClient) {}

  async parentOf(send: SendRow): Promise<{ send: SendRow; approval: ApprovalRow } | null> {
    return send.parent_send_id ? this.load(send.parent_send_id) : null;
  }

  async recordInbound(jobId: string, worker: string, sendId: string, events: readonly InboundEvent[]): Promise<number> {
    const { data, error } = await this.db.rpc('record_outreach_inbound', { p_job: jobId, p_worker: worker, p_send: sendId, p_items: events });
    if (error) throw error;
    return Number(data ?? 0);
  }

  async afterConfirmed(jobId: string, worker: string, send: SendRow, confirmedAt: number): Promise<void> {
    const { data: approval } = await this.db.from('outreach_approvals').select('project_id, user_id, message_stage_id').eq('id', send.approval_id).maybeSingle();
    const a = approval as { project_id: string; user_id: string; message_stage_id: string } | null;
    const [messageContent, { data: settings }] = await Promise.all([
      a ? this.stageContent(a.project_id, a.user_id, a.message_stage_id) : Promise.resolve(null),
      this.db.from('outreach_settings').select('timezone').eq('user_id', send.user_id).maybeSingle(),
    ]);
    const days = parseMessage(messageContent)?.followup?.after_business_days ?? 3;
    const runAfter = addBusinessDays(new Date(confirmedAt), days, (settings as { timezone?: string } | null)?.timezone || 'UTC');
    const { error } = await this.db.rpc('schedule_outreach_followup', { p_job: jobId, p_worker: worker, p_send: send.id, p_run_after: runAfter.toISOString() });
    if (error) throw error;
    await this.enqueueWatch(send.user_id, send.project_id, confirmedAt + 30 * 60 * 1000);
  }

  async watchList(projectId: string): Promise<{ send: SendRow; approval: ApprovalRow }[]> {
    const since = new Date(Date.now() - WATCH_DAYS * 86_400_000).toISOString();
    const { data: sends } = await this.db.from('outreach_sends').select(SEND_COLUMNS).eq('project_id', projectId).eq('purpose', 'send').in('status', ['submitted', 'confirmed']).gte('submitted_at', since).limit(200);
    const rows = (sends ?? []) as SendRow[];
    if (!rows.length) return [];
    const { data: approvals } = await this.db.from('outreach_approvals').select(APPROVAL_COLUMNS).in('id', rows.map((s) => s.approval_id));
    const byId = new Map(((approvals ?? []) as ApprovalRow[]).map((a) => [a.id, a]));
    return rows.flatMap((send) => (byId.has(send.approval_id) ? [{ send, approval: byId.get(send.approval_id)! }] : []));
  }

  async enqueueWatch(userId: string, projectId: string, at: number): Promise<void> {
    const bucket = new Date(at).toISOString().slice(0, 15).replace(/[-:T]/g, '');
    const { error } = await this.db.from('jobs').insert({
      user_id: userId,
      project_id: projectId,
      kind: 'outreach_watch',
      payload: { project_id: projectId },
      idempotency_key: `watch:${projectId}:${bucket}`,
      max_attempts: 3,
      run_after: new Date(at).toISOString(),
    });
    // Already queued for that ten minutes: fine.
    if (error && (error as { code?: string }).code !== '23505') throw error;
  }

  async load(sendId: string): Promise<{ send: SendRow; approval: ApprovalRow } | null> {
    const { data: send } = await this.db.from('outreach_sends').select(SEND_COLUMNS).eq('id', sendId).maybeSingle();
    if (!send) return null;
    const { data: approval } = await this.db
      .from('outreach_approvals')
      .select(APPROVAL_COLUMNS)
      .eq('id', (send as SendRow).approval_id)
      .eq('user_id', (send as SendRow).user_id)
      .maybeSingle();
    return approval ? { send: send as SendRow, approval: approval as ApprovalRow } : null;
  }

  private async stageContent(projectId: string, userId: string, stageId: string): Promise<string | null> {
    if (!stageId) return null;
    const { data: artifact } = await this.db.from('artifacts').select('current_version_id').eq('project_id', projectId).eq('user_id', userId).eq('stage_id', stageId).not('current_version_id', 'is', null).limit(1).maybeSingle();
    const versionId = (artifact as { current_version_id?: string } | null)?.current_version_id;
    if (!versionId) return null;
    const { data: version } = await this.db.from('artifact_versions').select('content').eq('id', versionId).maybeSingle();
    return (version as { content?: string } | null)?.content ?? null;
  }

  async current(approval: ApprovalRow): Promise<Snapshot | null> {
    const [draftsContent, messageContent] = await Promise.all([
      this.stageContent(approval.project_id, approval.user_id, approval.stage_id),
      this.stageContent(approval.project_id, approval.user_id, approval.message_stage_id),
    ]);
    const draft = parseDrafts(draftsContent).find((d) => d.id === approval.draft_id);
    const message = parseMessage(messageContent);
    if (!draft || !message) return null;
    // A real send goes only while its draft is still approved under this approval: one set aside
    // (its contact no longer ready) or approved again is not sent on the old approval (27 Nov).
    if (approval.purpose === 'send' && (draft.status !== 'approved' || draft.approval_id !== approval.id)) return null;
    // A follow-up goes only while its email stays approved and the follow-up is still the one approved with it.
    if (approval.purpose === 'followup' && (draft.status !== 'approved' || draft.followup_approval_id !== approval.id)) return null;
    const { data: sender } = await this.db.from('outreach_senders').select('*').eq('id', approval.snapshot.sender_id).eq('user_id', approval.user_id).maybeSingle();
    if (!sender) return null;
    let signature: OutreachSignature | null = null;
    let logo: Pick<OutreachLogo, 'url' | 'width' | 'height'> | null = null;
    if (approval.snapshot.signature_id) {
      const { data } = await this.db.from('outreach_signatures').select('*').eq('id', approval.snapshot.signature_id).eq('user_id', approval.user_id).maybeSingle();
      signature = (data as OutreachSignature | null) ?? null;
      if (signature?.logo_id) {
        const { data: l } = await this.db.from('outreach_logos').select('path, width, height').eq('id', signature.logo_id).maybeSingle();
        if (l) {
          const row = l as { path: string; width: number; height: number };
          logo = { url: this.db.storage.from('email-logos').getPublicUrl(row.path).data.publicUrl, width: row.width, height: row.height };
        }
      }
    }
    return buildSnapshot({ draft, message, sender: sender as OutreachSender, signature, logo, purpose: approval.purpose });
  }

  async blockers(send: SendRow, text?: string): Promise<Blockers> {
    const [{ data: settings }, { data: suppressed }, { count }, { data: facts }] = await Promise.all([
      this.db.from('outreach_settings').select('paused, daily_cap').eq('user_id', send.user_id).maybeSingle(),
      this.db.from('outreach_suppressions').select('address, domain').eq('user_id', send.user_id).is('lifted_at', null),
      this.db.from('outreach_sends').select('id', { count: 'exact', head: true }).eq('user_id', send.user_id).in('status', ['submitted', 'confirmed']).neq('purpose', 'test').gte('submitted_at', new Date(Date.now() - DAY_MS).toISOString()),
      // The project's facts, current and replaced: a test goes to the sender, and is held for nothing here.
      send.purpose === 'test' || !text ? Promise.resolve({ data: [] }) : this.db.from('project_facts').select('*').eq('project_id', send.project_id),
    ]);
    const s = (settings as { paused?: boolean; daily_cap?: number } | null) ?? {};
    const to = send.to_address.toLowerCase();
    const domain = to.split('@')[1] ?? '';
    const hit = ((suppressed ?? []) as { address: string | null; domain: string | null }[]).find((r) => (r.address && r.address === to) || (r.domain && r.domain === domain));
    const cap = s.daily_cap ?? 50;
    let capUntil: number | null = null;
    if (send.purpose !== 'test' && (count ?? 0) >= cap) {
      const { data: oldest } = await this.db.from('outreach_sends').select('submitted_at').eq('user_id', send.user_id).in('status', ['submitted', 'confirmed']).neq('purpose', 'test').gte('submitted_at', new Date(Date.now() - DAY_MS).toISOString()).order('submitted_at').limit(1).maybeSingle();
      const at = Date.parse((oldest as { submitted_at?: string } | null)?.submitted_at ?? '');
      capUntil = (Number.isFinite(at) ? at : Date.now()) + DAY_MS;
    }
    const replaced = text ? replacedIn(text, (facts ?? []) as ProjectFact[]) : null;
    return { paused: Boolean(s.paused) && send.purpose !== 'test', capUntil, suppressed: hit ? hit.address ?? hit.domain : null, replaced };
  }

  async record(jobId: string, worker: string, sendId: string, patch: SendPatch, event: string, detail: Record<string, unknown> = {}): Promise<boolean> {
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    const { data, error } = await this.db.rpc('record_outreach_send', { p_job: jobId, p_worker: worker, p_send: sendId, p_patch: clean, p_event: event, p_detail: detail });
    if (error) throw error;
    return Boolean(data);
  }
}
