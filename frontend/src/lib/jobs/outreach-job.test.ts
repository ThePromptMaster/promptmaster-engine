import { describe, expect, it } from 'vitest';

import { OutreachCallError, runOutreachJob, type ApprovalRow, type Blockers, type OutreachClient, type OutreachStore, type SendPatch, type SendRow } from './outreach-job';
import type { Snapshot } from '@/lib/outreach/snapshot';
import type { Job, JobStore } from './types';

const snap: Snapshot = {
  v: 1, provider: 'gmail', from: { name: 'Sean', address: 'sean@pm.example' }, reply_to: '', to: ['morgan@harbourline.example'], cc: [], bcc: [],
  subject: 'A quick look', html: '<p>Hi</p>', text: 'Hi', links: [], commercial: false, footer: '', signature_id: 's1', sender_id: 'snd1',
};

function setup(opts: { current?: Snapshot | null; blockers?: Partial<Blockers>; status?: SendRow['status']; revoked?: boolean } = {}) {
  const job: Job = { id: 'j1', user_id: 'u1', project_id: 'p1', kind: 'send_email', status: 'leased', payload: { send_id: 'send1' }, checkpoint: {}, attempts: 1, max_attempts: 6, lease_owner: 'w', cancel_requested: false };
  const calls: string[] = [];
  const records: { patch: SendPatch; event: string }[] = [];
  const store = {
    checkpointJob: async (_id: string, _w: string, cp: Record<string, unknown>) => {
      job.checkpoint = cp;
      return true;
    },
    completeJob: async () => (calls.push('complete'), true),
    failJob: async (_id: string, _w: string, code: string, _m: string, _d: unknown, retryable: boolean) => (calls.push(`fail:${code}:${retryable}`), true),
    releaseJob: async (_id: string, _w: string, s: number) => (calls.push(`release:${s}`), true),
  } as unknown as JobStore;
  const send: SendRow = { id: 'send1', user_id: 'u1', project_id: 'p1', approval_id: 'a1', job_id: 'j1', purpose: 'send', status: opts.status ?? 'scheduled', to_address: 'morgan@harbourline.example' };
  const approval: ApprovalRow = { id: 'a1', user_id: 'u1', project_id: 'p1', stage_id: 'drafts', message_stage_id: 'message', draft_id: 'd1', purpose: 'send', snapshot: snap, message_hash: 'h', ticket: 't', revoked_at: opts.revoked ? '2026-11-26' : null };
  const outreach: OutreachStore = {
    load: async () => ({ send, approval }),
    current: async () => (opts.current === undefined ? snap : opts.current),
    blockers: async () => ({ paused: false, capUntil: null, suppressed: null, ...opts.blockers }),
    record: async (_j, _w, _s, patch, event) => (records.push({ patch, event }), true),
  };
  // A mailbox: drafts that, once sent, are gone; and Sent.
  const mailbox = { drafts: new Set<string>(), sent: [] as string[], n: 0, failNextSend: null as null | 'uncertain_after_accept' | 'uncertain_before', sentVisible: true };
  const client: OutreachClient = {
    createDraft: async () => {
      const id = `dr${++mailbox.n}`;
      mailbox.drafts.add(id);
      return { draft_id: id };
    },
    sendDraft: async (_t, id) => {
      if (mailbox.failNextSend === 'uncertain_before') {
        mailbox.failNextSend = null;
        throw new OutreachCallError('timed out', 'uncertain', 502);
      }
      if (!mailbox.drafts.has(id)) throw new OutreachCallError('GMAIL_SEND_DRAFT failed: draft not found', 'not_sent', 502);
      mailbox.drafts.delete(id);
      mailbox.sent.push(id);
      if (mailbox.failNextSend === 'uncertain_after_accept') {
        mailbox.failNextSend = null;
        throw new OutreachCallError('timed out', 'uncertain', 502);
      }
      return { message_id: `m-${id}`, thread_id: `t-${id}`, thread_url: `https://mail.google.com/mail/#all/t-${id}` };
    },
    findSent: async () => (mailbox.sent.length && mailbox.sentVisible ? { found: true, message_id: `m-${mailbox.sent[0]}`, thread_id: `t-${mailbox.sent[0]}`, thread_url: 'u' } : { found: false }),
    confirm: async () => ({ sent: true, thread_id: 't', thread_url: 'https://mail.google.com/mail/#all/t', matches: true }),
  };
  const run = () => runOutreachJob({ job, store, worker: 'w', outreach, client, now: () => 1_000_000 });
  return { job, calls, records, mailbox, run };
}

