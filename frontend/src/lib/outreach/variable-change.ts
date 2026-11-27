/**
 * A change to the message seen before it is saved (Sean, 26 Nov: "If I change the offer or link for
 * a batch, show me which drafts would change"). Pure: which emails follow the change, which of those
 * were approved and go back to the user, and which carry the old wording typed by hand and keep it
 * unless the user asks to replace it there too.
 */
import { draftText, editedFields, type DraftRow, type OutreachMessage } from './drafts';

export interface ChangePreview {
  /** Emails whose text changes. */
  follow: number;
  /** Of those, approved ones: they go back for review. */
  approved: number;
  /** Emails edited by hand that still carry the old offer or link as typed text. */
  kept: string[];
}

const changedValues = (before: OutreachMessage, after: OutreachMessage) =>
  (['offer', 'link'] as const).filter((k) => before.variables[k].trim() && before.variables[k] !== after.variables[k]);

export function previewChange(before: OutreachMessage, after: OutreachMessage, drafts: readonly DraftRow[]): ChangePreview {
  const values = changedValues(before, after);
  let follow = 0;
  let approved = 0;
  const kept: string[] = [];
  for (const d of drafts) {
    if (d.status === 'set_aside') continue;
    const a = draftText(d, before);
    const b = draftText(d, after);
    if (a.subject !== b.subject || a.body !== b.body) {
      follow += 1;
      if (d.status === 'approved') approved += 1;
    }
    const edited = editedFields(d);
    if ((edited.has('body') || edited.has('subject')) && values.some((k) => `${d.subject}\n${d.body}`.includes(before.variables[k]))) kept.push(d.id);
  }
  return { follow, approved, kept };
}

/** "Replace there too": the old offer and link typed into these emails become the new ones. */
export function replaceInDrafts(drafts: readonly DraftRow[], ids: readonly string[], before: OutreachMessage, after: OutreachMessage): DraftRow[] {
  const values = changedValues(before, after);
  const swap = (text: string) => values.reduce((t, k) => t.split(before.variables[k]).join(after.variables[k]), text);
  return drafts.map((d) => (ids.includes(d.id) ? { ...d, subject: swap(d.subject), body: swap(d.body) } : d));
}
