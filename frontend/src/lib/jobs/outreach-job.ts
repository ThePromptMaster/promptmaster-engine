/**
 * Sending one approved outreach email, as a job (Sean, 26 Nov: "Give me send now, schedule, and
 * pause … Show what's a draft, approved, scheduled, submitted to the mailbox, confirmed sent, bounced,
 * or failed … If a send times out, check the mailbox before retrying so the person doesn't get two
 * copies").
 *
 * The drain runs it, server side, whether or not a tab is open. Each step is checkpointed before
 * the next call, so a send killed halfway resumes where it was:
 *
 *   prepare     the approval stands, the email is the one approved (its hash, built again from
 *               what is saved now), the address is not on the do-not-contact list, sending is not
 *               paused, today's limit is not reached. Then checkpoint `submitting`.
 *   submitting  a Gmail draft is made (re-entered: Sent is searched first). Checkpoint `sending`.
 *   sending     the draft is sent. Sending a draft twice cannot send twice: a sent draft is gone.
 *               Unsure whether it went: Sent is searched, never sent blind.
 *   confirm     Gmail shows it in Sent: confirmed, with a link to the thread.
 */
import { changedSince, hashSnapshot, type Snapshot } from '@/lib/outreach/snapshot';
import type { Job, JobStore } from './types';

export const OUTREACH_KINDS: ReadonlySet<string> = new Set(['send_email', 'send_test', 'send_followup', 'outreach_watch']);

export type SendStatus = 'scheduled' | 'paused' | 'held' | 'submitting' | 'submitted' | 'confirmed' | 'bounced' | 'failed' | 'cancelled';

export interface SendRow {
  id: string;
  user_id: string;
  project_id: string;
  approval_id: string;
  job_id: string | null;
  purpose: 'send' | 'test' | 'followup';
  status: SendStatus;
  to_address: string;
  /** A follow-up's first email. */
  parent_send_id?: string | null;
  provider_thread_id?: string | null;
  submitted_at?: string | null;
  scheduled_for?: string | null;
}

/** What came back for one email (`POST /api/outreach/check-thread`). */
export interface InboundEvent {
  kind: 'reply' | 'auto_reply' | 'bounce' | 'opt_out';
  message_id: string;
  from: string;
  subject: string;
  text: string;
  at: string;
  company_domain: string;
}

export interface ApprovalRow {
  id: string;
  user_id: string;
  project_id: string;
  stage_id: string;
  message_stage_id: string;
  draft_id: string;
  purpose: 'send' | 'test' | 'followup';
  snapshot: Snapshot;
  message_hash: string;
  ticket: string;
  revoked_at: string | null;
}

export interface SendPatch {
  status?: SendStatus;
  status_reason?: string;
  provider_draft_id?: string;
  provider_message_id?: string;
  provider_thread_id?: string;
  thread_url?: string;
  sent_copy_matches?: boolean;
}

/** What stops a send for now, read when it is about to go. */
export interface Blockers {
  /** "Pause all my outreach" in Settings. */
  paused: boolean;
  /** Today's limit is reached: the epoch ms it frees up, else null. */
  capUntil: number | null;
  /** The address or domain on the do-not-contact list, else null. */
  suppressed: string | null;
  /** The email states a fact the project has since replaced ("It still says …"), else null (27 Nov). */
  replaced?: string | null;
}

export interface OutreachStore {
  load(sendId: string): Promise<{ send: SendRow; approval: ApprovalRow } | null>;
  /** The email as it would go now, from what is saved now; null when its draft is gone. */
  current(approval: ApprovalRow): Promise<Snapshot | null>;
  /** `text` is the email as it would go now, read for facts the project has replaced. */
  blockers(send: SendRow, text?: string): Promise<Blockers>;
  record(jobId: string, worker: string, sendId: string, patch: SendPatch, event: string, detail?: Record<string, unknown>): Promise<boolean>;
  /** A follow-up's first email, with its approval. */
  parentOf(send: SendRow): Promise<{ send: SendRow; approval: ApprovalRow } | null>;
  /** What came back, and what it does (`record_outreach_inbound`): the number new. */
  recordInbound(jobId: string, worker: string, sendId: string, events: readonly InboundEvent[]): Promise<number>;
  /** A first email confirmed: its approved follow-up is queued, and a watch for replies. */
  afterConfirmed(jobId: string, worker: string, send: SendRow, confirmedAt: number): Promise<void>;
  /** The project's emails sent in the last fourteen days, with their approvals, to read what came back. */
  watchList(projectId: string): Promise<{ send: SendRow; approval: ApprovalRow }[]>;
  enqueueWatch(userId: string, projectId: string, at: number): Promise<void>;
}

