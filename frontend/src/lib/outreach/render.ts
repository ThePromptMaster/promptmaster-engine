/**
 * An outreach email as it goes out: the body, the signature with the logo underneath, and the
 * footer a commercial email carries (Sean, 26 Nov: "Make the actual email look right … The
 * contact details should still be readable if the recipient's email app hides images").
 *
 * Pure and DOM-free, so the page, the preview and the job that sends all render one way.
 *
 * - The body is the user's plain text. It is escaped; only https addresses become links.
 * - The signature's details are text, so they read with images off. The logo sits under them
 *   with its width and height set and alt text naming the company.
 * - Every email carries a plain-text copy beside the HTML, for the preview and the record.
 */
import type { OutreachSender, OutreachSignature } from '@/types/outreach';

export interface LogoForEmail {
  url: string;
  /** The image's own size, to keep its shape at the chosen width. */
  width: number;
  height: number;
}

export interface RenderInput {
  sender: Pick<OutreachSender, 'from_name' | 'from_address' | 'postal_address' | 'opt_out_line' | 'commercial'>;
  signature: Pick<OutreachSignature, 'name' | 'title' | 'company' | 'website' | 'links' | 'logo_width'> | null;
  logo: LogoForEmail | null;
  subject: string;
  body: string;
  /** Show the logo's alt text in its place, as a mail program does with images off. */
  imagesOff?: boolean;
}

export type RenderWarning =
  /** The text already carries signature details, so they would show twice. */
  | { kind: 'signature_in_body'; found: string }
  /** A commercial email with no postal address or opt-out line. */
  | { kind: 'compliance_missing'; missing: ('postal_address' | 'opt_out_line')[] };

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
  /** Every link the email carries, body and signature, in order. */
  links: string[];
  warnings: RenderWarning[];
}

const FONT = "font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1f2933";
const LINK = 'color:#0b6b6b;text-decoration:underline';
const URL_RE = /https:\/\/[^\s<>"')\]]+[^\s<>"')\].,;:!?]/g;

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** https only; anything else is shown as text, never linked. */
export function safeHttpsUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!/^https:\/\/[^\s]+$/i.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' ? trimmed : null;
  } catch {
    return null;
  }
}

