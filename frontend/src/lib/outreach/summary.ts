/**
 * What the outreach round needs from the user, on every one of its stages (Sean, 26 Nov: a summary
 * of what needs attention). Pure: counted from the stages and the sent record, so the list, the
 * message and the emails all say the same.
 */
import { parseContacts } from './contacts';
import { draftText, parseDrafts, parseMessage, blankMessage } from './drafts';
import { replacedIn } from './holds';
import { unresolvedPlaceholders } from './placeholders';
import { needsResearch } from './research';
import type { ProjectFact } from '@/types/project';

export interface OutreachCounts {
  /** Contacts waiting on a decision. */
  decide: number;
  /** Contacts still to fill in from the web. */
  search: number;
  /** Emails ready for the user to approve. */
  approve: number;
  /** Emails held back or sent back: something left to fill in, a replaced fact, or changed since approval. */
  held: number;
  scheduled: number;
  sent: number;
  failed: number;
}

export function outreachCounts(input: {
  contacts: string | null | undefined;
  message: string | null | undefined;
  drafts: string | null | undefined;
  sends: readonly { status: string; purpose: string }[];
  facts?: readonly ProjectFact[];
}): OutreachCounts {
  const rows = parseContacts(input.contacts).items;
  const message = parseMessage(input.message) ?? blankMessage();
  const drafts = parseDrafts(input.drafts);
  let approve = 0;
  let held = 0;
  for (const d of drafts) {
    if (d.status) continue;
    const text = draftText(d, message);
    const back = Boolean(d.reason?.trim());
    if (back || unresolvedPlaceholders(`${text.subject}\n${text.body}`).length || replacedIn(`${text.subject}\n${text.body}`, input.facts)) held += 1;
    else approve += 1;
  }
  const real = input.sends.filter((s) => s.purpose !== 'test');
  return {
    decide: rows.filter((r) => r.status === 'decide').length,
    search: rows.filter(needsResearch).length,
    approve,
    // A send held at send time shows on its email; once the Drafts stage sees it, it is back for review and counted above.
    held,
    scheduled: real.filter((s) => s.status === 'scheduled' || s.status === 'paused').length,
    sent: real.filter((s) => s.status === 'submitted' || s.status === 'confirmed').length,
    failed: real.filter((s) => s.status === 'failed').length,
  };
}
