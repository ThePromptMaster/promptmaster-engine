'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '@/lib/api/client';
import { drainOnce } from '@/lib/jobs/client-drain';
import type { DraftRow, OutreachMessage } from '@/lib/outreach/drafts';
import { backForReview, type Changed } from '@/lib/outreach/hold-changed';
import { buildSnapshot, type Snapshot, type SnapshotPurpose } from '@/lib/outreach/snapshot';
import { createApprovals, listApprovals, listInbound, listSends, moveSends, requestWatch, revokeApproval, scheduleSends, type ApprovalRecord, type InboundRecord, type SendRecord } from '@/lib/supabase/outreach-sends';
import type { OutreachLogo, OutreachSender, OutreachSignature } from '@/types/outreach';

/** Sends still moving: the record is read again every few seconds while any is. */
const MOVING = new Set(['scheduled', 'submitting', 'submitted']);
const POLL_MS = 5_000;

export interface SendingIdentity {
  sender: OutreachSender | null;
  signature: OutreachSignature | null;
  /** Under a follow-up (27 Nov); the first signature when none is set. */
  replySignature?: OutreachSignature | null;
  logo: OutreachLogo | null;
  spacingSeconds: number;
}

export interface ApproveResult {
  approved: number;
  problems: { draftId: string; problems: string[] }[];
}

/**
 * Approving and sending (Sean, 26 Nov: "Let me approve one email or a selected batch. Record the
 * exact version I approved … Give me send now, schedule, and pause … Give me a Send test to myself
 * button"). Each approval stores the exact email and its ticket; each send is a job the server runs
 * and records.
 */