/** The address as people read it: no scheme, no trailing slash. */
function shownUrl(url: string): string {
  return url.replace(/^https:\/\//i, '').replace(/\/$/, '');
}

function linkify(escapedLine: string, links: string[]): string {
  return escapedLine.replace(URL_RE, (raw) => {
    const url = raw.replace(/&amp;/g, '&');
    if (!safeHttpsUrl(url)) return raw;
    links.push(url);
    return `<a href="${escapeHtml(url)}" style="${LINK}">${raw}</a>`;
  });
}

function bodyHtml(body: string, links: string[]): string {
  const paragraphs = body.replace(/\r\n/g, '\n').trim().split(/\n{2,}/).filter((p) => p.trim());
  return paragraphs
    .map((p) => `<p style="margin:0 0 12px 0">${p.split('\n').map((line) => linkify(escapeHtml(line), links)).join('<br>')}</p>`)
    .join('');
}

function bodyLinks(body: string): string[] {
  return [...body.matchAll(URL_RE)].map((m) => m[0]).filter((u) => safeHttpsUrl(u) !== null);
}

/** The logo's size in the email: the chosen width, the image's own shape. */
export function logoSize(logo: LogoForEmail, width: number): { width: number; height: number } {
  const w = Math.max(40, Math.min(300, Math.round(width)));
  const h = logo.width > 0 ? Math.max(1, Math.round((logo.height / logo.width) * w)) : w;
  return { width: w, height: h };
}

function signatureHtml(sig: NonNullable<RenderInput['signature']>, logo: LogoForEmail | null, imagesOff: boolean, links: string[]): string {
  const rows: string[] = [];
  if (sig.name.trim()) rows.push(`<div style="font-weight:bold">${escapeHtml(sig.name.trim())}</div>`);
  if (sig.title.trim()) rows.push(`<div>${escapeHtml(sig.title.trim())}</div>`);
  if (sig.company.trim()) rows.push(`<div>${escapeHtml(sig.company.trim())}</div>`);
  const site = safeHttpsUrl(sig.website);
  if (site) {
    links.push(site);
    rows.push(`<div><a href="${escapeHtml(site)}" style="${LINK}">${escapeHtml(shownUrl(site))}</a></div>`);
  }
  const extra = (sig.links ?? [])
    .map((l) => ({ label: (l.label ?? '').trim(), url: safeHttpsUrl(l.url ?? '') }))
    .filter((l): l is { label: string; url: string } => Boolean(l.url));
  if (extra.length) {
    for (const l of extra) links.push(l.url);
    rows.push(`<div>${extra.map((l) => `<a href="${escapeHtml(l.url)}" style="${LINK}">${escapeHtml(l.label || shownUrl(l.url))}</a>`).join(' &middot; ')}</div>`);
  }
  if (logo) {
    const size = logoSize(logo, sig.logo_width);
    const alt = sig.company.trim() ? `${sig.company.trim()} logo` : 'Logo';
    rows.push(
      imagesOff
        ? `<div style="margin-top:8px;display:inline-block;padding:4px 8px;border:1px dashed #9aa5b1;color:#52606d;font-size:12px">${escapeHtml(alt)}</div>`
        : `<div style="margin-top:8px"><img src="${escapeHtml(logo.url)}" width="${size.width}" height="${size.height}" alt="${escapeHtml(alt)}" style="display:block;border:0;outline:none;width:${size.width}px;height:${size.height}px"></div>`
    );
  }
  if (!rows.length) return '';
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;${FONT}"><tr><td>${rows.join('')}</td></tr></table>`;
}

function signatureText(sig: NonNullable<RenderInput['signature']>): string {
  const lines = [sig.name, sig.title, sig.company].map((s) => s.trim()).filter(Boolean);
  const site = safeHttpsUrl(sig.website);
  if (site) lines.push(site);
  for (const l of sig.links ?? []) {
    const url = safeHttpsUrl(l.url ?? '');
    if (url) lines.push(l.label?.trim() ? `${l.label.trim()}: ${url}` : url);
  }
  return lines.length ? `--\n${lines.join('\n')}` : '';
}

function footer(sender: RenderInput['sender']): { html: string; text: string } {
  if (!sender.commercial) return { html: '', text: '' };
  const parts = [sender.postal_address.trim(), sender.opt_out_line.trim()].filter(Boolean);
  if (!parts.length) return { html: '', text: '' };
  return {
    html: `<p style="margin:20px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.4;color:#6b7280">${parts.map((p) => escapeHtml(p).replace(/\n/g, '<br>')).join('<br>')}</p>`,
    text: parts.join('\n'),
  };
}

/** The signature details the body already carries, so the signature would show them twice. */
export function signatureInBody(body: string, sig: RenderInput['signature']): string | null {
  if (!sig) return null;
  const tailLines = body.trim().split('\n').slice(-8).map((l) => l.trim().toLowerCase());
  const tail = tailLines.join('\n');
  const site = safeHttpsUrl(sig.website);
  // The website on a line of its own, as a signature has it: a sentence that links to it
  // ("Try it at https://promptmasterv1.com") is the message, not a second signature.
  const siteShown = site ? shownUrl(site).toLowerCase() : '';
  if (siteShown && tailLines.some((l) => l.replace(/^https:\/\//, '').replace(/\/$/, '') === siteShown)) return shownUrl(site!);
  const title = sig.title.trim().toLowerCase();
  const company = sig.company.trim().toLowerCase();
  if (title && company && tail.includes(title) && tail.includes(company)) return `${sig.title.trim()}, ${sig.company.trim()}`;
  return null;
}

export function renderEmail(input: RenderInput): RenderedEmail {
  const links: string[] = [];
  const warnings: RenderWarning[] = [];
  const body = bodyHtml(input.body, links);
  const sigHtml = input.signature ? signatureHtml(input.signature, input.logo, Boolean(input.imagesOff), links) : '';
  const foot = footer(input.sender);
  const dup = signatureInBody(input.body, input.signature);
  if (dup) warnings.push({ kind: 'signature_in_body', found: dup });
  if (input.sender.commercial) {
    const missing = ([
      ['postal_address', input.sender.postal_address],
      ['opt_out_line', input.sender.opt_out_line],
    ] as const).filter(([, v]) => !v.trim()).map(([k]) => k);
    if (missing.length) warnings.push({ kind: 'compliance_missing', missing });
  }
  const html = `<div style="${FONT}">${body}${sigHtml}${foot.html}</div>`;
  const sigText = input.signature ? signatureText(input.signature) : '';
  const text = [input.body.replace(/\r\n/g, '\n').trim(), sigText, foot.text].filter(Boolean).join('\n\n');
  // Body links first, in the order they appear, then the signature's.
  const ordered = [...bodyLinks(input.body), ...links.filter((l) => !bodyLinks(input.body).includes(l))];
  return { subject: input.subject.trim(), html, text, links: [...new Set(ordered)], warnings };
}
