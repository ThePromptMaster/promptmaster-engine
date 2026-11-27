'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { api } from '@/lib/api/client';
import { useT } from '@/lib/i18n/i18n-provider';
import { parseContacts } from '@/lib/outreach/contacts';
import { blankMessage, changedBySync, draftText, editedFields, parseDrafts, parseMessage, serializeDrafts, syncDrafts, type DraftRow, type OutreachMessage } from '@/lib/outreach/drafts';
import { unresolvedPlaceholders } from '@/lib/outreach/placeholders';
import { renderEmail, type RenderedEmail } from '@/lib/outreach/render';
import type { Snapshot } from '@/lib/outreach/snapshot';
import { listLogos, listSenders, listSignatures, loadOutreachSettings } from '@/lib/supabase/outreach-identity';
import type { SendRecord } from '@/lib/supabase/outreach-sends';
import type { OutreachContext } from '@/components/workflow/renderers/types';
import type { OutreachLogo, OutreachSender, OutreachSignature } from '@/types/outreach';
import { EmailPreview } from './email-preview';
import { useSending } from './use-sending';

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

/** An approved email as the record shows it: exactly what was approved. */
function fromSnapshot(s: Snapshot): RenderedEmail {
  return { subject: s.subject, html: s.html, text: s.text, links: s.links, warnings: [] };
}

function localInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * One email per ready contact (Sean, 26 Nov: "Save the standard message and let me edit individual
 * drafts … Hold anything with an unresolved placeholder … Show the actual From, Reply-To, To,
 * CC/BCC, subject, body, links, attachments, and signature before sending … Let me approve one email
 * or a selected batch … Give me send now, schedule, and pause … Give me a Send test to myself button").
 */
export function DraftsPart({ context, stageId, readOnly }: { context: OutreachContext; stageId: string; readOnly: boolean }) {
  const t = useT();
  const contacts = useMemo(() => parseContacts(context.parts.contacts?.content).items, [context.parts.contacts?.content]);
  const message = useMemo(() => parseMessage(context.parts.message?.content) ?? blankMessage(), [context.parts.message?.content]);
  const drafts = useMemo(() => parseDrafts(context.parts.drafts?.content), [context.parts.drafts?.content]);
  const [identity, setIdentity] = useState<{ senders: OutreachSender[]; signatures: OutreachSignature[]; logos: OutreachLogo[]; spacing: number }>({ senders: [], signatures: [], logos: [], spacing: 45 });
  const [open, setOpen] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [problems, setProblems] = useState<Record<string, string[]>>({});
  const [when, setWhen] = useState(() => localInput(new Date(Date.now() + 60 * 60 * 1000)));

  useEffect(() => {
    let live = true;
    Promise.all([listSenders(), listSignatures(), listLogos(), loadOutreachSettings(context.project.user_id)])
      .then(([senders, signatures, logos, settings]) => live && setIdentity({ senders, signatures, logos, spacing: settings.spacing_seconds }))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [context.project.user_id]);

  const synced = useMemo(() => syncDrafts(contacts, message, drafts, newId), [contacts, message, drafts]);
  const added = synced.filter((d) => !drafts.some((x) => x.id === d.id)).length;
  const changed = changedBySync(drafts, synced).length;
  const removed = drafts.filter((d) => !synced.some((x) => x.id === d.id)).length;
  const outOfDate = added + changed + removed > 0;

  const sender = identity.senders.find((s) => s.id === message.sender_id) ?? identity.senders[0] ?? null;
  const signature = identity.signatures.find((s) => s.id === message.signature_id) ?? identity.signatures.find((s) => s.sender_id === sender?.id && s.kind === 'first') ?? null;
  const logo = signature?.logo_id ? identity.logos.find((l) => l.id === signature.logo_id) ?? null : null;

  const save = useCallback((items: DraftRow[], operation: string, summary: string) => context.save(stageId, serializeDrafts(items), operation, summary), [context, stageId]);
  const sending = useSending({
    projectId: context.project.id,
    userId: context.project.user_id,
    draftsStageId: stageId,
    messageStageId: context.parts.message?.stageId ?? '',
    message,
    identity: { sender, signature, logo, spacingSeconds: identity.spacing },
    saveDrafts: (items, summary) => save(items, 'outreach_edit', summary),
  });

  const act = (key: string, run: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    setSaid(null);
    run().catch((e) => setError(t('outreach.saveError', { message: errorText(e) }))).finally(() => setBusy(null));
  };
  const update = (id: string, patch: Partial<DraftRow>, summary: string) => act(`d:${id}`, () => save(drafts.map((d) => (d.id === id ? { ...d, ...patch } : d)), 'outreach_edit', summary));

  const approvable = (d: DraftRow) => !readOnly && !d.status && heldBy(d, message).length === 0 && Boolean(sender) && Boolean(d.to.trim());
  const readyToSend = drafts.filter((d) => d.status === 'approved' && d.approval_id && !sending.liveSendOf(d.approval_id));

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

      {!readOnly && (selected.size > 0 || readyToSend.length > 0) && (
        <div data-send-bar className="space-y-2 rounded-xl bg-[color-mix(in_srgb,var(--pm-primary)_8%,var(--surface-container-low))] p-3">
          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              <p className="min-w-0 flex-1 text-body text-[var(--on-surface)]">{t('outreach.approveLead', { count: selected.size, from: sender?.from_address ?? '' })}</p>
              <button
                type="button"
                className={primary}
                disabled={busy !== null}
                data-approve-selected
                onClick={() =>
                  act('approve', async () => {
                    const r = await sending.approve(drafts, selected);
                    setProblems(Object.fromEntries(r.problems.map((p) => [p.draftId, p.problems])));
                    setSelected(new Set());
                    setSaid(t('outreach.approvedCount', { count: r.approved }));
                  })
                }
              >
                {t('outreach.approveSelected', { count: selected.size })}
              </button>
            </div>
          )}
          {readyToSend.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <p className="min-w-0 flex-1 text-body text-[var(--on-surface)]">{t('outreach.readyToSend', { count: readyToSend.length, spacing: identity.spacing })}</p>
              <button type="button" className={primary} disabled={busy !== null} data-send-now onClick={() => act('send', async () => setSaid(t('outreach.queuedNow', { count: await sending.send(drafts, 'now') })))}>
                {t('outreach.sendNow')}
              </button>
              <input type="datetime-local" className={`${field} w-auto`} value={when} onChange={(e) => setWhen(e.target.value)} aria-label={t('outreach.scheduleFor')} data-schedule-at />
              <button
                type="button"
                className={quiet}
                disabled={busy !== null || !when}
                data-schedule
                onClick={() => act('schedule', async () => setSaid(t('outreach.queuedLater', { count: await sending.send(drafts, new Date(when)), when: new Date(when).toLocaleString() })))}
              >
                {t('outreach.schedule')}
              </button>
            </div>
          )}
        </div>
      )}
      {said && <p role="status" className="rounded-lg bg-[var(--surface-container-low)] px-3 py-2 text-label text-[var(--on-surface)]">{said}</p>}
      {error && <p role="alert" className="text-label text-[var(--pm-error)]">{error}</p>}
      <ul data-drafts className="space-y-1.5">
        {drafts.map((d) => {
          const approval = d.approval_id ? sending.approvalById.get(d.approval_id) ?? null : null;
          const send = sending.liveSendOf(d.approval_id);
          return (
            <DraftLine
              key={d.id}
              draft={d}
              message={message}
              open={open === d.id}
              onToggle={() => setOpen(open === d.id ? null : d.id)}
              readOnly={readOnly}
              busy={busy !== null}
              selectable={approvable(d)}
              selected={selected.has(d.id)}
              onSelect={(on) => setSelected((s) => {
                const next = new Set(s);
                if (on) next.add(d.id);
                else next.delete(d.id);
                return next;
              })}
              problems={problems[d.id] ?? []}
              send={send}
              approved={approval?.snapshot ?? null}
              test={sending.testOf(d.id)}
              canTest={Boolean(sender) && heldBy(d, message).length === 0}
              onTest={() => act(`test:${d.id}`, async () => {
                const p = await sending.sendTest(d);
                if (p.length) setProblems((x) => ({ ...x, [d.id]: p }));
              })}
              onWithdraw={() => act(`w:${d.id}`, () => sending.withdraw(drafts, d))}
              onMove={(to) => send && act(`m:${d.id}`, () => sending.move(send.id, to))}
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
          );
        })}
      </ul>
    </div>
  );
}

/** The email as it goes out, for one draft. */
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

function useSendWords() {
  const t = useT();
  return (s: SendRecord): string => {
    const at = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '');
    switch (s.status) {
      case 'scheduled':
        return s.status_reason ? `${t('outreach.sendScheduled', { when: at(s.scheduled_for) })} ${s.status_reason}` : t('outreach.sendScheduled', { when: at(s.scheduled_for) });
      case 'paused':
        return t('outreach.sendPaused');
      case 'held':
        return t('outreach.sendHeld', { reason: s.status_reason });
      case 'submitting':
        return t('outreach.sendSubmitting');
      case 'submitted':
        return t('outreach.sendSubmitted');
      case 'confirmed':
        return t('outreach.sendConfirmed', { when: at(s.confirmed_at) });
      case 'failed':
        return t('outreach.sendFailed', { reason: s.status_reason });
      case 'cancelled':
        return t('outreach.sendCancelled');
      default:
        return s.status;
    }
  };
}

