/**
 * What Go can do on an Outreach workflow (Sean, 26 Nov: PromptMaster researches and drafts; the
 * user approves and sends). Pure: Go's facts (`lib/agent/facts.ts`) and its performer
 * (`lib/agent/perform-outreach.ts`) read the stages through these, by the stage's `outreach.part`,
 * never by workflow key.
 *
 * Go never approves or sends: nothing here, and nothing Go imports, reaches the approval or
 * sending code (`lib/agent/outreach-no-send.test.ts` holds that).
 */
import type { StageDefinition, WorkflowTemplate } from '@/lib/workflow/types';
import { parseContacts } from './contacts';
import { CHECKED, earlierContact, outreachText } from './digest-text';
import { blankMessage, changedBySync, draftText, parseDrafts, parseMessage, syncDrafts, type OutreachMessage } from './drafts';
import { researchLeft } from './research-run';

type Bundles = Readonly<Record<string, { versions: readonly { content: string | null }[] } | undefined>>;
export type OutreachPart = 'contacts' | 'message' | 'drafts';

const latest = (bundles: Bundles, stageId: string | undefined) => (stageId ? bundles[stageId]?.versions.at(-1)?.content ?? null : null);

/** Each part's stage, and the brief: the stage before the first outreach stage (as the page reads it). */
export function outreachStages(template: WorkflowTemplate): { parts: Partial<Record<OutreachPart, StageDefinition>>; brief: StageDefinition | null } {
  const stages = template.stages.filter((s) => s.renderer === 'outreach' && s.outreach);
  const parts: Partial<Record<OutreachPart, StageDefinition>> = {};
  for (const s of stages) parts[s.outreach!.part] ??= s;
  const first = stages[0] ? template.stages.indexOf(stages[0]) : -1;
  return { parts, brief: first > 0 ? template.stages[first - 1] : null };
}

export function briefText(template: WorkflowTemplate, bundles: Bundles): string {
  const { brief } = outreachStages(template);
  return brief ? latest(bundles, brief.id) ?? '' : '';
}

export interface OutreachFacts {
  part: OutreachPart;
  /** Contacts: no rows yet; only the user can bring the list. */
  empty?: boolean;
  /** Contacts: rows a search would fill in. */
  researchLeft?: number;
  webOn?: boolean;
  /** Contacts: the page is filling in the blanks now. */
  running?: boolean;
  /** Message: no standard message written yet. */
  messageEmpty?: boolean;
  /** Drafts: emails to add, change or take away to match the contacts and the message. */
  draftsBehind?: number;
}

export function outreachFacts(input: { template: WorkflowTemplate; stage: StageDefinition; bundles: Bundles; webOn: boolean; running: boolean }): OutreachFacts | undefined {
  const part = input.stage.renderer === 'outreach' ? input.stage.outreach?.part : undefined;
  if (!part) return undefined;
  const { parts } = outreachStages(input.template);
  const own = latest(input.bundles, input.stage.id);
  if (part === 'contacts') {
    return { part, empty: parseContacts(own).items.length === 0, researchLeft: researchLeft(own), webOn: input.webOn, running: input.running };
  }
  const message = parseMessage(latest(input.bundles, parts.message?.id));
  if (part === 'message') return { part, messageEmpty: !message || (!message.subject.trim() && !message.body.trim()) };
  return { part, draftsBehind: draftsBehind(latest(input.bundles, parts.contacts?.id), message, own) };
}

let n = 0;
const countingId = () => `count_${n++}`;

/** How many emails would be added, changed or removed to match the contacts and the message. 0 with no message. */
export function draftsBehind(contactsContent: string | null, message: OutreachMessage | null, draftsContent: string | null): number {
  if (!message || (!message.subject.trim() && !message.body.trim())) return 0;
  const drafts = parseDrafts(draftsContent);
  const synced = syncDrafts(parseContacts(contactsContent).items, message, drafts, countingId);
  const added = synced.filter((d) => !drafts.some((x) => x.id === d.id)).length;
  const removed = drafts.filter((d) => !synced.some((x) => x.id === d.id)).length;
  return added + removed + changedBySync(drafts, synced).length;
}

/** A written standard message, from `POST /api/outreach/draft-message`, onto what was there. */
export interface WrittenMessage {
  subject: string;
  body: string;
  followup_body: string;
  offer: string;
  link: string;
}

export function withWrittenMessage(previous: OutreachMessage | null, res: WrittenMessage, ids: { sender_id: string | null; signature_id: string | null; reply_signature_id: string | null }): OutreachMessage {
  const m = previous ?? blankMessage();
  return {
    ...m,
    subject: res.subject,
    body: res.body,
    variables: { offer: res.offer || m.variables.offer, link: res.link || m.variables.link },
    followup: res.followup_body ? { body: res.followup_body, after_business_days: m.followup?.after_business_days ?? 3 } : m.followup,
    sender_id: m.sender_id ?? ids.sender_id,
    signature_id: m.signature_id ?? ids.signature_id,
    reply_signature_id: m.reply_signature_id ?? ids.reply_signature_id,
  };
}

/**
 * The stage as Go's planner reads it (27 Nov pass: it was sent the raw JSON, read the emails'
 * {{offer}} and {{link}} as unfilled, and asked for a signature Settings adds). The contacts and
 * the message as the digest reads them; the emails as they would go out, the batch values filled.
 */
export function outreachExcerpt(template: WorkflowTemplate, stage: StageDefinition, bundles: Bundles): string {
  const part = stage.outreach?.part;
  const own = latest(bundles, stage.id) ?? '';
  if (part !== 'drafts') return outreachText(part, own);
  const { parts } = outreachStages(template);
  const message = parseMessage(latest(bundles, parts.message?.id)) ?? blankMessage();
  const contacts = new Map(parseContacts(latest(bundles, parts.contacts?.id)).items.map((r) => [r.id, r]));
  const emails = parseDrafts(own).map((d, i) => {
    const text = draftText(d, message);
    const state = d.status === 'approved' ? 'approved by the user' : d.status === 'set_aside' ? `set aside${d.reason ? `: ${d.reason}` : ''}` : 'waiting for the user';
    // 27 Nov pass: the objective check read these emails and asked for "your sent-mail history".
    const row = contacts.get(d.contact_id);
    const before = row ? `\nEarlier contact: ${earlierContact(row)}${row.contacted && row.status === 'ready' ? '; the user chose to write again' : ''}.` : '';
    return `${i + 1}. To ${d.to || '(no address)'} [${state}]${before}\nSubject: ${text.subject}\n${text.body}`;
  });
  return [...emails, outreachText('drafts', '{"items":[]}').trim(), CHECKED].join('\n\n');
}
