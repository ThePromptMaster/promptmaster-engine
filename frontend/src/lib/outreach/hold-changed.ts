/**
 * An approved email that no longer matches what was approved goes back to the user (Sean, 26 Nov:
 * "If someone changes the recipient, body, link, attachment, or sender after approval, send that
 * message back for review"). The job runner holds such an email at send time whatever happens
 * (`lib/jobs/outreach-job.ts`); this says so the moment the change is made, from the page that made
 * it: the Message stage when the offer or link changes, the Drafts stage whenever it is open (a
 * signature edited in Settings, a contact's new address, a replaced fact).
 */
import type { DraftRow, OutreachMessage } from './drafts';
import { replacedIn } from './holds';
import { buildSnapshot, changedSince, hashSnapshot } from './snapshot';
import type { ApprovalRecord, SendRecord } from '@/lib/supabase/outreach-sends';
import type { OutreachLogo, OutreachSender, OutreachSignature } from '@/types/outreach';
import type { ProjectFact } from '@/types/project';

export interface Identity {
  sender: OutreachSender | null;
  signature: OutreachSignature | null;
  logo: OutreachLogo | null;
}

/** Who a message goes out as: its sender and signature, else the first of the user's (as the Drafts stage shows it). */
export function identityFor(message: OutreachMessage, senders: readonly OutreachSender[], signatures: readonly OutreachSignature[], logos: readonly OutreachLogo[]): Identity {
  const sender = senders.find((s) => s.id === message.sender_id) ?? senders[0] ?? null;
  const signature = signatures.find((s) => s.id === message.signature_id) ?? signatures.find((s) => s.sender_id === sender?.id && s.kind === 'first') ?? null;
  const logo = signature?.logo_id ? logos.find((l) => l.id === signature.logo_id) ?? null : null;
  return { sender, signature, logo };
}

export interface Changed {
  draftId: string;
  approvalId: string;
  sendId: string | null;
  /** The send can still be stopped by the user's own move (scheduled or paused). */
  movable: boolean;
  reason: string;
}

const OPEN = new Set(['scheduled', 'paused', 'held']);

/** Approved emails not yet sent whose email now differs from the approved one, or states a replaced fact. */
export async function findChanged(input: {
  drafts: readonly DraftRow[];
  message: OutreachMessage;
  identity: Identity;
  approvals: readonly ApprovalRecord[];
  sends: readonly SendRecord[];
  facts?: readonly ProjectFact[];
}): Promise<Changed[]> {
  const { sender, signature, logo } = input.identity;
  if (!sender) return [];
  const out: Changed[] = [];
  for (const d of input.drafts) {
    if (d.status !== 'approved' || !d.approval_id) continue;
    const approval = input.approvals.find((a) => a.id === d.approval_id);
    if (!approval || approval.revoked_at) continue;
    const send = input.sends.find((s) => s.approval_id === approval.id) ?? null;
    if (send && !OPEN.has(send.status)) continue;
    const now = buildSnapshot({ draft: d, message: input.message, sender, signature, logo, purpose: approval.purpose });
    const replaced = replacedIn(`${now.subject}\n${now.text}`, input.facts);
    const same = (await hashSnapshot(now)) === (await hashSnapshot(approval.snapshot));
    if (same && !replaced) continue;
    const what = changedSince(approval.snapshot, now);
    const reason = same ? replaced! : `Changed since you approved it: ${what.join(', ') || 'the email'}.`;
    out.push({ draftId: d.id, approvalId: approval.id, sendId: send?.id ?? null, movable: Boolean(send && (send.status === 'scheduled' || send.status === 'paused')), reason });
  }
  return out;
}

/** The drafts with the changed ones back for review: not approved, saying why. */
export function backForReview(drafts: readonly DraftRow[], changed: readonly Changed[]): DraftRow[] {
  const why = new Map(changed.map((c) => [c.draftId, c.reason]));
  return drafts.map((d) => (why.has(d.id) ? { ...d, status: '', approval_id: '', reason: why.get(d.id)! } : d));
}
