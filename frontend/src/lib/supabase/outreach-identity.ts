import { createClient } from './client';
import type { OutreachLogo, OutreachSender, OutreachSettings, OutreachSignature, SendingToolkit, SignatureKind } from '@/types/outreach';

/**
 * Who outreach email goes out as (Sean, 26 Nov): the person's sending settings, their senders,
 * signatures and logos. Per user, under their own RLS (`20261220000000_outreach_identity.sql`).
 */

export const LOGO_BUCKET = 'email-logos';
/** A logo is loaded by every email that carries it: kept small. */
export const LOGO_MAX_BYTES = 300_000;
export const LOGO_TYPES: Readonly<Record<string, string>> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif' };

/** The opt-out line a new sender starts with; the person can change it. */
export const DEFAULT_OPT_OUT = 'If you would rather not hear from me again, reply "unsubscribe" and I will not write again.';

export const DEFAULT_SETTINGS: Omit<OutreachSettings, 'user_id'> = { daily_cap: 50, spacing_seconds: 45, paused: false, timezone: 'UTC' };

export async function loadOutreachSettings(userId: string): Promise<OutreachSettings> {
  const { data, error } = await createClient().from('outreach_settings').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return (data as OutreachSettings | null) ?? { user_id: userId, ...DEFAULT_SETTINGS, timezone: browserTimezone() };
}

export async function saveOutreachSettings(settings: OutreachSettings): Promise<void> {
  const { error } = await createClient()
    .from('outreach_settings')
    .upsert({ ...settings, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw error;
}

export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export async function listSenders(): Promise<OutreachSender[]> {
  const { data, error } = await createClient().from('outreach_senders').select('*').order('created_at');
  if (error) throw error;
  return (data ?? []) as OutreachSender[];
}

export type SenderFields = Pick<OutreachSender, 'from_name' | 'reply_to' | 'postal_address' | 'opt_out_line' | 'commercial'>;

/** A sender for a connected mailbox, made the first time the person sets it up. */
export async function createSender(userId: string, toolkit: SendingToolkit, fromAddress: string, fields: SenderFields): Promise<OutreachSender> {
  const { data, error } = await createClient()
    .from('outreach_senders')
    .insert({ user_id: userId, toolkit, from_address: fromAddress.trim().toLowerCase(), ...cleanSender(fields) })
    .select('*')
    .single();
  if (error) throw error;
  return data as OutreachSender;
}

export async function updateSender(id: string, fields: SenderFields): Promise<OutreachSender> {
  const { data, error } = await createClient()
    .from('outreach_senders')
    .update({ ...cleanSender(fields), updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as OutreachSender;
}

function cleanSender(f: SenderFields): SenderFields {
  const reply = (f.reply_to ?? '').trim().toLowerCase();
  return {
    from_name: f.from_name.trim().slice(0, 120),
    reply_to: reply || null,
    postal_address: f.postal_address.trim().slice(0, 500),
    opt_out_line: f.opt_out_line.trim().slice(0, 300),
    commercial: f.commercial,
  };
}

export async function listSignatures(): Promise<OutreachSignature[]> {
  const { data, error } = await createClient().from('outreach_signatures').select('*').order('created_at');
  if (error) throw error;
  return (data ?? []) as OutreachSignature[];
}

export type SignatureFields = Pick<OutreachSignature, 'kind' | 'label' | 'name' | 'title' | 'company' | 'website' | 'links' | 'logo_id' | 'logo_width'>;

export async function saveSignature(userId: string, senderId: string, fields: SignatureFields, id?: string): Promise<OutreachSignature> {
  const row = cleanSignature(fields);
  const client = createClient();
  const query = id
    ? client.from('outreach_signatures').update({ ...row, updated_at: new Date().toISOString() }).eq('id', id)
    : client.from('outreach_signatures').insert({ user_id: userId, sender_id: senderId, ...row });
  const { data, error } = await query.select('*').single();
  if (error) throw error;
  return data as OutreachSignature;
}

export async function deleteSignature(id: string): Promise<void> {
  const { error } = await createClient().from('outreach_signatures').delete().eq('id', id);
  if (error) throw error;
}

function cleanSignature(f: SignatureFields): SignatureFields {
  const site = f.website.trim();
  return {
    kind: f.kind as SignatureKind,
    label: f.label.trim().slice(0, 80),
    name: f.name.trim().slice(0, 120),
    title: f.title.trim().slice(0, 120),
    company: f.company.trim().slice(0, 120),
    website: site && !/^https:\/\//i.test(site) ? `https://${site.replace(/^http:\/\//i, '')}` : site,
    links: f.links
      .map((l) => ({ label: l.label.trim().slice(0, 60), url: l.url.trim() }))
      .filter((l) => l.url)
      .map((l) => ({ ...l, url: /^https:\/\//i.test(l.url) ? l.url : `https://${l.url.replace(/^http:\/\//i, '')}` }))
      .slice(0, 4),
    logo_id: f.logo_id,
    logo_width: Math.max(40, Math.min(300, Math.round(f.logo_width))),
  };
}

export function logoUrl(path: string): string {
  return createClient().storage.from(LOGO_BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function listLogos(): Promise<OutreachLogo[]> {
  const { data, error } = await createClient().from('outreach_logos').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return ((data ?? []) as Omit<OutreachLogo, 'url'>[]).map((l) => ({ ...l, url: logoUrl(l.path) }));
}

/** Why a file cannot be a logo, or null when it can. */
export function logoProblem(file: { type: string; size: number }): 'type' | 'size' | null {
  if (!LOGO_TYPES[file.type]) return 'type';
  if (file.size > LOGO_MAX_BYTES) return 'size';
  return null;
}

/**
 * Upload a logo: its row first (the storage policy allows an upload only to a registered path),
 * then the file. The address is random and holds no user id; it is public, because a
 * recipient's mail program loads it without signing in.
 */
export async function uploadLogo(userId: string, file: File, size: { width: number; height: number }): Promise<OutreachLogo> {
  const problem = logoProblem(file);
  if (problem) throw new Error(problem === 'type' ? 'A logo must be a PNG, JPEG or GIF image.' : 'A logo must be 300 KB or smaller.');
  const path = `l/${crypto.randomUUID()}.${LOGO_TYPES[file.type]}`;
  const client = createClient();
  const { data, error } = await client
    .from('outreach_logos')
    .insert({ user_id: userId, path, mime: file.type, width: size.width, height: size.height, bytes: file.size })
    .select('*')
    .single();
  if (error) throw error;
  const { error: upErr } = await client.storage.from(LOGO_BUCKET).upload(path, file, { contentType: file.type, cacheControl: '31536000', upsert: false });
  if (upErr) throw upErr;
  return { ...(data as Omit<OutreachLogo, 'url'>), url: logoUrl(path) };
}

/** An image's own size, read in the browser before it is uploaded. */
export function imageSize(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file could not be read as an image.'));
    };
    img.src = url;
  });
}
