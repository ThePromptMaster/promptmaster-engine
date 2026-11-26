/**
 * Outreach email (Sean, 26 Nov: "PromptMaster email workflow from a rough list to sent
 * messages"). Rows from `supabase/migrations/20261220000000_outreach_identity.sql`.
 */

export type SendingToolkit = 'gmail' | 'outlook';

/** A connected mailbox that can send, as `GET /api/outreach/mailbox` reports it. */
export interface OutreachMailbox {
  toolkit: SendingToolkit;
  label: string;
  connection_id: string;
  /** The address it sends as; '' when the mailbox could not say. */
  address: string;
}

export interface OutreachSettings {
  user_id: string;
  daily_cap: number;
  spacing_seconds: number;
  paused: boolean;
  timezone: string;
}

/** Who an email goes out as, and what a commercial email must carry. */
export interface OutreachSender {
  id: string;
  user_id: string;
  toolkit: SendingToolkit;
  from_name: string;
  from_address: string;
  reply_to: string | null;
  postal_address: string;
  opt_out_line: string;
  commercial: boolean;
  updated_at?: string;
}

export interface SignatureLink {
  label: string;
  url: string;
}

export type SignatureKind = 'first' | 'reply';

export interface OutreachSignature {
  id: string;
  user_id: string;
  sender_id: string;
  kind: SignatureKind;
  label: string;
  name: string;
  title: string;
  company: string;
  website: string;
  links: SignatureLink[];
  logo_id: string | null;
  logo_width: number;
  updated_at?: string;
}

export interface OutreachLogo {
  id: string;
  user_id: string;
  path: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
  /** The public address a recipient's mail program loads it from. */
  url: string;
}

/** `POST /api/outreach/sent-check`. */
export interface OutreachSentHit {
  address: string;
  on: string;
  subject: string;
  thread_url: string;
}
export interface OutreachSentCheck {
  /** False when no Gmail is connected: nothing was searched. */
  checked: boolean;
  sent: OutreachSentHit[];
  colleagues: (OutreachSentHit & { domain: string })[];
}

/** `POST /api/outreach/draft-message`, with the web fields every writer returns. */
export interface OutreachDraftedMessage {
  subject: string;
  body: string;
  followup_body: string;
  offer: string;
  link: string;
  web_query?: string;
  web_sources?: { url: string; title: string; excerpt: string }[];
  web_note?: string;
  model_used?: string;
}

/** One earlier touch on record (`outreach_history`). */
export interface OutreachHistoryRow {
  id: string;
  address: string;
  domain: string;
  person_name: string;
  company: string;
  occurred_on: string | null;
  channel: string;
  source: 'manual' | 'mailbox' | 'promptmaster';
  project_id: string | null;
  subject: string;
  thread_url: string;
  note: string;
}

/** An address or a whole domain not to write to (`outreach_suppressions`). */
export interface OutreachSuppression {
  id: string;
  address: string | null;
  domain: string | null;
  reason: 'opted_out' | 'bounced' | 'complained' | 'company_replied' | 'manual';
  note: string;
  created_at: string;
}
