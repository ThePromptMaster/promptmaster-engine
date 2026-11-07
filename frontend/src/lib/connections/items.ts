import type { ThirdPartyItem } from '@/types';

/**
 * Connected accounts (the client's call, 7 Nov): Gmail, Google Calendar, Google
 * Drive, Outlook and OneDrive, through Composio (`backend/routers/connections.py`).
 *
 * Two reads, both on a press. A preview lists what is there without any contents;
 * the person ticks; the backend reads only what was ticked and the browser shows
 * that exact text before it goes anywhere. What is sent is what is shown
 * (`toThirdParty`, `toSharedItems`). Pure, apart from sessionStorage.
 */

export type ToolkitSlug = 'gmail' | 'googlecalendar' | 'googledrive' | 'outlook' | 'one_drive';
export type ItemKind = ThirdPartyItem['kind'];

export const TOOLKITS: readonly { slug: ToolkitSlug; label: string; icon: string }[] = [
  { slug: 'gmail', label: 'Gmail', icon: 'mail' },
  { slug: 'googlecalendar', label: 'Google Calendar', icon: 'calendar_month' },
  { slug: 'googledrive', label: 'Google Drive', icon: 'folder_open' },
  { slug: 'outlook', label: 'Outlook', icon: 'inbox' },
  { slug: 'one_drive', label: 'OneDrive', icon: 'cloud' },
];

export function toolkitLabel(slug: string): string {
  return TOOLKITS.find((t) => t.slug === slug)?.label ?? slug;
}

export interface Connection {
  id: string;
  toolkit: ToolkitSlug;
  label: string;
  status: 'ACTIVE' | 'EXPIRED' | string;
  connected_at: string;
}

/** One thing in an account, described without its contents. */
export interface PreviewItem {
  id: string;
  toolkit: ToolkitSlug;
  kind: ItemKind;
  title: string;
  when: string;
  who: string;
  people: string[];
  detail: string;
  ref: Record<string, string>;
  readable: boolean;
  note: string;
}

/** The text of a ticked item, as the backend read and cleaned it. */
export interface ConnectedText {
  id: string;
  toolkit: ToolkitSlug;
  kind: ItemKind;
  source: string;
  title: string;
  text: string;
}

/** A PDF or Office file, for this browser to read (`lib/data/extract-text.ts`). */
export interface ConnectedFile {
  id: string;
  toolkit: ToolkitSlug;
  source: string;
  title: string;
  mime: string;
  data_base64: string;
}

export interface Skipped {
  id: string;
  title: string;
  reason: string;
}

/** The backend reads twenty at a time, and suggestions take twenty. */
export const MAX_TICKED = 20;

/** A stable key: ids are only unique within one account. */
export function itemKey(item: { toolkit: string; id: string }): string {
  return `${item.toolkit}:${item.id}`;
}

/** What goes back to be read: only what the read needs. */
export function toPicked(item: PreviewItem): { id: string; toolkit: ToolkitSlug; kind: ItemKind; title: string; ref: Record<string, string> } {
  return { id: item.id, toolkit: item.toolkit, kind: item.kind, title: item.title, ref: item.ref };
}

/** For a briefing project: exactly what was shown, nothing else on the item. */
export function toThirdParty(items: readonly ConnectedText[]): ThirdPartyItem[] {
  return items.map(({ kind, source, title, text }) => ({ kind, source, title, text }));
}

/** For `suggestWorkflows`: the same, in its item shape. */
export function toSharedItems(items: readonly ConnectedText[]): { kind: ItemKind; source: string; title: string; text: string }[] {
  return items.map(({ kind, source, title, text }) => ({ kind, source, title, text }));
}

const STOP = new Set([
  'about', 'after', 'again', 'agenda', 'call', 'catch', 'from', 'have', 'invitation', 'meeting', 'please', 're', 'fwd',
  'review', 'sync', 'that', 'this', 'update', 'weekly', 'with', 'your', 'will', 'what', 'when', 'week', 'today',
]);

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 4 && !STOP.has(w))
  );
}

function addresses(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[^\s<>,;"']+@[^\s<>,;"']+/g) ?? []).map((a) => a.replace(/[.>]+$/, '')));
}

/**
 * The person's own addresses: the one they signed in with, and any address most of
 * their listed mail was sent to. A connected mailbox need not be the sign-in one, and
 * its owner is on every invite and every email, so it must never count as a link.
 */
function ownAddresses(emails: readonly PreviewItem[], signedInAs: string): Set<string> {
  const own = new Set(signedInAs ? [signedInAs.toLowerCase()] : []);
  const counts = new Map<string, number>();
  for (const e of emails) for (const a of addresses(e.people.join(' '))) counts.set(a, (counts.get(a) ?? 0) + 1);
  for (const [a, n] of counts) if (emails.length >= 2 && n * 2 >= emails.length) own.add(a);
  return own;
}

/**
 * The emails worth ticking for a meeting's briefing: from or to someone invited
 * (the person's own addresses aside), or sharing two words of the meeting's title.
 * A starting point the person can untick, never more than the limit allows.
 */
export function relatedTo(meeting: PreviewItem, items: readonly PreviewItem[], ownAddress = ''): PreviewItem[] {
  const emails = items.filter((item) => item.kind === 'email');
  const own = ownAddresses(emails, ownAddress);
  const invited = new Set([...addresses([meeting.who, ...meeting.people].join(' '))].filter((a) => !own.has(a)));
  const titleWords = words(meeting.title);
  return emails
    .filter((item) => {
      const theirs = addresses([item.who, ...item.people].join(' '));
      if ([...theirs].some((a) => invited.has(a))) return true;
      const shared = [...words(item.title)].filter((w) => titleWords.has(w));
      return shared.length >= 2 || (titleWords.size === 1 && shared.length === 1);
    })
    .slice(0, MAX_TICKED - 1);
}

/** Where Composio sends the person back: our own page, which the backend insists on. */
export const CONNECT_PATH = '/projects/connect';

const RETURN_KEY = 'pm.connect.return';

/** Remember the page to come back to after Google's or Microsoft's screen. Same-site paths only. */
export function rememberReturn(path: string): void {
  if (!path.startsWith('/') || path.startsWith('//')) return;
  try {
    sessionStorage.setItem(RETURN_KEY, path);
  } catch {
    // Private windows can refuse storage; the settings page is the fallback.
  }
}

export function takeReturn(fallback = '/projects/settings'): string {
  try {
    const path = sessionStorage.getItem(RETURN_KEY);
    sessionStorage.removeItem(RETURN_KEY);
    if (path && path.startsWith('/') && !path.startsWith('//')) return path;
  } catch {
    // Fall through.
  }
  return fallback;
}

/** "3 Nov, 14:00" in the person's language, or the raw value if it isn't a date. */
export function shortWhen(value: string, locale: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const allDay = /^\d{4}-\d{2}-\d{2}$/.test(value);
  return new Intl.DateTimeFormat(locale, allDay ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date);
}
