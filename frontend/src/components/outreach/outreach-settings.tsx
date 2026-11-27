'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useAuth } from '@/hooks/use-auth';
import { api } from '@/lib/api/client';
import { useT } from '@/lib/i18n/i18n-provider';
import { renderEmail } from '@/lib/outreach/render';
import {
  DEFAULT_OPT_OUT,
  createSender,
  imageSize,
  listLogos,
  listSenders,
  listSignatures,
  loadOutreachSettings,
  logoProblem,
  saveOutreachSettings,
  saveSignature,
  updateSender,
  uploadLogo,
  type SenderFields,
  type SignatureFields,
} from '@/lib/supabase/outreach-identity';
import type { OutreachLogo, OutreachMailbox, OutreachSender, OutreachSettings as Settings, OutreachSignature, SignatureKind } from '@/types/outreach';
import { EmailPreview } from './email-preview';

const field = 'w-full rounded-lg bg-[var(--surface-container-lowest)] px-3 py-2 text-body text-[var(--on-surface)] outline-none focus:ring-2 focus:ring-[var(--pm-primary)]/40';
const label = 'block text-label font-medium text-[var(--on-surface-variant)]';
const primary = 'rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-label font-semibold text-[var(--on-primary)] hover:opacity-90 disabled:opacity-50';
const quiet = 'rounded-lg bg-[var(--surface-container-high)] px-3 py-1.5 text-label font-medium text-[var(--on-surface)] hover:bg-[var(--surface-container-highest)] disabled:opacity-50';

interface Loaded {
  senders: OutreachSender[];
  signatures: OutreachSignature[];
  logos: OutreachLogo[];
  settings: Settings;
}

async function loadAll(userId: string): Promise<Loaded> {
  const [senders, signatures, logos, settings] = await Promise.all([listSenders(), listSignatures(), listLogos(), loadOutreachSettings(userId)]);
  return { senders, signatures, logos, settings };
}

function errorText(e: unknown): string {
  return e instanceof Error && e.message ? e.message : String((e as { message?: string })?.message ?? e);
}

/**
 * Who outreach email goes out as (Sean, 26 Nov: "Save reusable signatures by sender or brand. I
 * want to be able to add my name, title, company, website, and optional links, with the company
 * logo underneath the signature. Let me upload the logo, size it, and preview it on desktop and
 * mobile … Let me use one signature for a first email and a shorter one for replies").
 *
 * One sender per connected mailbox, its first-email and reply signatures, and the sending limits.
 * Nothing is sent from here.
 */
