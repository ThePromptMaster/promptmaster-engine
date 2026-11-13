import type { ThirdPartyItem } from '@/types';

/**
 * Connected accounts (the client's call, 7 Nov): Gmail, Google Calendar, Google
 * Drive, Outlook and OneDrive, through Composio (`backend/routers/connections.py`).
 * Since 13 Nov, Salesforce and HubSpot too: their contacts, companies and deals are
 * one more kind of item, `crm_record`, read only (L-241).
 *
 * Since 8 Nov a search covers the whole account and nothing is ticked (L-203): the
 * backend reads the best matches and the browser lists exactly what was read
 * (`toThirdParty`, `toSharedItems`). Pure, apart from sessionStorage.
 */

export type ToolkitSlug = 'gmail' | 'googlecalendar' | 'googledrive' | 'outlook' | 'one_drive' | 'salesforce' | 'hubspot';
export type ItemKind = ThirdPartyItem['kind'];

/** Every kind of item an account gives, and the icon that stands for it where its account's logo cannot. */
export const KIND_ICON: Record<ItemKind, string> = { email: 'mail', calendar_event: 'event', file: 'description', crm_record: 'contact_page' };
export const KINDS = Object.keys(KIND_ICON) as ItemKind[];

export const TOOLKITS: readonly { slug: ToolkitSlug; label: string; icon: string }[] = [
  { slug: 'gmail', label: 'Gmail', icon: 'mail' },
  { slug: 'googlecalendar', label: 'Google Calendar', icon: 'calendar_month' },
  { slug: 'googledrive', label: 'Google Drive', icon: 'folder_open' },
  { slug: 'outlook', label: 'Outlook', icon: 'inbox' },
  { slug: 'one_drive', label: 'OneDrive', icon: 'cloud' },
  { slug: 'salesforce', label: 'Salesforce', icon: 'handshake' },
  { slug: 'hubspot', label: 'HubSpot', icon: 'hub' },
];

export function toolkitLabel(slug: string): string {
  return TOOLKITS.find((t) => t.slug === slug)?.label ?? slug;
}

/**
 * Each account's own logo, as Composio serves it for that toolkit (8 Nov: the real
 * marks, not glyphs). `icon` stays as the fallback when the logo can't be loaded.
 */
export const LOGO_BASE = 'https://logos.composio.dev/api/';

export function toolkitLogoUrl(slug: ToolkitSlug): string {
  return `${LOGO_BASE}${slug}`;
}

/**
 * The account an item came from, read off its source line, which the backend starts
 * with the account's name ("Gmail · …", "Outlook calendar · …"). Null when it doesn't.
 */
export function toolkitFromSource(source: string | undefined): ToolkitSlug | null {
  const line = (source ?? '').trim();
  const hit = TOOLKITS.find((t) => line === t.label || line.startsWith(`${t.label} `));
  return hit?.slug ?? null;
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

/** The text of an item the search opened, as the backend read and cleaned it. */
export interface ConnectedText {
  id: string;
  toolkit: ToolkitSlug;
  kind: ItemKind;
  source: string;
  title: string;
  text: string;
  /** When it was sent or happens, from the search that found it. */
  when?: string;
}

/** A PDF or Office file, for this browser to read (`lib/data/extract-text.ts`). */
export interface ConnectedFile {
  id: string;
  toolkit: ToolkitSlug;
  source: string;
  title: string;
  mime: string;
  data_base64: string;
  when?: string;
}

export interface Skipped {
  id: string;
  title: string;
  reason: string;
}

/** A stable key: ids are only unique within one account. */
export function itemKey(item: { toolkit: string; id: string }): string {
  return `${item.toolkit}:${item.id}`;
}

/** A meeting to prepare for: only what reading it needs. */
export function toPicked(item: PreviewItem): { id: string; toolkit: ToolkitSlug; kind: ItemKind; title: string; ref: Record<string, string> } {
  return { id: item.id, toolkit: item.toolkit, kind: item.kind, title: item.title, ref: item.ref };
}

/** For a project: exactly what was shown, nothing else on the item. */
export function toThirdParty(items: readonly ConnectedText[]): ThirdPartyItem[] {
  return items.map(({ kind, source, title, text, when }) => ({ kind, source, title, text, ...(when ? { when } : {}) }));
}

/** How many a project holds at once: the backend's `MAX_THIRD_PARTY`. */
export const MAX_HELD = 20;

function sameItem(a: ThirdPartyItem, b: ThirdPartyItem): boolean {
  return a.kind === b.kind && a.source === b.source && a.title === b.title && a.text === b.text;
}

/**
 * What a project holds once `added` joins `held`: in order, an item already held
 * once only, and never more than `MAX_HELD`. `left` is what did not fit.
 */
export function mergeThirdParty(
  held: readonly ThirdPartyItem[],
  added: readonly ThirdPartyItem[]
): { items: ThirdPartyItem[]; left: ThirdPartyItem[] } {
  const items = [...held];
  const left: ThirdPartyItem[] = [];
  for (const item of added) {
    if (items.some((h) => sameItem(h, item))) continue;
    if (items.length >= MAX_HELD) left.push(item);
    else items.push(item);
  }
  return { items, left };
}

/** What a search found that the project doesn't hold yet. */
export function notHeld(held: readonly ThirdPartyItem[], found: readonly ConnectedText[]): ConnectedText[] {
  return found.filter((item) => !held.some((h) => sameItem(h, item)));
}

/**
 * Items "Start this" carries to the start screen (7 Nov). In this tab's storage, as the
 * goal is (`rememberStartGoal`): they are someone's mail, and a URL ends up in logs.
 */
const START_ITEMS_KEY = 'pm.start.items';

function isItem(x: unknown): x is ThirdPartyItem {
  const o = x as Record<string, unknown> | null;
  return (
    !!o &&
    (KINDS as readonly unknown[]).includes(o.kind) &&
    typeof o.title === 'string' &&
    typeof o.text === 'string' &&
    typeof o.source === 'string' &&
    (o.when === undefined || typeof o.when === 'string')
  );
}

export function rememberStartItems(items: readonly ThirdPartyItem[]): void {
  try {
    if (items.length) sessionStorage.setItem(START_ITEMS_KEY, JSON.stringify(items.slice(0, MAX_HELD)));
    else sessionStorage.removeItem(START_ITEMS_KEY);
  } catch {
    // Storage blocked or full: the start goes ahead without them.
  }
}

export function takeStartItems(): ThirdPartyItem[] {
  try {
    const raw = sessionStorage.getItem(START_ITEMS_KEY);
    sessionStorage.removeItem(START_ITEMS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isItem).slice(0, MAX_HELD) : [];
  } catch {
    return [];
  }
}

/** For the start conversation: titles only, never the text (`brought_titles` on the server). */
export function titlesOnly(items: readonly ThirdPartyItem[]): ThirdPartyItem[] {
  return items.map(({ kind, title, when }) => ({ kind, source: '', title, text: '', ...(when ? { when } : {}) }));
}

/** For `suggestWorkflows`: the same, in its item shape. */
export function toSharedItems(items: readonly ConnectedText[]): { kind: ItemKind; source: string; title: string; text: string }[] {
  return items.map(({ kind, source, title, text }) => ({ kind, source, title, text }));
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