// Sean, 26 Nov: "If a send times out, check the mailbox before retrying so the person doesn't get two copies."
describe('sending one approved email', () => {
  it('drafts, sends and confirms, recording each step', async () => {
    const s = setup();
    expect(await s.run()).toBe('sent');
    expect(s.records.map((r) => r.patch.status ?? r.event)).toEqual(['submitting', 'draft_made', 'submitted', 'confirmed']);
    expect(s.mailbox.sent).toHaveLength(1);
    expect(s.calls).toEqual(['complete']);
  });

  it('holds an email changed since it was approved, and says what changed', async () => {
    const s = setup({ current: { ...snap, to: ['someone.else@harbourline.example'] } });
    expect(await s.run()).toBe('held');
    expect(s.records[0].patch).toMatchObject({ status: 'held', status_reason: expect.stringContaining('the recipient') });
    expect(s.mailbox.sent).toHaveLength(0);
  });

  it('holds an email whose draft is gone, whose approval was withdrawn, or whose address is suppressed', async () => {
    expect(await setup({ current: null }).run()).toBe('held');
    expect(await setup({ revoked: true }).run()).toBe('held');
    const s = setup({ blockers: { suppressed: 'morgan@harbourline.example' } });
    expect(await s.run()).toBe('held');
    expect(s.records[0].patch.status_reason).toContain('do-not-contact');
  });

  it('waits while outreach is paused, and until the daily limit frees up', async () => {
    const paused = setup({ blockers: { paused: true } });
    expect(await paused.run()).toBe('released');
    expect(paused.calls).toEqual(['release:900']);
    const capped = setup({ blockers: { capUntil: 1_000_000 + 3_600_000 } });
    expect(await capped.run()).toBe('released');
    expect(capped.calls).toEqual(['release:3600']);
  });

  it('a timeout after Gmail took it: found in Sent, never sent twice', async () => {
    const s = setup();
    s.mailbox.failNextSend = 'uncertain_after_accept';
    expect(await s.run()).toBe('sent');
    expect(s.mailbox.sent).toHaveLength(1);
  });

  it('a timeout before Gmail took it: waits, then sends the same draft once', async () => {
    const s = setup();
    s.mailbox.failNextSend = 'uncertain_before';
    expect(await s.run()).toBe('released');
    expect(s.job.checkpoint).toMatchObject({ step: 'sending', searches: 1 });
    expect(await s.run()).toBe('sent');
    expect(s.mailbox.sent).toEqual(['dr1']);
  });

  it('a crash after the draft was sent: the re-run finds the draft gone and adopts what Sent shows', async () => {
    const s = setup();
    s.mailbox.failNextSend = 'uncertain_after_accept';
    s.mailbox.sentVisible = false; // Gmail's search has not caught up yet
    expect(await s.run()).toBe('released');
    s.mailbox.sentVisible = true;
    expect(await s.run()).toBe('sent');
    expect(s.mailbox.sent).toHaveLength(1);
  });

  it('never found after two searches: failed, and never sent again by itself', async () => {
    const s = setup();
    s.mailbox.failNextSend = 'uncertain_after_accept';
    s.mailbox.sentVisible = false;
    await s.run();
    expect(await s.run()).toBe('failed');
    expect(s.calls.at(-1)).toBe('fail:send_uncertain:false');
    expect(s.mailbox.sent).toHaveLength(1);
  });

  it('a send the user stopped since it was queued does nothing', async () => {
    const s = setup({ status: 'paused' });
    expect(await s.run()).toBe('done');
    expect(s.mailbox.sent).toHaveLength(0);
  });
});