export interface Ticketed {
  userId: string;
  approval: Pick<ApprovalRow, 'id' | 'purpose' | 'snapshot' | 'ticket'>;
}

export interface Ids {
  message_id: string;
  thread_id: string;
  thread_url: string;
}

/** The backend refused or failed: `code` says how sure it is that nothing went. */
export class OutreachCallError extends Error {
  constructor(
    message: string,
    readonly code: 'uncertain' | 'not_sent' | 'mailbox_changed' | 'not_approved' | 'off' | 'other',
    readonly status: number
  ) {
    super(message);
  }
}

export interface OutreachClient {
  /** A follow-up, sent in the first email's thread. */
  reply(t: Ticketed, threadId: string): Promise<Ids>;
  checkThread(t: Ticketed, threadId: string, sinceEpochSeconds: number): Promise<InboundEvent[]>;
  createDraft(t: Ticketed): Promise<{ draft_id: string }>;
  sendDraft(t: Ticketed, draftId: string): Promise<Ids>;
  findSent(t: Ticketed, afterEpochSeconds: number): Promise<{ found: boolean } & Partial<Ids>>;
  confirm(t: Ticketed, messageId: string): Promise<{ sent: boolean; thread_id: string; thread_url: string; matches: boolean }>;
}

interface Checkpoint {
  step?: 'submitting' | 'sending' | 'confirm';
  /** When the send began (epoch ms): Sent is searched from here. */
  at?: number;
  draft_id?: string;
  message_id?: string;
  /** Searches of Sent that found nothing, after an unsure send. */
  searches?: number;
  confirms?: number;
}

export type OutreachOutcome = 'sent' | 'held' | 'released' | 'failed' | 'done';

/** Unsure whether it went: this many empty searches, at least this far apart, and it is failed, never re-sent. */
const MAX_EMPTY_SEARCHES = 2;
const SEARCH_RETRY_SECONDS = 150;
const CONFIRM_RETRY_SECONDS = 60;
const MAX_CONFIRMS = 5;
const PAUSED_RETRY_SECONDS = 900;
const OFF_RETRY_SECONDS = 900;

const WATCH_SOON_SECONDS = 30 * 60;
const WATCH_LATER_SECONDS = 6 * 60 * 60;
const WATCH_DAYS = 14;
const DAY_MS = 86_400_000;
const sentAt = (s: SendRow) => Date.parse(s.submitted_at ?? s.scheduled_for ?? '') || 0;

/**
 * Reading what came back for the project's recent emails (27 Nov): every half hour for a day after
 * the latest one, then every six hours, for fourteen days. Each email is read with its own ticket.
 */
async function runWatch(args: { job: Job; store: JobStore; worker: string; outreach: OutreachStore; client: OutreachClient; now: () => number }): Promise<OutreachOutcome> {
  const { job, store, worker, outreach, client, now } = args;
  const list = await outreach.watchList(job.project_id);
  let found = 0;
  for (const { send, approval } of list) {
    try {
      const events = await client.checkThread({ userId: send.user_id, approval }, send.provider_thread_id ?? '', Math.floor(sentAt(send) / 1000));
      if (events.length) found += await outreach.recordInbound(job.id, worker, send.id, events);
    } catch {
      // One email that could not be read does not stop the others; the next watch tries again.
    }
  }
  const latest = Math.max(0, ...list.map(({ send }) => sentAt(send)));
  if (latest && now() - latest < WATCH_DAYS * DAY_MS) {
    const wait = now() - latest < DAY_MS ? WATCH_SOON_SECONDS : WATCH_LATER_SECONDS;
    await outreach.enqueueWatch(job.user_id, job.project_id, now() + wait * 1000);
  }
  await store.completeJob(job.id, worker, { checked: list.length, found });
  return 'done';
}

