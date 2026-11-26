'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useT } from '@/lib/i18n/i18n-provider';
import { parseContacts } from '@/lib/outreach/contacts';
import { blankMessage, changedBySync, draftText, editedFields, parseDrafts, parseMessage, serializeDrafts, syncDrafts, type DraftRow, type OutreachMessage } from '@/lib/outreach/drafts';
import { unresolvedPlaceholders } from '@/lib/outreach/placeholders';
import { renderEmail } from '@/lib/outreach/render';
import { listLogos, listSenders, listSignatures } from '@/lib/supabase/outreach-identity';
import type { OutreachContext } from '@/components/workflow/renderers/types';
import type { OutreachLogo, OutreachSender, OutreachSignature } from '@/types/outreach';
import { EmailPreview } from './email-preview';

const field = 'w-full rounded-lg bg-[var(--surface-container-lowest)] px-3 py-2 text-body text-[var(--on-surface)] outline-none focus:ring-2 focus:ring-[var(--pm-primary)]/40';
const primary = 'rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-label font-semibold text-[var(--on-primary)] hover:opacity-90 disabled:opacity-50';
const quiet = 'rounded-lg bg-[var(--surface-container-high)] px-3 py-1.5 text-label font-medium text-[var(--on-surface)] hover:bg-[var(--surface-container-highest)] disabled:opacity-50';

let idCounter = 0;
const newId = () => `d_${Date.now().toString(36)}${(idCounter++).toString(36)}`;

function errorText(e: unknown): string {
  return e instanceof Error && e.message ? e.message : String((e as { message?: string })?.message ?? e);
}

/** What still needs filling in before this email can go: the placeholders left once its values are in. */
export function heldBy(d: DraftRow, message: OutreachMessage): string[] {
  const text = draftText(d, message);
  return unresolvedPlaceholders(`${text.subject}\n${text.body}`);
}

/**
 * One email per ready contact (Sean, 26 Nov: "Save the standard message and let me edit individual
 * drafts … Hold anything with an unresolved placeholder … Show the actual From, Reply-To, To,
 * CC/BCC, subject, body, links, attachments, and signature before sending").
 */