function DraftLine(props: {
  draft: DraftRow;
  message: OutreachMessage;
  open: boolean;
  onToggle: () => void;
  readOnly: boolean;
  busy: boolean;
  selectable: boolean;
  selected: boolean;
  onSelect: (on: boolean) => void;
  problems: string[];
  send: SendRecord | null;
  approved: Snapshot | null;
  test: { approval: { snapshot: Snapshot }; send: SendRecord | null } | null;
  canTest: boolean;
  onTest: () => void;
  onWithdraw: () => void;
  onMove: (to: 'paused' | 'scheduled' | 'cancelled') => void;
  onEdit: (patch: Partial<DraftRow>, fields: string[]) => void;
  onReset: () => void;
  onSetAside: (why: string) => void;
  onRestore: () => void;
  preview: (imagesOff: boolean) => RenderedEmail;
  from: string;
  replyTo: string | null;
  signatureName: string | null;
}) {
  const { draft, message, open, onToggle, readOnly, busy, selectable, selected, onSelect, problems, send, approved, test, canTest } = props;
  const t = useT();
  const words = useSendWords();
  const [form, setForm] = useState({ to: draft.to, subject: draft.subject, body: draft.body });
  const [why, setWhy] = useState('');
  const [checks, setChecks] = useState<{ key: string; ok: boolean; detail: string }[] | null>(null);
  const [checking, setChecking] = useState(false);
  const held = heldBy(draft, message);
  const text = draftText(draft, message);
  const edited = editedFields(draft);
  const preview = props.preview;
  const render = useCallback((off: boolean) => preview(off), [preview]);
  const approvedRender = useCallback(() => fromSnapshot(approved!), [approved]);
  const state = send ? words(send) : draft.status === 'approved' ? t('outreach.draftApproved') : draft.status === 'set_aside' ? t('outreach.draftSetAside') : held.length ? t('outreach.draftHeld') : t('outreach.draftToReview');
  const locked = draft.status === 'approved';
  return (
    <li data-draft={draft.id} data-held={held.length > 0 || undefined} data-send-status={send?.status} className="rounded-xl bg-[var(--surface-container-low)]">
      <div className="flex items-start gap-2 px-3 py-2.5">
        {selectable && (
          <input type="checkbox" className="mt-1.5" checked={selected} onChange={(e) => onSelect(e.target.checked)} aria-label={t('outreach.selectEmail', { to: draft.to })} data-select-draft />
        )}
        <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-w-0 flex-1 items-start gap-3 text-start">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-body font-medium text-[var(--on-surface)]">{draft.to || t('outreach.noAddress')}</span>
            <span className="block truncate text-label text-[var(--on-surface-variant)]">{text.subject || t('outreach.noSubject')}</span>
            {held.length > 0 && <span className="block text-label text-[var(--pm-tertiary)]">{t('outreach.heldBecause', { list: held.join(', ') })}</span>}
            {draft.status === 'set_aside' && draft.reason && <span className="block text-label text-[var(--on-surface-variant)]">{draft.reason}</span>}
            {problems.length > 0 && <span role="alert" className="block text-label text-[var(--pm-error)]">{problems.join(' ')}</span>}
          </span>
          {edited.size > 0 && <span className="shrink-0 rounded bg-[var(--surface-container-high)] px-1.5 text-label text-[var(--on-surface-variant)]">{t('outreach.editedByYou')}</span>}
          <span className="max-w-[45%] shrink-0 text-end text-label font-semibold text-[var(--on-surface-variant)]" data-draft-state>{state}</span>
        </button>
      </div>
      {open && (
        <div className="space-y-3 px-3 pb-3">
          {send?.thread_url && (
            <a href={send.thread_url} target="_blank" rel="noreferrer" className="text-label text-[var(--pm-primary)] hover:underline" data-open-thread>{t('outreach.openInGmail')}</a>
          )}
          {approved ? (
            <>
              <p className="text-label font-semibold uppercase tracking-wider text-[var(--on-surface-variant)]">{send?.status === 'confirmed' ? t('outreach.whatWasSent') : t('outreach.whatWasApproved')}</p>
              <EmailPreview render={approvedRender} headers={{ from: approved.from.name ? `${approved.from.name} <${approved.from.address}>` : approved.from.address, replyTo: approved.reply_to || null, to: approved.to, cc: approved.cc, bcc: approved.bcc, signature: props.signatureName }} />
            </>
          ) : (
            <EmailPreview render={render} headers={{ from: props.from, replyTo: props.replyTo, to: draft.to ? [draft.to] : [], cc: draft.cc ? [draft.cc] : [], bcc: draft.bcc ? [draft.bcc] : [], signature: props.signatureName }} />
          )}
          {!readOnly && (
            <div className="flex flex-wrap items-center gap-2">
              {canTest && (
                <button type="button" className={quiet} disabled={busy} onClick={props.onTest} data-send-test>{t('outreach.sendTest')}</button>
              )}
              {test?.send && <span className="text-label text-[var(--on-surface-variant)]" data-test-state>{t('outreach.testState', { state: words(test.send) })}</span>}
              {test?.send?.status === 'confirmed' && test.send.provider_message_id && (
                <button
                  type="button"
                  className={quiet}
                  disabled={checking}
                  data-check-test
                  onClick={() => {
                    setChecking(true);
                    api.outreachCheckTest({ snapshot: test.approval.snapshot, message_id: test.send!.provider_message_id })
                      .then((r) => setChecks(r.checks))
                      .catch(() => setChecks([{ key: 'received', ok: false, detail: '' }]))
                      .finally(() => setChecking(false));
                  }}
                >
                  {checking ? t('outreach.checking') : t('outreach.checkTest')}
                </button>
              )}
            </div>
          )}
          {checks && (
            <ul data-test-checks className="space-y-0.5 rounded-lg bg-[var(--surface-container-lowest)] px-3 py-2 text-label">
              {checks.map((c) => (
                <li key={c.key} className={c.ok ? 'text-[var(--on-surface)]' : 'text-[var(--pm-error)]'}>
                  <span aria-hidden className="material-symbols-outlined me-1 align-[-3px] text-[16px]">{c.ok ? 'check_circle' : 'error'}</span>
                  {t(`outreach.check.${c.key}` as 'outreach.check.logo')}{c.detail ? `: ${c.detail}` : ''}
                </li>
              ))}
            </ul>
          )}
          {!readOnly && locked && (
            <div className="flex flex-wrap gap-2">
              {send?.status === 'scheduled' && <button type="button" className={quiet} disabled={busy} onClick={() => props.onMove('paused')} data-pause-send>{t('outreach.pause')}</button>}
              {send?.status === 'paused' && <button type="button" className={quiet} disabled={busy} onClick={() => props.onMove('scheduled')} data-resume-send>{t('outreach.resume')}</button>}
              {(!send || ['scheduled', 'paused', 'held', 'failed', 'cancelled'].includes(send.status)) && (
                <button type="button" className={quiet} disabled={busy} onClick={props.onWithdraw} data-withdraw>{t('outreach.withdraw')}</button>
              )}
            </div>
          )}
          {!readOnly && !locked && (
            <>
              <form
                data-draft-form
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const fields = (['to', 'subject', 'body'] as const).filter((k) => form[k] !== draft[k]);
                  if (fields.length) props.onEdit(form, fields);
                }}
              >
                <input className={field} value={form.to} aria-label={t('outreach.hTo')} onChange={(e) => setForm({ ...form, to: e.target.value })} data-draft-to />
                <input className={field} value={form.subject} aria-label={t('outreach.hSubject')} onChange={(e) => setForm({ ...form, subject: e.target.value })} data-draft-subject />
                <textarea className={`${field} min-h-[160px]`} value={form.body} aria-label={t('outreach.body')} onChange={(e) => setForm({ ...form, body: e.target.value })} data-draft-body />
                <div className="flex flex-wrap gap-2">
                  <button type="submit" className={quiet} disabled={busy} data-draft-save>{t('outreach.saveEmail')}</button>
                  {edited.size > 0 && <button type="button" className={quiet} disabled={busy} onClick={props.onReset} data-draft-reset>{t('outreach.useMessageAgain')}</button>}
                </div>
              </form>
              {draft.status === 'set_aside' ? (
                <button type="button" className={quiet} disabled={busy} onClick={props.onRestore}>{t('outreach.bringBack')}</button>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <input className={`${field} max-w-[260px]`} placeholder={t('outreach.setAsideWhy')} aria-label={t('outreach.setAsideWhy')} value={why} onChange={(e) => setWhy(e.target.value)} />
                  <button type="button" className={quiet} disabled={busy || !why.trim()} onClick={() => props.onSetAside(why.trim())} data-draft-set-aside>{t('outreach.setAside')}</button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </li>
  );
}