export async function runOutreachJob(args: { job: Job; store: JobStore; worker: string; outreach: OutreachStore; client: OutreachClient; now?: () => number }): Promise<OutreachOutcome> {
  const { job, store, worker, outreach, client } = args;
  const now = args.now ?? (() => Date.now());
  if (job.kind === 'outreach_watch') return runWatch({ ...args, now });
  const sendId = String((job.payload as { send_id?: unknown }).send_id ?? '');
  const loaded = sendId ? await outreach.load(sendId) : null;
  if (!loaded) {
    await store.failJob(job.id, worker, 'invalid_request', 'The send this job is for was not found.', {}, false);
    return 'failed';
  }
  const { send, approval } = loaded;
  let cp: Checkpoint = { ...(job.checkpoint as Checkpoint) };
  const t: Ticketed = { userId: send.user_id, approval };
  const record = (patch: SendPatch, event: string, detail: Record<string, unknown> = {}) => outreach.record(job.id, worker, send.id, patch, event, detail);
  const save = (next: Checkpoint) => {
    cp = next;
    return store.checkpointJob(job.id, worker, next as never);
  };
  const hold = async (reason: string) => {
    await record({ status: 'held', status_reason: reason }, 'held', { reason });
    await store.completeJob(job.id, worker, { held: reason });
    return 'held' as const;
  };
  const adopt = async (ids: Partial<Ids>) => {
    await record({ status: 'submitted', provider_message_id: ids.message_id ?? '', provider_thread_id: ids.thread_id ?? '', thread_url: ids.thread_url ?? '' }, 'submitted');
    await save({ ...cp, step: 'confirm', message_id: ids.message_id, confirms: 0 });
  };

  // Already settled, or stopped by the user since it was queued: nothing to do.
  if (!['scheduled', 'submitting', 'submitted'].includes(send.status)) {
    await store.completeJob(job.id, worker, { skipped: send.status });
    return 'done';
  }

  // A follow-up goes in its first email's thread, and only while nobody has answered it.
  const followup = approval.purpose === 'followup';
  let threadId = '';
  try {
    if (followup) {
      const parent = await outreach.parentOf(send);
      if (!parent || !['submitted', 'confirmed'].includes(parent.send.status) || !parent.send.provider_thread_id) {
        return await hold('Its first email was not sent, so the follow-up is not.');
      }
      threadId = parent.send.provider_thread_id;
      if (!cp.step) {
        const events = await client.checkThread({ userId: parent.send.user_id, approval: parent.approval }, threadId, Math.floor(sentAt(parent.send) / 1000));
        if (events.length) await outreach.recordInbound(job.id, worker, parent.send.id, events);
        const stop = events.find((e) => e.kind !== 'auto_reply');
        if (stop) {
          // `record_outreach_inbound` has cancelled this follow-up, saying why.
          await store.completeJob(job.id, worker, { stopped: stop.kind });
          return 'done';
        }
      }
    }
    if (!cp.step) {
      if (approval.revoked_at) return await hold('The approval was withdrawn.');
      const current = await outreach.current(approval);
      if (!current) return await hold('The email is no longer an approved draft: it was set aside, removed or approved again.');
      if ((await hashSnapshot(current)) !== (await hashSnapshot(approval.snapshot))) {
        const what = changedSince(approval.snapshot, current);
        return await hold(`Changed after it was approved${what.length ? `: ${what.join(', ')}` : ''}. Approve it again to send it.`);
      }
      const blockers = await outreach.blockers(send, `${current.subject}\n${current.text}`);
      if (blockers.suppressed) return await hold(`${blockers.suppressed} is on your do-not-contact list.`);
      if (blockers.replaced) return await hold(`${blockers.replaced} Approve it again once it is right.`);
      if (blockers.paused) {
        await record({ status_reason: 'Waiting: all outreach is paused in Settings. It goes within 15 minutes of turning that off.' }, 'waiting', { why: 'paused' });
        await store.releaseJob(job.id, worker, PAUSED_RETRY_SECONDS);
        return 'released';
      }
      if (blockers.capUntil !== null) {
        const wait = Math.max(60, Math.round((blockers.capUntil - now()) / 1000));
        await record({ status_reason: `Waiting: today's limit is reached; it goes at ${new Date(blockers.capUntil).toISOString()}.` }, 'waiting', { why: 'daily_cap' });
        await store.releaseJob(job.id, worker, wait);
        return 'released';
      }
      await save({ step: 'submitting', at: now() });
      await record({ status: 'submitting', status_reason: '' }, 'submitting');
    } else if (cp.step === 'submitting' && cp.at) {
      // Re-entered after a failure making the draft. A draft never sends by itself, but look first.
      const found = await client.findSent(t, Math.floor(cp.at / 1000));
      if (found.found) await adopt(found);
    }

    if (cp.step === 'submitting' && followup) {
      // A reply in the thread has no draft to send twice; unsure, Sent is searched like any send.
      try {
        await adopt(await client.reply(t, threadId));
      } catch (e) {
        if (!(e instanceof OutreachCallError) || e.code !== 'uncertain') throw e;
        const found = await client.findSent(t, Math.floor((cp.at ?? now()) / 1000));
        if (found.found) await adopt(found);
        else {
          await store.failJob(job.id, worker, 'send_uncertain', 'Not found in your Sent mail after the follow-up was interrupted. Not sent again automatically.', {}, false);
          return 'failed';
        }
      }
    }

    if (cp.step === 'submitting') {
      const { draft_id } = await client.createDraft(t);
      await save({ ...cp, step: 'sending', draft_id });
      await record({ provider_draft_id: draft_id }, 'draft_made');
    }

    if (cp.step === 'sending' && cp.draft_id) {
      try {
        const ids = await client.sendDraft(t, cp.draft_id);
        await adopt(ids);
      } catch (e) {
        if (!(e instanceof OutreachCallError) || (e.code !== 'uncertain' && e.code !== 'not_sent')) throw e;
        // Unsure, or the draft is gone (already sent?): look in Sent before anything else.
        const found = await client.findSent(t, Math.floor((cp.at ?? now()) / 1000));
        if (found.found) {
          await adopt(found);
        } else if (e.code === 'not_sent' && (cp.searches ?? 0) === 0 && !/not found/i.test(e.message)) {
          throw e;
        } else {
          const searches = (cp.searches ?? 0) + 1;
          if (searches >= MAX_EMPTY_SEARCHES) {
            await store.failJob(job.id, worker, 'send_uncertain', 'Not found in your Sent mail after the send was interrupted. Not sent again automatically.', {}, false);
            return 'failed';
          }
          await save({ ...cp, searches });
          await store.releaseJob(job.id, worker, SEARCH_RETRY_SECONDS);
          return 'released';
        }
      }
    }

    if (cp.step === 'confirm' && cp.message_id) {
      const c = await client.confirm(t, cp.message_id);
      if (c.sent) {
        await record({ status: 'confirmed', thread_url: c.thread_url || undefined, provider_thread_id: c.thread_id || undefined, sent_copy_matches: c.matches }, 'confirmed');
        // A first email out: its approved follow-up is queued, and replies are watched for.
        if (approval.purpose === 'send') await outreach.afterConfirmed(job.id, worker, { ...send, provider_thread_id: c.thread_id || send.provider_thread_id }, now()).catch(() => undefined);
        await store.completeJob(job.id, worker, { confirmed: true });
        return 'sent';
      }
      const confirms = (cp.confirms ?? 0) + 1;
      if (confirms >= MAX_CONFIRMS) {
        // Gmail took it; Sent has not shown it yet. It stays submitted, which is what it is.
        await store.completeJob(job.id, worker, { confirmed: false });
        return 'sent';
      }
      await save({ ...cp, confirms });
      await store.releaseJob(job.id, worker, CONFIRM_RETRY_SECONDS);
      return 'released';
    }

    await store.completeJob(job.id, worker, {});
    return 'done';
  } catch (e) {
    if (e instanceof OutreachCallError) {
      if (e.code === 'mailbox_changed') return await hold('The connected mailbox is not the one this email was approved from.');
      if (e.code === 'not_approved') return await hold('It no longer matches what was approved.');
      if (e.code === 'off') {
        await record({ status_reason: 'Waiting: sending is turned off on the server.' }, 'waiting', { why: 'off' });
        await store.releaseJob(job.id, worker, OFF_RETRY_SECONDS);
        return 'released';
      }
      // Certain it did not go: try again later, from where it was.
      await store.failJob(job.id, worker, e.code === 'not_sent' ? 'send_refused' : 'send_error', e.message, {}, true);
      return 'failed';
    }
    // A network failure or crash mid-call: unsure. The checkpoint stays, so the next try searches first.
    await store.failJob(job.id, worker, 'send_error', e instanceof Error ? e.message : 'The send failed.', {}, true);
    return 'failed';
  }
}