export function DraftsPart({ context, stageId, readOnly }: { context: OutreachContext; stageId: string; readOnly: boolean }) {
  const t = useT();
  const contacts = useMemo(() => parseContacts(context.parts.contacts?.content).items, [context.parts.contacts?.content]);
  const message = useMemo(() => parseMessage(context.parts.message?.content) ?? blankMessage(), [context.parts.message?.content]);
  const drafts = useMemo(() => parseDrafts(context.parts.drafts?.content), [context.parts.drafts?.content]);
  const [identity, setIdentity] = useState<{ senders: OutreachSender[]; signatures: OutreachSignature[]; logos: OutreachLogo[] }>({ senders: [], signatures: [], logos: [] });
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([listSenders(), listSignatures(), listLogos()])
      .then(([senders, signatures, logos]) => live && setIdentity({ senders, signatures, logos }))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const synced = useMemo(() => syncDrafts(contacts, message, drafts, newId), [contacts, message, drafts]);
  const added = synced.filter((d) => !drafts.some((x) => x.id === d.id)).length;
  const changed = changedBySync(drafts, synced).length;
  const removed = drafts.filter((d) => !synced.some((x) => x.id === d.id)).length;
  const outOfDate = added + changed + removed > 0;

  const sender = identity.senders.find((s) => s.id === message.sender_id) ?? identity.senders[0] ?? null;
  const signature = identity.signatures.find((s) => s.id === message.signature_id) ?? identity.signatures.find((s) => s.sender_id === sender?.id && s.kind === 'first') ?? null;
  const logo = signature?.logo_id ? identity.logos.find((l) => l.id === signature.logo_id) ?? null : null;

  const save = async (items: DraftRow[], operation: string, summary: string) => {
    await context.save(stageId, serializeDrafts(items), operation, summary);
  };
  const act = (key: string, run: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    run().catch((e) => setError(t('outreach.saveError', { message: errorText(e) }))).finally(() => setBusy(null));
  };
  const update = (id: string, patch: Partial<DraftRow>, summary: string) =>
    act(`d:${id}`, () => save(drafts.map((d) => (d.id === id ? { ...d, ...patch } : d)), 'outreach_edit', summary));

  if (!contacts.some((c) => c.status === 'ready')) return <p data-outreach-part="drafts" className="text-body text-[var(--on-surface-variant)]">{t('outreach.noReadyContacts')}</p>;
  if (!message.body.trim()) return <p data-outreach-part="drafts" className="text-body text-[var(--on-surface-variant)]">{t('outreach.noMessage')}</p>;

  return (
    <div data-outreach-part="drafts" className="space-y-3">
      {!readOnly && outOfDate && (
        <div data-drafts-sync className="flex flex-wrap items-center gap-3 rounded-xl bg-[var(--surface-container-low)] p-3">
          <p className="min-w-0 flex-1 text-body text-[var(--on-surface)]">
            {drafts.length === 0 ? t('outreach.draftsToMake', { count: added }) : t('outreach.draftsToUpdate', { added, changed, removed })}
          </p>
          <button
            type="button"
            className={primary}
            disabled={busy !== null}
            data-make-drafts
            onClick={() => act('sync', () => save(synced, 'outreach_drafts', drafts.length ? `Updated the emails from the message (${added} added, ${changed} changed).` : `Made ${added} emails from the message.`))}
          >
            {drafts.length === 0 ? t('outreach.makeDrafts') : t('outreach.updateDrafts')}
          </button>
        </div>
      )}
      {error && <p role="alert" className="text-label text-[var(--pm-error)]">{error}</p>}
      <ul data-drafts className="space-y-1.5">
        {drafts.map((d) => (
          <DraftLine
            key={d.id}
            draft={d}
            message={message}
            open={open === d.id}
            onToggle={() => setOpen(open === d.id ? null : d.id)}
            readOnly={readOnly}
            busy={busy !== null}
            onEdit={(patch, fields) => {
              const edited = new Set([...editedFields(d), ...fields]);
              update(d.id, { ...patch, edited: [...edited].join(',') }, `Edited the email to ${d.to}.`);
            }}
            onReset={() => update(d.id, { edited: '' }, `Put the email to ${d.to} back to the message.`)}
            onSetAside={(why) => update(d.id, { status: 'set_aside', reason: why }, `Set aside the email to ${d.to}.`)}
            onRestore={() => update(d.id, { status: '', reason: '' }, `Brought back the email to ${d.to}.`)}
            preview={renderFor(d, message, sender, signature, logo)}
            from={sender ? (sender.from_name ? `${sender.from_name} <${sender.from_address}>` : sender.from_address) : t('outreach.noSender')}
            replyTo={sender?.reply_to ?? null}
            signatureName={signature ? [signature.name, signature.company].filter(Boolean).join(', ') : null}
          />
        ))}
      </ul>
    </div>
  );
}

/** The email as it goes out, for one draft; a plain function, so each line memoises its own. */
function renderFor(d: DraftRow, message: OutreachMessage, sender: OutreachSender | null, signature: OutreachSignature | null, logo: OutreachLogo | null) {
  return (imagesOff: boolean) => {
    const text = draftText(d, message);
    return renderEmail({
      sender: sender ?? { from_name: '', from_address: '', postal_address: '', opt_out_line: '', commercial: false },
      signature,
      logo: logo ? { url: logo.url, width: logo.width, height: logo.height } : null,
      subject: text.subject,
      body: text.body,
      imagesOff,
    });
  };
}