export function OutreachSettings() {
  const t = useT();
  const { user } = useAuth();
  const [mailboxes, setMailboxes] = useState<OutreachMailbox[] | null>(null);
  const [mailboxFailed, setMailboxFailed] = useState(false);
  const [senders, setSenders] = useState<OutreachSender[]>([]);
  const [signatures, setSignatures] = useState<OutreachSignature[]>([]);
  const [logos, setLogos] = useState<OutreachLogo[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);

  const apply = useCallback((all: Loaded) => {
    setSenders(all.senders);
    setSignatures(all.signatures);
    setLogos(all.logos);
    setSettings(all.settings);
  }, []);
  const reload = useCallback(async () => {
    if (user) apply(await loadAll(user.id));
  }, [user, apply]);

  useEffect(() => {
    if (!user || user.is_anonymous) return;
    let live = true;
    api
      .outreachMailbox()
      .then((r) => live && setMailboxes(r.mailboxes))
      .catch(() => live && (setMailboxes([]), setMailboxFailed(true)));
    loadAll(user.id)
      .then((all) => live && apply(all))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [user, apply]);

  if (!user || user.is_anonymous) return null;
  return (
    <section data-outreach-settings aria-labelledby="outreach-title" className="mt-10">
      <h2 id="outreach-title" className="text-headline text-[var(--on-surface)]">{t('outreach.title')}</h2>
      <p className="mt-2 text-body text-[var(--on-surface-variant)]">{t('outreach.lead')}</p>
      <div className="mt-4 space-y-4">
        {mailboxes === null && <p className="text-label text-[var(--on-surface-variant)]">{t('outreach.mailboxLoading')}</p>}
        {mailboxFailed && <p role="alert" className="text-label text-[var(--pm-error)]">{t('outreach.mailboxError')}</p>}
        {mailboxes !== null && !mailboxFailed && mailboxes.length === 0 && (
          <p data-no-mailbox className="rounded-xl bg-[var(--surface-container-low)] px-4 py-3 text-body text-[var(--on-surface-variant)]">{t('outreach.mailboxNone')}</p>
        )}
        {(mailboxes ?? []).map((m) => (
          <MailboxCard
            key={m.toolkit}
            mailbox={m}
            userId={user.id}
            sender={senders.find((s) => s.toolkit === m.toolkit && s.from_address === m.address) ?? null}
            signatures={signatures}
            logos={logos}
            onChanged={reload}
          />
        ))}
        {settings && <LimitsCard settings={settings} onSaved={setSettings} />}
      </div>
    </section>
  );
}

function MailboxCard({ mailbox, userId, sender, signatures, logos, onChanged }: {
  mailbox: OutreachMailbox;
  userId: string;
  sender: OutreachSender | null;
  signatures: OutreachSignature[];
  logos: OutreachLogo[];
  onChanged: () => Promise<void>;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!mailbox.address) {
    return <p className="rounded-xl bg-[var(--surface-container-low)] px-4 py-3 text-body text-[var(--on-surface-variant)]">{t('outreach.mailboxNoAddress', { label: mailbox.label })}</p>;
  }
  return (
    <div data-mailbox={mailbox.toolkit} className="rounded-xl bg-[var(--surface-container-low)] p-4">
      <p className="flex items-center gap-2 text-body font-semibold text-[var(--on-surface)]">
        <span aria-hidden className="material-symbols-outlined text-[20px] text-[var(--pm-primary)]">mail</span>
        {t('outreach.mailboxFrom', { label: mailbox.label, address: mailbox.address })}
      </p>
      {!sender ? (
        <div className="mt-3">
          <button
            type="button"
            data-set-up-sender
            disabled={busy}
            className={primary}
            onClick={() => {
              setBusy(true);
              setError(null);
              createSender(userId, mailbox.toolkit, mailbox.address, { from_name: '', reply_to: null, postal_address: '', opt_out_line: DEFAULT_OPT_OUT, commercial: true })
                .then(onChanged)
                .catch((e) => setError(t('outreach.saveError', { message: errorText(e) })))
                .finally(() => setBusy(false));
            }}
          >
            {t('outreach.setUp', { address: mailbox.address })}
          </button>
          {error && <p role="alert" className="mt-2 text-label text-[var(--pm-error)]">{error}</p>}
        </div>
      ) : (
        <SenderEditor userId={userId} sender={sender} signatures={signatures.filter((s) => s.sender_id === sender.id)} logos={logos} onChanged={onChanged} />
      )}
    </div>
  );
}

function SenderEditor({ userId, sender, signatures, logos, onChanged }: {
  userId: string;
  sender: OutreachSender;
  signatures: OutreachSignature[];
  logos: OutreachLogo[];
  onChanged: () => Promise<void>;
}) {
  const t = useT();
  const [form, setForm] = useState<SenderFields>({
    from_name: sender.from_name,
    reply_to: sender.reply_to,
    postal_address: sender.postal_address,
    opt_out_line: sender.opt_out_line,
    commercial: sender.commercial,
  });
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<SignatureKind>('first');
  // What the signature editors hold now, unsaved included, so the preview follows typing.
  const [drafts, setDrafts] = useState<Partial<Record<SignatureKind, SignatureFields>>>({});
  const set = <K extends keyof SenderFields>(k: K, v: SenderFields[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setState('idle');
  };
  const sample = t('outreach.previewSample');
  const subject = t('outreach.sampleSubject');
  const sigFor = (kind: SignatureKind) => drafts[kind] ?? signatures.find((s) => s.kind === kind) ?? null;
  const shownSig = sigFor(shown);
  const logo = shownSig?.logo_id ? logos.find((l) => l.id === shownSig.logo_id) ?? null : null;
  const render = useCallback(
    (imagesOff: boolean) =>
      renderEmail({
        sender: { ...form, from_address: sender.from_address },
        signature: shownSig,
        logo: logo ? { url: logo.url, width: logo.width, height: logo.height } : null,
        subject,
        body: sample,
        imagesOff,
      }),
    [form, sender.from_address, shownSig, logo, subject, sample]
  );
  const warnings = render(false).warnings;
  // Gmail sends under the Google account's own name: Composio's draft tool takes no display name (27 Nov).
  const from = sender.from_address;

  return (
    <div className="mt-4 space-y-5">
      <form
        data-sender-form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          setState('saving');
          setError(null);
          updateSender(sender.id, form)
            .then(async () => {
              setState('saved');
              await onChanged();
            })
            .catch((err) => {
              setState('idle');
              setError(t('outreach.saveError', { message: errorText(err) }));
            });
        }}
      >
        <p className="text-label text-[var(--on-surface-variant)] sm:col-span-2" data-from-name-note>
          {t('outreach.fromNameGmail')}
        </p>
        <label className="sm:col-span-1">
          <span className={label}>{t('outreach.replyTo')}</span>
          <input className={field} type="email" value={form.reply_to ?? ''} maxLength={320} onChange={(e) => set('reply_to', e.target.value || null)} />
        </label>
        <label className="flex items-start gap-2 sm:col-span-2">
          <input type="checkbox" className="mt-1" checked={form.commercial} onChange={(e) => set('commercial', e.target.checked)} />
          <span>
            <span className="block text-body text-[var(--on-surface)]">{t('outreach.commercial')}</span>
            <span className="block text-label text-[var(--on-surface-variant)]">{t('outreach.commercialHint')}</span>
          </span>
        </label>
        <label className="sm:col-span-2">
          <span className={label}>{t('outreach.postal')}</span>
          <textarea className={field} rows={2} value={form.postal_address} maxLength={500} onChange={(e) => set('postal_address', e.target.value)} data-postal />
        </label>
        <label className="sm:col-span-2">
          <span className={label}>{t('outreach.optOut')}</span>
          <input className={field} value={form.opt_out_line} maxLength={300} onChange={(e) => set('opt_out_line', e.target.value)} />
        </label>
        <div className="flex items-center gap-3 sm:col-span-2">
          <button type="submit" className={primary} disabled={state === 'saving'} data-save-sender>{t('outreach.saveSender')}</button>
          {state === 'saved' && <span role="status" className="text-label text-[var(--pm-primary)]">{t('outreach.saved')}</span>}
          {error && <span role="alert" className="text-label text-[var(--pm-error)]">{error}</span>}
        </div>
      </form>

      <div>
        <h3 className="text-title text-[var(--on-surface)]">{t('outreach.signatures')}</h3>
        <div role="tablist" className="mt-2 flex gap-1">
          {(['first', 'reply'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={shown === k}
              data-signature-tab={k}
              onClick={() => setShown(k)}
              className={`rounded-lg px-3 py-1.5 text-label ${shown === k ? 'bg-[var(--surface-container-highest)] font-semibold text-[var(--on-surface)]' : 'text-[var(--on-surface-variant)] hover:bg-[var(--surface-container)]'}`}
            >
              {t(k === 'first' ? 'outreach.sigFirst' : 'outreach.sigReply')}
            </button>
          ))}
        </div>
        <SignatureEditor
          key={`${sender.id}:${shown}`}
          userId={userId}
          senderId={sender.id}
          kind={shown}
          saved={signatures.find((s) => s.kind === shown) ?? null}
          logos={logos}
          onDraft={(d) => setDrafts((all) => ({ ...all, [shown]: d }))}
          onChanged={onChanged}
        />
      </div>

      {warnings.map((w) => (
        <p key={w.kind} role="status" data-render-warning={w.kind} className="rounded-lg bg-[color-mix(in_srgb,var(--pm-tertiary)_12%,transparent)] px-3 py-2 text-label text-[var(--on-surface)]">
          {w.kind === 'signature_in_body' ? t('outreach.warnSignatureTwice', { found: w.found }) : t('outreach.warnCompliance')}
        </p>
      ))}
      <EmailPreview
        render={render}
        headers={{
          from,
          replyTo: form.reply_to,
          to: ['alex@example.com'],
          signature: shownSig ? [shownSig.name, shownSig.company].filter(Boolean).join(', ') || t(shown === 'first' ? 'outreach.sigFirst' : 'outreach.sigReply') : null,
        }}
      />
    </div>
  );
}

