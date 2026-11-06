/**
 * The user's Google account, read in their browser (the client's call, 4 Nov).
 *
 * The token comes from Google Identity Services' token model: no refresh token and no
 * code exchange, so there is nothing for a server to hold. It lives in this module's
 * memory until it expires or the tab closes, and goes only to Google. FastAPI never
 * sees it and calls no provider, so "the backend owns no user data" still holds.
 *
 * Separate from signing in. A separate client in a separate Google Cloud project, so
 * asking for these scopes cannot change what signing in shows anyone.
 *
 * What this does not avoid: Gmail's scopes are restricted. Text a user ticks still
 * reaches a server, so going public needs Google's yearly security assessment, and
 * until then Gmail works only for the project's listed testers.
 */

import { extractText, isDocument } from '@/lib/data/extract-text';

import { MAX_ITEM_CHARS, cleanText, visibleText } from './clean-text';
import type { ConnectedItem } from './items';

const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly';
const MAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.metadata';
const FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const GOOGLE_SCOPES = [CALENDAR_SCOPE, MAIL_SCOPE, FILE_SCOPE];

const CALENDAR_DAYS = 14;
const MAIL_SENT = 30;
const MAIL_RECEIVED = 20;
const AT_ONCE = 8;

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
}

interface GoogleOAuth {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    callback: (response: TokenResponse) => void;
    error_callback?: (error: { type?: string }) => void;
  }): { requestAccessToken(options?: { prompt?: string }): void };
  revoke(token: string, done?: () => void): void;
}

interface PickerDoc {
  id: string;
  name: string;
  mimeType: string;
}

interface PickerGlobals {
  picker: {
    PickerBuilder: new () => {
      setAppId(id: string): unknown;
      setOAuthToken(token: string): unknown;
      setDeveloperKey(key: string): unknown;
      addView(view: unknown): unknown;
      enableFeature(feature: unknown): unknown;
      setCallback(callback: (data: { action: string; docs?: PickerDoc[] }) => void): unknown;
      build(): { setVisible(visible: boolean): void };
    };
    ViewId: { DOCS: unknown };
    Feature: { MULTISELECT_ENABLED: unknown };
    Action: { PICKED: string; CANCEL: string };
  };
}

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleOAuth } } & Partial<PickerGlobals>;
    gapi?: { load(name: string, done: () => void): void };
  }
}

export class GoogleRefused extends Error {}

let held: { token: string; expires: number; scopes: Set<string> } | null = null;

export function googleConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_GOOGLE_CONNECT_CLIENT_ID);
}

export function googleConnected(): boolean {
  return Boolean(held && held.expires > Date.now());
}

function loadScript(src: string): Promise<void> {
  if (document.querySelector(`script[src="${src}"]`)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Could not reach Google.'));
    document.head.appendChild(script);
  });
}

/**
 * Ask Google for access. Only ever from a press: a browser blocks a popup any other
 * way, and nobody should be asked unprompted. Google may let them refuse some scopes;
 * the reads below find that out for themselves.
 */
export async function connectGoogle(): Promise<void> {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CONNECT_CLIENT_ID;
  if (!clientId) throw new Error('Connecting Google is not set up here.');
  await loadScript('https://accounts.google.com/gsi/client');
  const oauth = window.google?.accounts?.oauth2;
  if (!oauth) throw new Error('Could not reach Google.');
  await new Promise<void>((resolve, reject) => {
    oauth
      .initTokenClient({
        client_id: clientId,
        scope: GOOGLE_SCOPES.join(' '),
        callback: (response) => {
          if (!response.access_token) {
            reject(new GoogleRefused(response.error ?? 'refused'));
            return;
          }
          held = {
            token: response.access_token,
            expires: Date.now() + (response.expires_in ?? 3600) * 1000,
            scopes: new Set((response.scope ?? '').split(' ')),
          };
          resolve();
        },
        error_callback: (error) => reject(new GoogleRefused(error.type ?? 'refused')),
      })
      .requestAccessToken();
  });
}

/** Revoke at Google and forget. It needs a live token, so a press may have to fetch one first. */
export async function disconnectGoogle(): Promise<void> {
  if (!googleConnected()) await connectGoogle();
  const token = held?.token;
  held = null;
  const oauth = window.google?.accounts?.oauth2;
  if (!token || !oauth) throw new Error('Could not reach Google.');
  await new Promise<void>((resolve) => oauth.revoke(token, () => resolve()));
}

export function forgetGoogle(): void {
  held = null;
}