function DraftLine({ draft, message, open, onToggle, readOnly, busy, onEdit, onReset, onSetAside, onRestore, preview, from, replyTo, signatureName }: {
  draft: DraftRow;
  message: OutreachMessage;
  open: boolean;
  onToggle: () => void;
  readOnly: boolean;
  busy: boolean;
  onEdit: (patch: Partial<DraftRow>, fields: string[]) => void;
  onReset: () => void;
  onSetAside: (why: string) => void;
  onRestore: () => void;
  preview: (imagesOff: boolean) => ReturnType<typeof renderEmail>;
  from: string;
  replyTo: string | null;
  signatureName: string | null;
}) {
  const t = useT();
  const [form, setForm] = useState({ to: draft.to, subject: draft.subject, body: draft.body });
  const [why, setWhy] = useState('');
  const held = heldBy(draft, message);
  const text = draftText(draft, message);
  const edited = editedFields(draft);
  const render = useCallback((off: boolean) => preview(off), [preview]);
  const state = draft.status === 'approved' ? t('outreach.draftApproved') : draft.status === 'set_aside' ? t('outreach.draftSetAside') : held.length ? t('outreach.draftHeld') : t('outreach.draftToReview');
  return (
    <li data-draft={draft.id} data-held={held.length > 0 || undefined} className="rounded-xl bg-[var(--surface-container-low)]">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-start gap-3 px-3 py-2.5 text-start">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body font-medium text-[var(--on-surface)]">{draft.to || t('outreach.noAddress')}</span>
          <span className="block truncate text-label text-[var(--on-surface-variant)]">{text.subject || t('outreach.noSubject')}</span>
          {held.length > 0 && <span className="block text-label text-[var(--pm-tertiary)]">{t('outreach.heldBecause', { list: held.join(', ') })}</span>}
          {draft.status === 'set_aside' && draft.reason && <span className="block text-label text-[var(--on-surface-variant)]">{draft.reason}</span>}
        </span>
        {edited.size > 0 && <span className="shrink-0 rounded bg-[var(--surface-container-high)] px-1.5 text-label text-[var(--on-surface-variant)]">{t('outreach.editedByYou')}</span>}
        <span className="shrink-0 text-label font-semibold text-[var(--on-surface-variant)]">{state}</span>
      </button>
      {open && (
        <div className="space-y-3 px-3 pb-3">
          <EmailPreview render={render} headers={{ from, replyTo, to: draft.to ? [draft.to] : [], cc: draft.cc ? [draft.cc] : [], bcc: draft.bcc ? [draft.bcc] : [], signature: signatureName }} />
          {!readOnly && draft.status !== 'approved' && (
            <>
              <form
                data-draft-form
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const fields = (['to', 'subject', 'body'] as const).filter((k) => form[k] !== draft[k]);
                  if (fields.length) onEdit(form, fields);
                }}
              >
                <input className={field} value={form.to} aria-label={t('outreach.hTo')} onChange={(e) => setForm({ ...form, to: e.target.value })} data-draft-to />
                <input className={field} value={form.subject} aria-label={t('outreach.hSubject')} onChange={(e) => setForm({ ...form, subject: e.target.value })} data-draft-subject />
                <textarea className={`${field} min-h-[160px]`} value={form.body} aria-label={t('outreach.body')} onChange={(e) => setForm({ ...form, body: e.target.value })} data-draft-body />
                <div className="flex flex-wrap gap-2">
                  <button type="submit" className={quiet} disabled={busy} data-draft-save>{t('outreach.saveEmail')}</button>
                  {edited.size > 0 && <button type="button" className={quiet} disabled={busy} onClick={onReset} data-draft-reset>{t('outreach.useMessageAgain')}</button>}
                </div>
              </form>
              {draft.status === 'set_aside' ? (
                <button type="button" className={quiet} disabled={busy} onClick={onRestore}>{t('outreach.bringBack')}</button>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <input className={`${field} max-w-[260px]`} placeholder={t('outreach.setAsideWhy')} aria-label={t('outreach.setAsideWhy')} value={why} onChange={(e) => setWhy(e.target.value)} />
                  <button type="button" className={quiet} disabled={busy || !why.trim()} onClick={() => onSetAside(why.trim())} data-draft-set-aside>{t('outreach.setAside')}</button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </li>
  );
}
