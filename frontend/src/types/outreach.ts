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
