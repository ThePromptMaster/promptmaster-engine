'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import { api } from '@/lib/api/client';
import { useT } from '@/lib/i18n/i18n-provider';
import { blankMessage, parseDrafts, parseMessage, serializeDrafts, serializeMessage, type OutreachMessage } from '@/lib/outreach/drafts';
import { backForReview, findChanged, identityFor } from '@/lib/outreach/hold-changed';
import { previewChange, replaceInDrafts } from '@/lib/outreach/variable-change';
import { listApprovals, listSends, moveSends, revokeApproval } from '@/lib/supabase/outreach-sends';
import { unresolvedPlaceholders } from '@/lib/outreach/placeholders';
import { listLogos, listSenders, listSignatures } from '@/lib/supabase/outreach-identity';
import { inputsFrom } from '@/lib/workflow/stage-requests';
import { keepFound } from '@/lib/workflow/web-found';
import type { OutreachContext } from '@/components/workflow/renderers/types';
import type { OutreachSender, OutreachSignature } from '@/types/outreach';

const field = 'w-full rounded-lg bg-[var(--surface-container-lowest)] px-3 py-2 text-body text-[var(--on-surface)] outline-none focus:ring-2 focus:ring-[var(--pm-primary)]/40';
const label = 'block text-label font-medium text-[var(--on-surface-variant)]';
const primary = 'rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-label font-semibold text-[var(--on-primary)] hover:opacity-90 disabled:opacity-50';
const quiet = 'rounded-lg bg-[var(--surface-container-high)] px-3 py-1.5 text-label font-medium text-[var(--on-surface)] hover:bg-[var(--surface-container-highest)] disabled:opacity-50';
const TOKENS = ['{{first_name}}', '{{company}}', '{{personal_line}}', '{{offer}}', '{{link}}'];

function errorText(e: unknown): string {
  return e instanceof Error && e.message ? e.message : String((e as { message?: string })?.message ?? e);
}

/**
 * The standard message (Sean, 26 Nov: "Save the standard message and let me edit individual
 * drafts. If I change the offer or link for a batch, show me which drafts would change").
 * The offer and the link are values for the whole batch; who it goes out as comes from Settings.
 */