export function useSending(input: {
  projectId: string;
  userId: string;
  draftsStageId: string;
  messageStageId: string;
  message: OutreachMessage;
  identity: SendingIdentity;
  saveDrafts: (items: DraftRow[], summary: string) => Promise<void>;
}) {
  const { projectId, userId, draftsStageId, messageStageId, message, identity, saveDrafts } = input;
  const [sends, setSends] = useState<SendRecord[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRecord[]>([]);
  const [inbound, setInbound] = useState<InboundRecord[]>([]);
  const live = useRef(true);

  const apply = useCallback(([s, a, i]: [SendRecord[], ApprovalRecord[], InboundRecord[]]) => {
    if (!live.current) return;
    setSends(s);
    setApprovals(a);
    setInbound(i);
  }, []);
  const load = useCallback(() => Promise.all([listSends(projectId), listApprovals(projectId), listInbound(projectId).catch(() => [] as InboundRecord[])]), [projectId]);

  // What came back is read by the job runner; opening the page asks for a read now (27 Nov).
  useEffect(() => {
    let on = true;
    requestWatch(projectId)
      .then((queued) => (queued ? drainOnce(projectId) : false))
      .then((ran) => (ran && on ? load().then(apply) : undefined))
      .catch(() => undefined);
    return () => {
      on = false;
    };
  }, [projectId, load, apply]);
  const refresh = useCallback(async () => apply(await load()), [apply, load]);

  useEffect(() => {
    live.current = true;
    load().then(apply).catch(() => undefined);
    return () => {
      live.current = false;
    };
  }, [load, apply]);

  const moving = sends.some((s) => MOVING.has(s.status));
  useEffect(() => {
    if (!moving) return;
    const timer = setInterval(() => {
      load().then(apply).catch(() => undefined);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [moving, load, apply]);

  const snapshotOf = useCallback(
    (d: DraftRow, purpose: SnapshotPurpose): Snapshot | null =>
      identity.sender
        ? buildSnapshot({ draft: d, message, sender: identity.sender, signature: purpose === 'followup' ? identity.replySignature ?? identity.signature : identity.signature, logo: identity.logo, purpose })
        : null,
    [identity.sender, identity.signature, identity.replySignature, identity.logo, message]
  );

  /** Approve these exact emails: each gets its ticket from the backend, then its approval row. */
  const ticketed = useCallback(
    async (rows: DraftRow[], purpose: SnapshotPurpose) => {
      const items = rows.flatMap((d) => {
        const snapshot = snapshotOf(d, purpose);
        return snapshot ? [{ id: crypto.randomUUID(), draft: d, snapshot }] : [];
      });
      if (!items.length) return { made: [] as typeof items, problems: rows.map((d) => ({ draftId: d.id, problems: ['Set up who it goes out as in Settings first.'] })) };
      const tickets = await api.outreachTickets(items.map((i) => ({ approval_id: i.id, purpose, snapshot: i.snapshot })));
      const byId = new Map(tickets.map((t) => [t.approval_id, t]));
      const made = items.filter((i) => byId.get(i.id)?.ticket);
      const batch = made.length > 1 ? crypto.randomUUID() : null;
      await createApprovals(
        userId,
        projectId,
        made.map((i) => ({
          id: i.id,
          stage_id: draftsStageId,
          message_stage_id: messageStageId,
          draft_id: i.draft.id,
          purpose,
          snapshot: i.snapshot,
          message_hash: byId.get(i.id)!.message_hash,
          ticket: byId.get(i.id)!.ticket,
          batch_id: batch,
        }))
      );
      const problems = items.filter((i) => !byId.get(i.id)?.ticket).map((i) => ({ draftId: i.draft.id, problems: byId.get(i.id)?.problems ?? ['It could not be approved.'] }));
      return { made, problems };
    },
    [snapshotOf, userId, projectId, draftsStageId, messageStageId]
  );

  const approve = useCallback(
    async (drafts: DraftRow[], ids: Set<string>, withFollowup = false): Promise<ApproveResult> => {
      const { made, problems } = await ticketed(drafts.filter((d) => ids.has(d.id)), 'send');
      // The follow-up is approved with its email, as its own exact email (27 Nov).
      const follows = withFollowup && message.followup?.body.trim()
        ? (await ticketed(made.map((m) => m.draft).filter((d) => d.followup?.trim()), 'followup')).made
        : [];
      if (made.length) {
        const byDraft = new Map(made.map((m) => [m.draft.id, m.id]));
        const followBy = new Map(follows.map((m) => [m.draft.id, m.id]));
        await saveDrafts(
          drafts.map((d) => (byDraft.has(d.id) ? { ...d, status: 'approved' as const, reason: '', approval_id: byDraft.get(d.id), followup_approval_id: followBy.get(d.id) ?? '' } : d)),
          `Approved ${made.length} email${made.length === 1 ? '' : 's'} as they are${follows.length ? `, with ${follows.length} follow-up${follows.length === 1 ? '' : 's'}` : ''}.`
        );
      }
      await refresh();
      return { approved: made.length, problems };
    },
    [ticketed, saveDrafts, refresh, message.followup]
  );

  const liveSendOf = useCallback((approvalId: string | undefined) => (approvalId ? sends.find((s) => s.approval_id === approvalId) ?? null : null), [sends]);

  /** Queue the approved emails with no send yet: now, or from a time, spaced as Settings says. */
  const send = useCallback(
    async (drafts: DraftRow[], when: Date | 'now') => {
      const ready = drafts.filter((d) => d.status === 'approved' && d.approval_id && !liveSendOf(d.approval_id)).map((d) => d.approval_id!);
      if (!ready.length) return 0;
      await scheduleSends(projectId, ready, when === 'now' ? new Date() : when, identity.spacingSeconds);
      await refresh();
      if (when === 'now') void drainOnce(projectId).then(() => refresh()).catch(() => undefined);
      return ready.length;
    },
    [liveSendOf, projectId, identity.spacingSeconds, refresh]
  );

  /** "Send test to myself": the same email, to the sender's own mailbox only. */
  const sendTest = useCallback(
    async (d: DraftRow): Promise<string[]> => {
      const { made, problems } = await ticketed([d], 'test');
      if (!made.length) return problems[0]?.problems ?? ['It could not be sent as a test.'];
      await scheduleSends(projectId, [made[0].id], new Date(), 0);
      await refresh();
      void drainOnce(projectId).then(() => refresh()).catch(() => undefined);
      return [];
    },
    [ticketed, projectId, refresh]
  );

  /** Take back an approval not yet sent: its send is cancelled and the email is open again. */
  const withdraw = useCallback(
    async (drafts: DraftRow[], d: DraftRow) => {
      if (!d.approval_id) return;
      const s = liveSendOf(d.approval_id);
      if (s && !['scheduled', 'paused', 'held', 'failed', 'cancelled'].includes(s.status)) throw new Error('It is already in your mailbox.');
      if (s && ['scheduled', 'paused', 'held'].includes(s.status)) await moveSends([s.id], 'cancelled', 'Approval withdrawn.', true);
      else await revokeApproval(d.approval_id, 'Approval withdrawn.');
      // Its follow-up goes with it.
      if (d.followup_approval_id) await revokeApproval(d.followup_approval_id, 'Approval withdrawn.').catch(() => undefined);
      await saveDrafts(drafts.map((x) => (x.id === d.id ? { ...x, status: '' as const, approval_id: '', followup_approval_id: '' } : x)), `Withdrew the approval of the email to ${d.to}.`);
      await refresh();
    },
    [liveSendOf, saveDrafts, refresh]
  );

  const move = useCallback(
    async (sendId: string, to: 'paused' | 'scheduled' | 'cancelled') => {
      await moveSends([sendId], to, to === 'paused' ? 'Paused by you.' : to === 'cancelled' ? 'Cancelled by you.' : '');
      await refresh();
      if (to === 'scheduled') void drainOnce(projectId).then(() => refresh()).catch(() => undefined);
    },
    [refresh, projectId]
  );

  /** Approved emails that changed go back for review: their sends held, their approvals withdrawn (`hold-changed.ts`). */
  const holdChanged = useCallback(
    async (drafts: DraftRow[], changed: readonly Changed[]) => {
      if (!changed.length) return;
      for (const c of changed) {
        if (c.sendId && c.movable) await moveSends([c.sendId], 'held', c.reason, true);
        else await revokeApproval(c.approvalId, c.reason);
      }
      await saveDrafts(backForReview(drafts, changed), `Sent ${changed.length} approved email${changed.length === 1 ? '' : 's'} back for review: changed after approval.`);
      await refresh();
    },
    [saveDrafts, refresh]
  );

  const approvalById = useMemo(() => new Map(approvals.map((a) => [a.id, a])), [approvals]);
  /** The latest test of each draft, with its send. */
  const testOf = useCallback(
    (draftId: string) => {
      const a = approvals.find((x) => x.draft_id === draftId && x.purpose === 'test');
      return a ? { approval: a, send: sends.find((s) => s.approval_id === a.id) ?? null } : null;
    },
    [approvals, sends]
  );

  /** A first email's follow-up send, and what came back for it. */
  const followupOf = useCallback((sendId: string | undefined) => (sendId ? sends.find((s) => s.parent_send_id === sendId) ?? null : null), [sends]);
  const inboundOf = useCallback((sendId: string | undefined) => (sendId ? inbound.filter((i) => i.send_id === sendId) : []), [inbound]);

  return { sends, approvals, inbound, approvalById, liveSendOf, followupOf, inboundOf, testOf, approve, send, sendTest, withdraw, move, holdChanged, refresh, canSend: Boolean(identity.sender) };
}