function token(): string {
  if (!held || held.expires <= Date.now()) throw new GoogleRefused('expired');
  return held.token;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token()}` } });
  if (!response.ok) throw new Error(response.status === 403 ? 'Google did not give access to this.' : `Google said ${response.status}.`);
  return (await response.json()) as T;
}

interface CalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  status?: string;
  organizer?: { email?: string; displayName?: string };
  attendees?: { email?: string; displayName?: string }[];
  start?: { dateTime?: string; date?: string };
}

/** Pure: an event as an item. Its description may be HTML, and anyone who invites you can write it. */
export function eventItem(event: CalendarEvent): ConnectedItem {
  const startsAt = event.start?.dateTime ?? event.start?.date ?? '';
  const people = (event.attendees ?? []).map((a) => cleanText(a.displayName || a.email, 80)).filter(Boolean).slice(0, 25);
  const lines = [
    startsAt && `When: ${startsAt}`,
    event.location && `Where: ${cleanText(event.location, 200)}`,
    people.length ? `Who: ${people.join(', ')}` : '',
    visibleText(event.description),
  ].filter(Boolean);
  return {
    id: `gcal:${event.id}`,
    kind: 'calendar_event',
    source: cleanText(event.organizer?.displayName || event.organizer?.email, 200),
    title: cleanText(event.summary, 200) || '(no title)',
    text: lines.join('\n').slice(0, MAX_ITEM_CHARS),
    startsAt,
  };
}

export async function readGoogleCalendar(now = new Date()): Promise<ConnectedItem[]> {
  const until = new Date(now.getTime() + CALENDAR_DAYS * 86_400_000);
  const query = new URLSearchParams({
    timeMin: now.toISOString(),
    timeMax: until.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '30',
  });
  const { items = [] } = await getJson<{ items?: CalendarEvent[] }>(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${query}`
  );
  return items.filter((e) => e.status !== 'cancelled').map(eventItem);
}

interface GmailMessage {
  id: string;
  threadId?: string;
  payload?: { headers?: { name: string; value: string }[] };
}

/** Pure: a message as an item. The metadata scope gives headers only, so there is no body to read. */
export function mailItem(message: GmailMessage): ConnectedItem {
  const header = (name: string) => message.payload?.headers?.find((h) => h.name.toLowerCase() === name)?.value ?? '';
  return {
    id: `gmail:${message.threadId ?? message.id}`,
    kind: 'email',
    source: cleanText(header('from'), 200),
    title: cleanText(header('subject'), 200) || '(no subject)',
    text: [header('date') && `Date: ${cleanText(header('date'), 80)}`, header('to') && `To: ${cleanText(header('to'), 300)}`].filter(Boolean).join('\n'),
  };
}

async function inBatches<T, R>(rows: readonly T[], work: (row: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < rows.length; i += AT_ONCE) out.push(...(await Promise.all(rows.slice(i, i + AT_ONCE).map(work))));
  return out;
}

/** What they sent shows their work best; what they received fills in the rest. One row per conversation. */
export async function readGoogleMail(): Promise<ConnectedItem[]> {
  const list = (label: string, count: number) =>
    getJson<{ messages?: { id: string }[] }>(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${count}&labelIds=${label}`
    ).then((r) => r.messages ?? []);
  const [sent, received] = await Promise.all([list('SENT', MAIL_SENT), list('INBOX', MAIL_RECEIVED)]);
  const ids = [...new Set([...sent, ...received].map((m) => m.id))];
  const messages = await inBatches(ids, (id) =>
    getJson<GmailMessage>(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`
    )
  );
  const seen = new Set<string>();
  return messages.map(mailItem).filter((item) => (seen.has(item.id) ? false : Boolean(seen.add(item.id))));
}

const EXPORTS: Record<string, string> = {
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.presentation': 'text/plain',
  'application/vnd.google-apps.spreadsheet': 'text/csv',
};

async function fileText(doc: PickerDoc): Promise<string> {
  const exportAs = EXPORTS[doc.mimeType];
  const url = exportAs
    ? `https://www.googleapis.com/drive/v3/files/${doc.id}/export?mimeType=${encodeURIComponent(exportAs)}`
    : `https://www.googleapis.com/drive/v3/files/${doc.id}?alt=media`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token()}` } });
  if (!response.ok) throw new Error(`Google said ${response.status} for ${doc.name}.`);
  if (exportAs) return cleanText(await response.text());
  if (isDocument(doc.name)) {
    const read = await extractText(doc.name, await response.arrayBuffer());
    if ('error' in read) throw new Error(read.error);
    return cleanText(read.text);
  }
  return cleanText(await response.text());
}

/**
 * The Drive picker: only what the user picks, which is what `drive.file` allows and
 * why it needs no audit. Nothing else in their Drive is visible to this app.
 */
export async function pickGoogleFiles(): Promise<ConnectedItem[]> {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY;
  const appId = process.env.NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER;
  if (!apiKey || !appId) throw new Error('Picking Drive files is not set up here.');
  await loadScript('https://apis.google.com/js/api.js');
  await new Promise<void>((resolve) => window.gapi?.load('picker', resolve));
  const picker = window.google?.picker;
  if (!picker) throw new Error('Could not reach Google.');
  const docs = await new Promise<PickerDoc[]>((resolve) => {
    const builder = new picker.PickerBuilder();
    builder.setAppId(appId);
    builder.setOAuthToken(token());
    builder.setDeveloperKey(apiKey);
    builder.addView(picker.ViewId.DOCS);
    builder.enableFeature(picker.Feature.MULTISELECT_ENABLED);
    builder.setCallback((data) => {
      if (data.action === picker.Action.PICKED) resolve(data.docs ?? []);
      else if (data.action === picker.Action.CANCEL) resolve([]);
    });
    builder.build().setVisible(true);
  });
  return inBatches(docs, async (doc) => ({
    id: `gdrive:${doc.id}`,
    kind: 'file' as const,
    source: 'Google Drive',
    title: cleanText(doc.name, 200),
    text: await fileText(doc),
  }));
}