export function MessagePart({ context, stageId, readOnly }: { context: OutreachContext; stageId: string; readOnly: boolean }) {
  const t = useT();
  const saved = useMemo(() => parseMessage(context.parts.message?.content) ?? blankMessage(), [context.parts.message?.content]);
  const [m, setM] = useState<OutreachMessage>(saved);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<'write' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [senders, setSenders] = useState<OutreachSender[]>([]);
  const [signatures, setSignatures] = useState<OutreachSignature[]>([]);

  useEffect(() => {
    let live = true;
    Promise.all([listSenders(), listSignatures()])
      .then(([s, sig]) => {
        if (!live) return;
        setSenders(s);
        setSignatures(sig);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  // A first sender and its signatures are chosen for the user, who can change them.
  const sender = senders.find((s) => s.id === m.sender_id) ?? (m.sender_id ? null : senders[0] ?? null);
  const mine = signatures.filter((s) => s.sender_id === sender?.id);
  const set = (patch: Partial<OutreachMessage>) => {
    setM((x) => ({ ...x, ...patch }));
    setDirty(true);
    setSaid(null);
  };
  const left = unresolvedPlaceholders(`${m.subject}\n${m.body}`).filter((p) => !TOKENS.includes(p.replace(/\s+/g, '')));

  const write = async () => {
    setBusy('write');
    setError(null);
    try {
      const res = await api.draftOutreachMessage({ inputs: inputsFrom(context.project), brief: context.briefText.slice(0, 20_000), model: context.project.model, web_access: context.project.web_access ?? 'off' });
      await keepFound(context.project, res, { stageId }).catch(() => null);
      set({
        subject: res.subject,
        body: res.body,
        variables: { offer: res.offer || m.variables.offer, link: res.link || m.variables.link },
        followup: res.followup_body ? { body: res.followup_body, after_business_days: m.followup?.after_business_days ?? 3 } : m.followup,
      });
      setSaid(t('outreach.messageWritten'));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy('save');
    setError(null);
    try {
      const next: OutreachMessage = {
        ...m,
        sender_id: m.sender_id ?? sender?.id ?? null,
        signature_id: m.signature_id ?? mine.find((s) => s.kind === 'first')?.id ?? null,
        reply_signature_id: m.reply_signature_id ?? mine.find((s) => s.kind === 'reply')?.id ?? null,
      };
      await context.save(stageId, serializeMessage(next), 'outreach_edit', 'Saved the standard message.');
      setM(next);
      setDirty(false);
      // Approved emails the change reaches go back for review now (`hold-changed.ts`).
      const back = await holdApprovedChanged(next);
      setSaid(back ? t('outreach.sentBack', { count: back }) : t('outreach.saved'));
    } catch (e) {
      setError(t('outreach.saveError', { message: errorText(e) }));
    } finally {
      setBusy(null);
    }
  };

  /** The approved emails this message changes: held and withdrawn, back on Drafts for review. */
  const holdApprovedChanged = async (next: OutreachMessage): Promise<number> => {
    const draftsPart = context.parts.drafts;
    const current = parseDrafts(draftsPart?.content);
    if (!draftsPart || !current.some((d) => d.status === 'approved')) return 0;
    const [allSenders, allSignatures, logos, approvals, sends] = await Promise.all([listSenders(), listSignatures(), listLogos(), listApprovals(context.project.id), listSends(context.project.id)]);
    const changed = await findChanged({ drafts: current, message: next, identity: identityFor(next, allSenders, allSignatures, logos), approvals, sends, facts: context.project.facts });
    for (const c of changed) {
      if (c.sendId && c.movable) await moveSends([c.sendId], 'held', c.reason, true);
      else await revokeApproval(c.approvalId, c.reason);
    }
    if (changed.length) await context.save(draftsPart.stageId, serializeDrafts(backForReview(current, changed)), 'outreach_edit', `Sent ${changed.length} approved email${changed.length === 1 ? '' : 's'} back for review: the message changed.`);
    return changed.length;
  };

  // What saving would change, shown before it is saved (Sean, 26 Nov).
  const drafts = parseDrafts(context.parts.drafts?.content);
  const preview = dirty && drafts.length ? previewChange(saved, m, drafts) : null;
  const replaceThere = async () => {
    if (!preview?.kept.length || !context.parts.drafts) return;
    setError(null);
    try {
      await context.save(context.parts.drafts.stageId, serializeDrafts(replaceInDrafts(drafts, preview.kept, saved, m)), 'outreach_edit', `Replaced the old offer or link in ${preview.kept.length} email${preview.kept.length === 1 ? '' : 's'} you had edited.`);
    } catch (e) {
      setError(t('outreach.saveError', { message: errorText(e) }));
    }
  };

  return (
    <div data-outreach-part="message" className="space-y-4">
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={quiet} disabled={busy !== null} onClick={() => void write()} data-write-message>
            {busy === 'write' ? t('outreach.writing') : m.body.trim() ? t('outreach.rewriteMessage') : t('outreach.writeMessage')}
          </button>
          <span className="text-label text-[var(--on-surface-variant)]">{t('outreach.writeFromBrief')}</span>
        </div>
      )}
      <label className="block">
        <span className={label}>{t('outreach.hSubject')}</span>
        <input className={field} value={m.subject} maxLength={200} readOnly={readOnly} onChange={(e) => set({ subject: e.target.value })} data-message-subject />
      </label>
      <label className="block">
        <span className={label}>{t('outreach.body')}</span>
        <textarea className={`${field} min-h-[200px]`} value={m.body} maxLength={4000} readOnly={readOnly} onChange={(e) => set({ body: e.target.value })} data-message-body />
        <span className="mt-1 block text-label text-[var(--on-surface-variant)]">{t('outreach.tokensHelp', { tokens: TOKENS.join(' ') })}</span>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          <span className={label}>{t('outreach.offer')}</span>
          <input className={field} value={m.variables.offer} maxLength={300} readOnly={readOnly} onChange={(e) => set({ variables: { ...m.variables, offer: e.target.value } })} data-message-offer />
        </label>
        <label>
          <span className={label}>{t('outreach.link')}</span>
          <input className={field} value={m.variables.link} maxLength={500} inputMode="url" readOnly={readOnly} onChange={(e) => set({ variables: { ...m.variables, link: e.target.value } })} data-message-link />
        </label>
      </div>
      <div className="rounded-xl bg-[var(--surface-container-low)] p-3">
        <label className="flex items-center gap-2 text-body text-[var(--on-surface)]">
          <input type="checkbox" checked={Boolean(m.followup)} disabled={readOnly} onChange={(e) => set({ followup: e.target.checked ? { body: m.followup?.body ?? '', after_business_days: 3 } : null })} data-followup-on />
          {t('outreach.followup')}
        </label>
        {m.followup && (
          <div className="mt-2 space-y-2">
            <textarea className={`${field} min-h-[90px]`} value={m.followup.body} maxLength={2000} readOnly={readOnly} onChange={(e) => set({ followup: { ...m.followup!, body: e.target.value } })} aria-label={t('outreach.followup')} />
            <label className="flex items-center gap-2 text-label text-[var(--on-surface-variant)]">
              {t('outreach.followupAfter')}
              <input type="number" min={1} max={30} className={`${field} w-20`} value={m.followup.after_business_days} readOnly={readOnly} onChange={(e) => set({ followup: { ...m.followup!, after_business_days: Math.max(1, Math.min(30, Number(e.target.value) || 3)) } })} />
            </label>
          </div>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label>
          <span className={label}>{t('outreach.sendAs')}</span>
          <select className={field} disabled={readOnly} value={sender?.id ?? ''} onChange={(e) => set({ sender_id: e.target.value || null, signature_id: null, reply_signature_id: null })} data-message-sender>
            {senders.length === 0 && <option value="">{t('outreach.noSender')}</option>}
            {senders.map((s) => <option key={s.id} value={s.id}>{s.from_address}</option>)}
          </select>
        </label>
        {(['signature_id', 'reply_signature_id'] as const).map((k) => (
          <label key={k}>
            <span className={label}>{t(k === 'signature_id' ? 'outreach.sigFirst' : 'outreach.sigReply')}</span>
            <select className={field} disabled={readOnly} value={m[k] ?? mine.find((s) => s.kind === (k === 'signature_id' ? 'first' : 'reply'))?.id ?? ''} onChange={(e) => set({ [k]: e.target.value || null })}>
              <option value="">{t('outreach.none')}</option>
              {mine.map((s) => <option key={s.id} value={s.id}>{[s.name, s.company].filter(Boolean).join(', ') || t(s.kind === 'first' ? 'outreach.sigFirst' : 'outreach.sigReply')}</option>)}
            </select>
          </label>
        ))}
      </div>
      {senders.length === 0 && <p className="text-label text-[var(--on-surface-variant)]">{t('outreach.setUpInSettings')} <Link href="/projects/settings" className="text-[var(--pm-primary)] hover:underline">{t('outreach.settingsLink')}</Link></p>}
      {left.length > 0 && <p role="status" className="text-label text-[var(--pm-tertiary)]">{t('outreach.placeholdersLeft', { list: left.join(', ') })}</p>}
      {said && <p role="status" className="text-label text-[var(--pm-primary)]">{said}</p>}
      {error && <p role="alert" className="text-label text-[var(--pm-error)]">{error}</p>}
      {!readOnly && preview && (preview.follow > 0 || preview.kept.length > 0) && (
        <div data-change-preview className="space-y-1 rounded-xl bg-[var(--surface-container-low)] p-3 text-label text-[var(--on-surface)]">
          <p className="font-semibold">{t('outreach.change.lead')}</p>
          <p>{t('outreach.change.follow', { count: preview.follow })}</p>
          {preview.approved > 0 && <p className="text-[var(--pm-tertiary)]" data-change-approved>{t('outreach.change.approved', { count: preview.approved })}</p>}
          {preview.kept.length > 0 && (
            <p className="flex flex-wrap items-center gap-2" data-change-kept>
              <span>{t('outreach.change.kept', { count: preview.kept.length })}</span>
              <button type="button" className={quiet} onClick={() => void replaceThere()} data-replace-there>{t('outreach.change.replaceThere')}</button>
            </p>
          )}
        </div>
      )}
      {!readOnly && (
        <button type="button" className={primary} disabled={busy !== null || !dirty || !m.body.trim()} onClick={() => void save()} data-save-message>
          {t('outreach.saveMessage')}
        </button>
      )}
    </div>
  );
}
