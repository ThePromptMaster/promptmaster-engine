/**
 * One email exactly as it goes out (Sean, 26 Nov: "Record the exact version I approved. If someone
 * changes the recipient, body, link, attachment, or sender after approval, send that message back
 * for review").
 *
 * Pure and DOM-free: the browser builds it when the user approves, and the job that sends builds it
 * again from what is saved now; a different hash means something changed since the approval, and
 * the email is held. The backend checks and tickets the same shape
 * (`backend/promptmaster/outreach_message.py::Snapshot`).
 */
import type { OutreachLogo, OutreachSender, OutreachSignature } from '@/types/outreach';
import { draftText, followupText, type DraftRow, type OutreachMessage } from './drafts';
import { renderEmail } from './render';

export type SnapshotPurpose = 'send' | 'test' | 'followup';

export interface Snapshot {
  v: 1;
  provider: 'gmail' | 'outlook';
  from: { name: string; address: string };
  reply_to: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  html: string;
  text: string;
  links: string[];
  commercial: boolean;
  footer: string;
  signature_id: string;
  sender_id: string;
}

export function addresses(field: string): string[] {
  return field
    .split(/[,;\s]+/)
    .map((a) => a.trim())
    .filter((a) => a.includes('@'));
}

export interface SnapshotInput {
  draft: Pick<DraftRow, 'to' | 'cc' | 'bcc' | 'subject' | 'body' | 'overrides'> & Partial<Pick<DraftRow, 'followup'>>;
  message: OutreachMessage;
  sender: OutreachSender;
  signature: OutreachSignature | null;
  logo: Pick<OutreachLogo, 'url' | 'width' | 'height'> | null;
  purpose: SnapshotPurpose;
}

export function buildSnapshot({ draft, message, sender, signature, logo, purpose }: SnapshotInput): Snapshot {
  // A follow-up is its own email: the follow-up text, in the thread ("Re: …"), with the reply signature (27 Nov).
  const text = purpose === 'followup' ? followupText(draft, message) : draftText(draft, message);
  const email = renderEmail({
    sender,
    signature,
    logo: logo ? { url: logo.url, width: logo.width, height: logo.height } : null,
    subject: text.subject,
    body: text.body,
  });
  const footer = sender.commercial ? [sender.postal_address.trim(), sender.opt_out_line.trim()].filter(Boolean).join('\n') : '';
  // A test goes to the sender's own mailbox, and nowhere else.
  const test = purpose === 'test';
  return {
    v: 1,
    provider: sender.toolkit,
    // No name: Gmail sends under the Google account's own name, which PromptMaster cannot set or read
    // (Composio's draft tool takes no display name; seen on production, 27 Nov). The record holds what went.
    from: { name: '', address: sender.from_address.trim().toLowerCase() },
    reply_to: (sender.reply_to ?? '').trim().toLowerCase(),
    to: test ? [sender.from_address.trim().toLowerCase()] : addresses(draft.to),
    cc: test ? [] : addresses(draft.cc ?? ''),
    bcc: test ? [] : addresses(draft.bcc ?? ''),
    subject: email.subject,
    html: email.html,
    text: email.text,
    links: email.links,
    commercial: sender.commercial,
    footer,
    signature_id: signature?.id ?? '',
    sender_id: sender.id,
  };
}

/** Sorted keys at every level, no spaces: the same email always gives the same text. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export async function hashSnapshot(s: Snapshot): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(s));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const FIELD_WORDS: Partial<Record<keyof Snapshot, string>> = {
  to: 'the recipient',
  cc: 'Cc',
  bcc: 'Bcc',
  subject: 'the subject',
  text: 'the text',
  links: 'a link',
  from: 'the sender',
  reply_to: 'Reply-To',
  footer: 'the postal address or opt-out line',
  signature_id: 'the signature',
  html: 'how it looks (the signature or logo)',
};

/** The plain text's message, without the signature and footer (`render.ts` joins them with "\n\n--\n"). */
function messageOf(text: string): string {
  const at = text.indexOf('\n\n--\n');
  return at >= 0 ? text.slice(0, at) : text;
}

/** What differs between the approved email and the one that would go now, in words for the hold reason. */
export function changedSince(approved: Snapshot, now: Snapshot): string[] {
  const out: string[] = [];
  for (const key of Object.keys(FIELD_WORDS) as (keyof Snapshot)[]) {
    const differs = key === 'text' ? messageOf(approved.text) !== messageOf(now.text) : canonicalJson(approved[key]) !== canonicalJson(now[key]);
    if (differs) out.push(FIELD_WORDS[key]!);
  }
  // The signature or footer alone changed the text: say how it looks, not the text.
  if (!out.includes('the text') && approved.text !== now.text && !out.includes(FIELD_WORDS.html!)) out.push(FIELD_WORDS.html!);
  // A changed message also changes the HTML; say the text, not both.
  if (out.includes('the text') || out.includes('a link')) return out.filter((w) => w !== FIELD_WORDS.html);
  return out;
}
