/**
 * An Outreach stage as a later stage, the side chat or Go reads it (26 Nov): the contacts as one
 * line each, the message as written, the drafts by recipient. Never the raw data, which carries
 * the imported rows and ids. Pure.
 */
import { parseContacts } from './contacts';
import { parseDrafts, parseMessage } from './drafts';

const MAX_ROWS = 300;

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
      return `${i + 1}. ${r.company || r.domain || '(no company)'}${who ? ` — ${who}` : ''} | ${address}${detail} [${word(r.status)}${why}]`;
    });
    const more = rows.length > MAX_ROWS ? [`(${rows.length - MAX_ROWS} more contacts not shown here.)`] : [];
    return [...lines, ...more].join('\n');
  }
  if (part === 'drafts') {
    return parseDrafts(content)
      .slice(0, MAX_ROWS)
      .map((d, i) => `${i + 1}. To ${d.to || '(no address)'} — ${d.subject} [${d.status === 'approved' ? 'approved' : d.status === 'set_aside' ? `set aside${d.reason ? `: ${d.reason}` : ''}` : 'not decided'}]`)
      .join('\n');
  }
  return '';
}