const BLANK_LINK = { label: '', url: '' };

function SignatureEditor({ userId, senderId, kind, saved, logos, onDraft, onChanged }: {
  userId: string;
  senderId: string;
  kind: SignatureKind;
  saved: OutreachSignature | null;
  logos: OutreachLogo[];
  onDraft: (d: SignatureFields) => void;
  onChanged: () => Promise<void>;
}) {
  const t = useT();
  const [f, setF] = useState<SignatureFields>(() => ({
    kind,
    label: saved?.label ?? '',
    name: saved?.name ?? '',
    title: saved?.title ?? '',
    company: saved?.company ?? '',
    website: saved?.website ?? '',
    links: saved?.links?.length ? saved.links : [],
    logo_id: saved?.logo_id ?? null,
    logo_width: saved?.logo_width ?? 120,
  }));
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'uploading'>('idle');
  const [error, setError] = useState<string | null>(null);
  const update = (next: SignatureFields) => {
    setF(next);
    onDraft(next);
    setState('idle');
  };
  const logo = useMemo(() => (f.logo_id ? logos.find((l) => l.id === f.logo_id) ?? null : null), [f.logo_id, logos]);

  return (
    <form
      data-signature-form={kind}
      className="mt-3 grid gap-3 rounded-xl bg-[var(--surface-container)] p-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        setState('saving');
        setError(null);
        saveSignature(userId, senderId, f, saved?.id)
          .then(async () => {
            setState('saved');
            await onChanged();
          })
          .catch((err) => {
            setState('idle');
            setError(t('outreach.saveError', { message: errorText(err) }));
          });
      }}
    >
      {(['name', 'title', 'company', 'website'] as const).map((k) => (
        <label key={k}>
          <span className={label}>{t(k === 'name' ? 'outreach.sigName' : k === 'title' ? 'outreach.sigTitle' : k === 'company' ? 'outreach.sigCompany' : 'outreach.sigWebsite')}</span>
          <input
            className={field}
            value={f[k]}
            maxLength={k === 'website' ? 300 : 120}
            inputMode={k === 'website' ? 'url' : undefined}
            onChange={(e) => update({ ...f, [k]: e.target.value })}
            data-sig-field={k}
          />
        </label>
      ))}
      <fieldset className="sm:col-span-2">
        <legend className={label}>{t('outreach.sigLinks')}</legend>
        <div className="mt-1 space-y-2">
          {f.links.map((l, i) => (
            <div key={i} className="flex gap-2">
              <input className={`${field} max-w-[160px]`} aria-label={t('outreach.sigLinkLabel')} placeholder={t('outreach.sigLinkLabel')} value={l.label} maxLength={60} onChange={(e) => update({ ...f, links: f.links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
              <input className={field} aria-label={t('outreach.sigLinkUrl')} placeholder={t('outreach.sigLinkUrl')} value={l.url} maxLength={300} inputMode="url" onChange={(e) => update({ ...f, links: f.links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} />
              <button type="button" aria-label={t('outreach.sigRemoveLink')} title={t('outreach.sigRemoveLink')} className="rounded-lg p-2 text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)]" onClick={() => update({ ...f, links: f.links.filter((_, j) => j !== i) })}>
                <span aria-hidden className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>
          ))}
          {f.links.length < 4 && (
            <button type="button" className={quiet} onClick={() => update({ ...f, links: [...f.links, { ...BLANK_LINK }] })}>
              {t('outreach.sigAddLink')}
            </button>
          )}
        </div>
      </fieldset>
      <div className="sm:col-span-2">
        <span className={label}>{t('outreach.logo')}</span>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          {logo && <img src={logo.url} alt="" width={Math.min(f.logo_width, 160)} className="h-auto rounded bg-white p-1" data-logo-thumb />}
          <label className={`${quiet} cursor-pointer`}>
            <input
              type="file"
              accept="image/png,image/jpeg,image/gif"
              className="sr-only"
              data-logo-input
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                const problem = logoProblem(file);
                if (problem) {
                  setError(t(problem === 'type' ? 'outreach.logoType' : 'outreach.logoSize'));
                  return;
                }
                setState('uploading');
                setError(null);
                imageSize(file)
                  .then((size) => uploadLogo(userId, file, size))
                  .then(async (made) => {
                    await onChanged();
                    update({ ...f, logo_id: made.id });
                  })
                  .catch((err) => {
                    setState('idle');
                    setError(t('outreach.saveError', { message: errorText(err) }));
                  });
              }}
            />
            {t('outreach.logoUpload')}
          </label>
          {f.logo_id && (
            <button type="button" className={quiet} onClick={() => update({ ...f, logo_id: null })}>
              {t('outreach.logoRemove')}
            </button>
          )}
        </div>
        {f.logo_id && (
          <label className="mt-2 flex items-center gap-3">
            <input type="range" min={40} max={300} step={5} value={f.logo_width} onChange={(e) => update({ ...f, logo_width: Number(e.target.value) })} data-logo-width className="w-48" />
            <span className="text-label tabular-nums text-[var(--on-surface-variant)]">{t('outreach.logoWidth', { width: f.logo_width })}</span>
          </label>
        )}
        <p className="mt-1 text-label text-[var(--on-surface-variant)]">{t('outreach.logoHint')}</p>
      </div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button type="submit" className={primary} disabled={state === 'saving' || state === 'uploading'} data-save-signature>{t('outreach.saveSignature')}</button>
        {state === 'saved' && <span role="status" className="text-label text-[var(--pm-primary)]">{t('outreach.saved')}</span>}
        {error && <span role="alert" className="text-label text-[var(--pm-error)]">{error}</span>}
      </div>
    </form>
  );
}

function LimitsCard({ settings, onSaved }: { settings: Settings; onSaved: (s: Settings) => void }) {
  const t = useT();
  const [s, setS] = useState(settings);
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      data-outreach-limits
      className="grid gap-3 rounded-xl bg-[var(--surface-container-low)] p-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        const next = { ...s, daily_cap: Math.max(1, Math.min(400, Math.round(s.daily_cap))), spacing_seconds: Math.max(30, Math.min(3600, Math.round(s.spacing_seconds))) };
        setS(next);
        setState('saving');
        setError(null);
        saveOutreachSettings(next)
          .then(() => {
            setState('saved');
            onSaved(next);
          })
          .catch((err) => {
            setState('idle');
            setError(t('outreach.saveError', { message: errorText(err) }));
          });
      }}
    >
      <h3 className="text-title text-[var(--on-surface)] sm:col-span-2">{t('outreach.limits')}</h3>
      <label>
        <span className={label}>{t('outreach.dailyCap')}</span>
        <input className={field} type="number" min={1} max={400} value={s.daily_cap} onChange={(e) => (setS({ ...s, daily_cap: Number(e.target.value) }), setState('idle'))} data-daily-cap />
      </label>
      <label>
        <span className={label}>{t('outreach.spacing')}</span>
        <input className={field} type="number" min={30} max={3600} value={s.spacing_seconds} onChange={(e) => (setS({ ...s, spacing_seconds: Number(e.target.value) }), setState('idle'))} />
      </label>
      <label className="flex items-start gap-2 sm:col-span-2">
        <input type="checkbox" className="mt-1" checked={s.paused} onChange={(e) => (setS({ ...s, paused: e.target.checked }), setState('idle'))} data-pause-all />
        <span>
          <span className="block text-body text-[var(--on-surface)]">{t('outreach.pauseAll')}</span>
          <span className="block text-label text-[var(--on-surface-variant)]">{t('outreach.pausedNote')}</span>
        </span>
      </label>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button type="submit" className={primary} disabled={state === 'saving'}>{t('outreach.saveLimits')}</button>
        {state === 'saved' && <span role="status" className="text-label text-[var(--pm-primary)]">{t('outreach.saved')}</span>}
        {error && <span role="alert" className="text-label text-[var(--pm-error)]">{error}</span>}
      </div>
    </form>
  );
}
