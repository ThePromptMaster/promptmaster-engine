/**
 * The standard message and the email made from it for each contact (Sean, 26 Nov: "Save the
 * standard message and let me edit individual drafts. If I change the offer or link for a
 * batch, show me which drafts would change and preserve any edits I made by hand").
 *
 * Pure. The per-contact parts ({{first_name}}, {{company}}, {{personal_line}}) are filled when a
 * draft is made; the batch-wide parts ({{offer}}, {{link}}) stay as tokens in the draft and are
 * filled when it is shown or sent, so changing them on the message reaches every draft.
 */
import type { StageItem } from '@/lib/workflow/stage-artifact';
import { parseJson, type ContactRow } from './contacts';

export const CONTACT_TOKENS = ['first_name', 'company', 'personal_line'] as const;
export const BATCH_TOKENS = ['offer', 'link'] as const;

export interface OutreachMessage {
  kind: 'outreach_message';
  subject: string;
  body: string;
  /** Sent in the same thread a few business days later, if approved with the batch (a later release). */
  followup: { body: string; after_business_days: number } | null;
  variables: { offer: string; link: string };
  /** Who it goes out as: a sender and its signatures, from Settings. */
  sender_id: string | null;
  signature_id: string | null;
  reply_signature_id: string | null;
}

export function blankMessage(): OutreachMessage {
  return { kind: 'outreach_message', subject: '', body: '', followup: null, variables: { offer: '', link: '' }, sender_id: null, signature_id: null, reply_signature_id: null };
}

export function parseMessage(content: string | null | undefined): OutreachMessage | null {
  const doc = parseJson<Partial<OutreachMessage>>(content ?? undefined);
  if (!doc || doc.kind !== 'outreach_message') return null;
  return {
    ...blankMessage(),
    ...doc,
    variables: { offer: doc.variables?.offer ?? '', link: doc.variables?.link ?? '' },
    followup: doc.followup && typeof doc.followup.body === 'string' ? { body: doc.followup.body, after_business_days: doc.followup.after_business_days || 3 } : null,
  };
}

export function serializeMessage(m: OutreachMessage): string {
  return JSON.stringify(m, null, 2);
}

/** One email to one contact. A `StageItem`, so every value is a string. */
export interface DraftRow extends StageItem {
  id: string;
  /** approved: by the user, as this exact email (a later release); set_aside: not sent, with a reason. */
  status?: '' | 'approved' | 'set_aside';
  reason?: string;
  contact_id: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  /** The fields the user changed by hand, comma separated ("subject,body"): those are never rewritten. */
  edited: string;
  /** JSON `{ offer?, link? }`: this email's own values in place of the batch's. */
  overrides: string;
  /** The approval of this exact email (`outreach_approvals.id`), while it is approved. */
  approval_id?: string;
}

export function firstName(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? '';
  // "Dr. Jane Smith" → Jane; a lone initial reads oddly in a greeting.
  return /^(dr|mr|mrs|ms|prof)\.?$/i.test(first) ? (name.trim().split(/\s+/)[1] ?? '') : first;
}

/** Fill `{{token}}`s from `values`; a token with no value is left as it is, so it is held. */
export function fillTokens(text: string, values: Readonly<Record<string, string | undefined>>): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (whole, key: string) => {
    const v = values[key];
    return v !== undefined && v.trim() !== '' ? v : whole;
  });
}

function contactValues(c: Pick<ContactRow, 'name' | 'company' | 'personal_line'>): Record<string, string> {
  return { first_name: firstName(c.name), company: c.company.trim(), personal_line: c.personal_line.trim() };
}

/** A new draft for a contact, from the message. */
export function draftFor(contact: ContactRow, message: OutreachMessage, id: string): DraftRow {
  const values = contactValues(contact);
  return {
    id,
    status: '',
    reason: '',
    contact_id: contact.id,
    to: contact.email.trim(),
    cc: '',
    bcc: '',
    subject: fillTokens(message.subject, values),
    body: fillTokens(message.body, values),
    edited: '',
    overrides: '',
  };
}

export function editedFields(d: Pick<DraftRow, 'edited'>): Set<string> {
  return new Set((d.edited ?? '').split(',').map((s) => s.trim()).filter(Boolean));
}

/** The batch values this draft uses: its own where it has them, else the message's. */
export function draftVariables(d: Pick<DraftRow, 'overrides'>, message: OutreachMessage): { offer: string; link: string } {
  const own = parseJson<Partial<{ offer: string; link: string }>>(d.overrides) ?? {};
  return { offer: own.offer ?? message.variables.offer, link: own.link ?? message.variables.link };
}

/** The subject and body as they go out, every token this draft can fill filled. */
export function draftText(d: Pick<DraftRow, 'subject' | 'body' | 'overrides'>, message: OutreachMessage): { subject: string; body: string } {
  const values = draftVariables(d, message);
  return { subject: fillTokens(d.subject, values), body: fillTokens(d.body, values) };
}

/**
 * The drafts for the contacts as they are now (Sean, 26 Nov: "preserve any edits I made by hand").
 *
 * - A ready contact with no draft gets one.
 * - A draft nobody edited is made again from the message and its contact, so a change to the
 *   message or the contact reaches it. One edited by hand keeps its text; only what it was not
 *   edited in (the recipient, say) follows the contact.
 * - A contact no longer ready loses a draft nobody touched; one edited or decided stays, set
 *   aside with the reason, so nothing the user wrote disappears.
 */
export function syncDrafts(contacts: readonly ContactRow[], message: OutreachMessage, existing: readonly DraftRow[], makeId: () => string): DraftRow[] {
  const byContact = new Map(existing.map((d) => [d.contact_id, d]));
  const ready = new Set(contacts.filter((c) => c.status === 'ready' && c.email.trim()).map((c) => c.id));
  const out: DraftRow[] = [];
  for (const c of contacts) {
    const had = byContact.get(c.id);
    if (!ready.has(c.id)) {
      if (had && (had.edited || had.status)) {
        out.push(had.status === 'set_aside' ? had : { ...had, status: 'set_aside', reason: 'The contact is no longer ready to write to.' });
      }
      continue;
    }
    if (!had) {
      out.push(draftFor(c, message, makeId()));
      continue;
    }
    const fresh = draftFor(c, message, had.id);
    const edited = editedFields(had);
    out.push({
      ...had,
      to: edited.has('to') ? had.to : fresh.to,
      subject: edited.has('subject') ? had.subject : fresh.subject,
      body: edited.has('body') ? had.body : fresh.body,
    });
  }
  return out;
}

/** The drafts whose text a sync would change, for the user to see before it happens. */
export function changedBySync(before: readonly DraftRow[], after: readonly DraftRow[]): string[] {
  const was = new Map(before.map((d) => [d.id, d]));
  return after.filter((d) => {
    const b = was.get(d.id);
    return b && (b.subject !== d.subject || b.body !== d.body || b.to !== d.to || b.status !== d.status);
  }).map((d) => d.id);
}

export interface DraftsDocument {
  kind: 'stage_items';
  items: DraftRow[];
}

export function serializeDrafts(items: readonly DraftRow[]): string {
  return JSON.stringify({ kind: 'stage_items', items: [...items] } satisfies DraftsDocument, null, 2);
}

export function parseDrafts(content: string | null | undefined): DraftRow[] {
  const doc = parseJson<Partial<DraftsDocument>>(content ?? undefined);
  return Array.isArray(doc?.items) ? (doc!.items as DraftRow[]).filter((d) => d && typeof d.id === 'string') : [];
}
