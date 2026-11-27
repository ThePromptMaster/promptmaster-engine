/**
 * An Outreach stage as a later stage, the side chat or Go reads it (26 Nov): the contacts as one
 * line each, the message as written, the drafts by recipient. Never the raw data, which carries
 * the imported rows and ids. Pure.
 */
import { parseContacts, parseJson, type ContactRow, type EarlierContact } from './contacts';
import { parseDrafts, parseMessage } from './drafts';

const MAX_ROWS = 300;
const SOURCE: Record<string, string> = { promptmaster: 'sent from PromptMaster', mailbox: 'found in the Gmail Sent folder', manual: 'recorded by the user' };
export const CHECKED = 'Earlier contact: every contact is checked when it is added, against what PromptMaster sent, what the user recorded, the do-not-contact list and, while Gmail is connected, the Gmail Sent folder. "Contacted before" above is that check\'s finding; nothing more is needed from the user for it.';
const SIGNED = 'Sender and signature: from Settings. The signature, logo, postal address and opt-out line are added under every email when it goes out, so the message and the emails carry no sign-off.';

export function outreachText(part: 'contacts' | 'message' | 'drafts' | undefined, content: string): string {
  if (part === 'message') {
    const m = parseMessage(content);
    if (!m) return '';
    return [
      `Subject: ${m.subject}`,
      '',
      m.body,
      '',
      `Offer (every email): ${m.variables.offer || '(none set)'}`,
      `Link (every email): ${m.variables.link || '(none set)'}`,
      ...(m.followup ? ['', `Follow-up after ${m.followup.after_business_days} business days without a reply:`, m.followup.body] : []),
      '',
      // 27 Nov pass: Go asked what signature to put under each email. It is not the message's to say.
      m.sender_id
        ? SIGNED
        : 'Sender and signature: not chosen yet. The user sets them in Settings, under Outreach; nothing in the message names the sender.',
    ].join('\n');
  }
  if (part === 'contacts') {
    const rows = parseContacts(content).items;
    const word = (s: string | undefined) => (s === 'ready' ? 'ready' : s === 'decide' ? 'needs the user' : s === 'skip' ? 'skipped' : 'no address yet');
    const lines = rows.slice(0, MAX_ROWS).map((r, i) => {
      const who = [r.name, r.role].filter(Boolean).join(', ');
      const address = r.email ? `${r.email} (${r.email_kind || 'address'}${r.email_status && r.email_status !== 'given' ? `, ${r.email_status}` : ''})` : 'no address';
      const why = r.reason ? `: ${r.reason}` : '';
      const detail = r.detail ? ` | about their work: ${r.detail}${r.src_detail ? ` [${r.src_detail}]` : ''}` : '';
      const before = ` | ${earlierContact(r)}`;
      return `${i + 1}. ${r.company || r.domain || '(no company)'}${who ? ` — ${who}` : ''} | ${address}${detail}${before} [${word(r.status)}${why}]`;
    });
    const more = rows.length > MAX_ROWS ? [`(${rows.length - MAX_ROWS} more contacts not shown here.)`] : [];
    // 27 Nov pass: Go paused the objective for "your sent-mail history", which PromptMaster had read.
    return [...lines, ...more, '', CHECKED].join('\n');
  }
  if (part === 'drafts') {
    return parseDrafts(content)
      .slice(0, MAX_ROWS)
      .map((d, i) => `${i + 1}. To ${d.to || '(no address)'} — ${d.subject} [${d.status === 'approved' ? 'approved' : d.status === 'set_aside' ? `set aside${d.reason ? `: ${d.reason}` : ''}` : 'not decided'}]`)
      .concat(['', `${SIGNED} Approving and sending each email are the user's, on this stage.`])
      .join('\n');
  }
  return '';
}

/** What the earlier-contact check found for one contact, as a phrase. */
export function earlierContact(r: ContactRow): string {
  const earlier = parseJson<EarlierContact>(r.contacted);
  const colleague = parseJson<EarlierContact>(r.colleague);
  if (earlier) return `contacted before${earlier.on ? ` on ${earlier.on.slice(0, 10)}` : ''} (${SOURCE[earlier.source] ?? earlier.source})`;
  if (colleague) return `not contacted before; a colleague (${colleague.address}) was`;
  return 'not contacted before';
}
