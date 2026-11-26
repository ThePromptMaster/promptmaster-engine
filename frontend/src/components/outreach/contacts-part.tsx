'use client';

import { useMemo, useState } from 'react';

import { api } from '@/lib/api/client';
import { useLocale, useT } from '@/lib/i18n/i18n-provider';
import { templateWord } from '@/lib/i18n/templates';
import { looksTabular, parseDelimited } from '@/lib/outreach/csv';
import {
  REASONS,
  contactCounts,
  initialStatus,
  parseContacts,
  parseJson,
  serializeContacts,
  type ContactRow,
  type ContactsDocument,
  type EarlierContact,
  type MappedField,
} from '@/lib/outreach/contacts';
import { applyHistory, domainOf, guessMapping, inboxKind, isWebmail, markDuplicates, nextImportId, rowsFromCompanyList, rowsFromTable } from '@/lib/outreach/import';
import { asEarlierContact, listHistory, listSuppressions, recordContact, suppress } from '@/lib/supabase/outreach-contacts';
import type { OutreachContext } from '@/components/workflow/renderers/types';

const MAPPED: readonly MappedField[] = ['name', 'first_name', 'last_name', 'role', 'company', 'website', 'email', 'linkedin'];
const MAX_PASTE = 400_000;
const quiet = 'rounded-lg bg-[var(--surface-container-high)] px-3 py-1.5 text-label font-medium text-[var(--on-surface)] hover:bg-[var(--surface-container-highest)] disabled:opacity-50';
const primary = 'rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-label font-semibold text-[var(--on-primary)] hover:opacity-90 disabled:opacity-50';
const field = 'w-full rounded-lg bg-[var(--surface-container-lowest)] px-2.5 py-1.5 text-body text-[var(--on-surface)] outline-none focus:ring-2 focus:ring-[var(--pm-primary)]/40';

let idCounter = 0;
const newId = () => `c_${Date.now().toString(36)}${(idCounter++).toString(36)}`;

function errorText(e: unknown): string {
  return e instanceof Error && e.message ? e.message : String((e as { message?: string })?.message ?? e);
}

interface Pending {
  from: string;
  headers: string[];
  rows: string[][];
  mapping: Partial<Record<MappedField, string>>;
  companies: string | null;
}

/**
 * The contacts on an Outreach list (Sean, 26 Nov: "Let me paste a list, upload a CSV from Clay,
 * or start with company names and websites. Keep the original data so I can see what came from
 * the list and what PromptMaster added … Catch duplicate people and addresses and show when I've
 * reached somebody else at the same company. I should be able to record outreach I did outside
 * PromptMaster too").
 */
export function ContactsPart({ context, stageId, readOnly }: { context: OutreachContext; stageId: string; readOnly: boolean }) {
  const t = useT();
  const locale = useLocale();
  const doc = useMemo(() => parseContacts(context.parts.contacts?.content), [context.parts.contacts?.content]);
  const counts = contactCounts(doc.items);
  const [text, setText] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(doc.items.length === 0);
  const userId = context.project.user_id;

  const save = async (next: ContactsDocument, operation: string, summary: string) => {
    await context.save(stageId, serializeContacts(next), operation, summary);
  };

  /** Earlier contact from the person's records and their Gmail's Sent mail, onto the rows. */
  const checked = async (rows: ContactRow[]): Promise<{ rows: ContactRow[]; mailbox: boolean; found: number }> => {
    const [history, suppressed] = await Promise.all([listHistory().catch(() => []), listSuppressions().catch(() => [])]);
    const earlier: EarlierContact[] = history.map(asEarlierContact);
    let mailbox = false;
    const addresses = rows.map((r) => r.email.trim().toLowerCase()).filter((a) => a.includes('@'));
    const domains = [...new Set(rows.map((r) => r.domain).filter(Boolean))];
    if (addresses.length || domains.length) {
      try {
        const sent = await api.outreachSentCheck({ addresses: addresses.slice(0, 50), domains: domains.slice(0, 20) });
        mailbox = sent.checked;
        for (const s of [...sent.sent, ...sent.colleagues]) {
          earlier.push({ address: s.address, on: s.on.slice(0, 10) || undefined, source: 'mailbox', subject: s.subject, thread_url: s.thread_url });
        }
      } catch {
        // The records still count; the mailbox is said to be unchecked.
      }
    }
    const next = applyHistory(rows, earlier, suppressed.map((s) => ({ address: s.address ?? undefined, domain: s.domain ?? undefined })));
    const found = next.filter((r, i) => r.contacted !== rows[i]?.contacted || r.colleague !== rows[i]?.colleague).length;
    return { rows: next, mailbox, found };
  };

  const prepare = (raw: string, from: string) => {
    setError(null);
    setSaid(null);
    const trimmed = raw.slice(0, MAX_PASTE);
    if (!trimmed.trim()) return;
    if (looksTabular(trimmed)) {
      const table = parseDelimited(trimmed);
      setPending({ from, headers: table.headers, rows: table.rows, mapping: guessMapping(table.headers), companies: null });
    } else {
      setPending({ from: from === 'paste' ? 'companies' : from, headers: [], rows: [], mapping: {}, companies: trimmed });
    }
  };

  const importPending = async () => {
    if (!pending) return;
    setBusy('import');
    setError(null);
    try {
      const importId = nextImportId(doc.imports);
      const incoming = pending.companies !== null
        ? rowsFromCompanyList(pending.companies, importId, newId)
        : rowsFromTable({ headers: pending.headers, rows: pending.rows, mapping: pending.mapping, importId, makeId: newId });
      const merged = markDuplicates(doc.items, incoming);
      const fresh = merged.rows.slice(doc.items.length);
      const check = await checked(fresh);
      const items = [...doc.items, ...check.rows.map(initialStatus)];
      const record = { id: importId, at: new Date().toISOString(), from: pending.from, rows: incoming.length, mapping: pending.companies !== null ? {} : pending.mapping };
      await save({ ...doc, items, imports: [...doc.imports, record] }, 'outreach_import', `Imported ${incoming.length} contacts (${pending.from}).`);
      setSaid(t('outreach.imported', { count: incoming.length, duplicates: merged.duplicates, found: check.found }) + (check.mailbox ? '' : ` ${t('outreach.mailboxUnchecked')}`));
      setPending(null);
      setText('');
      setAdding(false);
    } catch (e) {
      setError(t('outreach.saveError', { message: errorText(e) }));
    } finally {
      setBusy(null);
    }
  };

  const recheck = async () => {
    setBusy('check');
    setError(null);
    try {
      const check = await checked(doc.items.map((r) => ({ ...r, contacted: '', colleague: '' })));
      await save({ ...doc, items: check.rows.map((r, i) => (doc.items[i]?.status === 'skip' && !r.status ? doc.items[i] : r)) }, 'outreach_check', 'Checked for earlier contact.');
      setSaid(check.mailbox ? t('outreach.checkedMailbox', { count: check.found }) : t('outreach.checkedRecords', { count: check.found }));
    } catch (e) {
      setError(t('outreach.saveError', { message: errorText(e) }));
    } finally {
      setBusy(null);
    }
  };

  const updateRow = async (id: string, patch: Partial<ContactRow>, summary: string) => {
    const items = doc.items.map((r) => (r.id === id ? { ...r, ...patch } : r));
    await save({ ...doc, items }, 'outreach_edit', summary);
  };

  const act = (key: string, run: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    run().catch((e) => setError(t('outreach.saveError', { message: errorText(e) }))).finally(() => setBusy(null));
  };

  return (
    <div data-outreach-part="contacts" className="space-y-4">
      {doc.items.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-label" data-contact-counts>
          <span className="rounded-md bg-[color-mix(in_srgb,var(--pm-primary)_14%,transparent)] px-2 py-1 font-semibold text-[var(--on-surface)]">{t('outreach.countReady', { count: counts.ready })}</span>
          <span className="rounded-md bg-[color-mix(in_srgb,var(--pm-tertiary)_14%,transparent)] px-2 py-1 text-[var(--on-surface)]">{t('outreach.countDecide', { count: counts.decide })}</span>
          <span className="rounded-md bg-[var(--surface-container-high)] px-2 py-1 text-[var(--on-surface-variant)]">{t('outreach.countOpen', { count: counts.open })}</span>
          <span className="rounded-md bg-[var(--surface-container-high)] px-2 py-1 text-[var(--on-surface-variant)]">{t('outreach.countSkip', { count: counts.skip })}</span>
          {!readOnly && (
            <span className="ms-auto flex gap-2">
              <button type="button" className={quiet} disabled={busy !== null} onClick={() => void recheck()} data-recheck>
                {busy === 'check' ? t('outreach.checking') : t('outreach.recheck')}
              </button>
              <button type="button" className={quiet} onClick={() => setAdding((a) => !a)} aria-expanded={adding}>{t('outreach.addMore')}</button>
            </span>
          )}
        </div>
      )}
      {said && <p role="status" className="rounded-lg bg-[var(--surface-container-low)] px-3 py-2 text-label text-[var(--on-surface)]">{said}</p>}
      {error && <p role="alert" className="text-label text-[var(--pm-error)]">{error}</p>}

      {!readOnly && adding && !pending && (
        <div data-import className="space-y-2 rounded-xl bg-[var(--surface-container-low)] p-4">
          <p className="text-body text-[var(--on-surface)]">{t('outreach.importLead')}</p>
          <textarea
            className={`${field} min-h-[140px] font-mono text-label`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('outreach.importPlaceholder')}
            aria-label={t('outreach.importBox')}
            data-import-text
          />
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={primary} disabled={!text.trim()} onClick={() => prepare(text, 'paste')} data-import-paste>{t('outreach.importNext')}</button>
            <label className={`${quiet} cursor-pointer`}>
              <input
                type="file"
                accept=".csv,.tsv,.txt,.xlsx,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="sr-only"
                data-import-file
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  const read = /\.xlsx$/i.test(file.name)
                    ? import('@/lib/data/spreadsheet').then(({ spreadsheetToCsvFiles }) => spreadsheetToCsvFiles(file)).then((files) => (files[0] ? files[0].text() : ''))
                    : file.text();
                  read.then((raw) => prepare(raw, `file: ${file.name}`)).catch((err) => setError(t('outreach.saveError', { message: errorText(err) })));
                }}
              />
              {t('outreach.importFile')}
            </label>
          </div>
        </div>
      )}

      {pending && (
        <div data-import-mapping className="space-y-3 rounded-xl bg-[var(--surface-container-low)] p-4">
          {pending.companies !== null ? (
            <p className="text-body text-[var(--on-surface)]">{t('outreach.importCompanies', { count: pending.companies.split('\n').filter((l) => l.trim()).length })}</p>
          ) : (
            <>
              <p className="text-body text-[var(--on-surface)]">{t('outreach.importColumns', { count: pending.rows.length })}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {MAPPED.map((f) => (
                  <label key={f} className="flex items-center gap-2 text-label">
                    <span className="w-32 shrink-0 text-[var(--on-surface-variant)]">{t(`outreach.field.${f}`)}</span>
                    <select
                      className={field}
                      value={pending.mapping[f] ?? ''}
                      data-map-field={f}
                      onChange={(e) => setPending({ ...pending, mapping: { ...pending.mapping, [f]: e.target.value || undefined } })}
                    >
                      <option value="">{t('outreach.notInList')}</option>
                      {pending.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            </>
          )}
          <div className="flex gap-2">
            <button type="button" className={primary} disabled={busy !== null} onClick={() => void importPending()} data-import-confirm>
              {busy === 'import' ? t('outreach.importing') : t('outreach.importConfirm')}
            </button>
            <button type="button" className={quiet} onClick={() => setPending(null)}>{t('outreach.cancel')}</button>
          </div>
        </div>
      )}

      {doc.items.length > 0 && (
        <ul data-contacts className="space-y-1.5">
          {doc.items.map((r) => (
            <ContactLine
              key={r.id}
              row={r}
              open={open === r.id}
              onToggle={() => setOpen(open === r.id ? null : r.id)}
              readOnly={readOnly}
              busy={busy}
              reason={r.reason ? templateWord(locale, r.reason) : ''}
              onReady={() => act(`ready:${r.id}`, () => updateRow(r.id, { status: 'ready', reason: '' }, `Marked ${r.name || r.company} ready.`))}
              onSkip={(why) => act(`skip:${r.id}`, () => updateRow(r.id, { status: 'skip', reason: why }, `Skipped ${r.name || r.company}.`))}
              onEdit={(patch) => act(`edit:${r.id}`, () => updateRow(r.id, withEdit(r, patch), `Edited ${r.name || r.company}.`))}
              onContactedBefore={(on) =>
                act(`hist:${r.id}`, async () => {
                  await recordContact(userId, { address: r.email, person_name: r.name, company: r.company, occurred_on: on || null, source: 'manual', project_id: context.project.id });
                  await updateRow(r.id, { contacted: JSON.stringify({ address: r.email.toLowerCase(), on: on || undefined, source: 'manual' } satisfies EarlierContact), status: 'decide', reason: `Contacted before: ${on || 'date unknown'}.` }, `Recorded earlier contact with ${r.name || r.email}.`);
                })
              }
              onSuppress={() =>
                act(`supp:${r.id}`, async () => {
                  await suppress(userId, { address: r.email });
                  await updateRow(r.id, { status: 'skip', reason: REASONS.suppressed }, `Added ${r.email} to the do-not-contact list.`);
                })
              }
            />
          ))}
        </ul>
      )}
      {doc.items.length === 0 && readOnly && <p className="text-body text-[var(--on-surface-variant)]">{t('outreach.noContacts')}</p>}
    </div>
  );
}

/** A user's change to a row: the fields they set are theirs, marked so a later fill never replaces them. */
function withEdit(row: ContactRow, patch: Partial<Pick<ContactRow, 'name' | 'role' | 'email' | 'company'>>): Partial<ContactRow> {
  const next: Partial<ContactRow> = { ...patch };
  if (patch.email !== undefined && patch.email !== row.email) {
    next.email_kind = inboxKind(patch.email);
    next.email_status = patch.email.trim() ? 'given' : '';
    next.src_email = patch.email.trim() ? 'you' : '';
    // A personal address (gmail.com) is not the company's domain.
    if (!row.domain && !isWebmail(domainOf(patch.email))) next.domain = domainOf(patch.email);
  }
  if (patch.role !== undefined && patch.role !== row.role) next.src_role = patch.role.trim() ? 'you' : '';
  // A skipped row stays skipped, and one contacted before still waits on the user; the rest is worked out again.
  const kept = row.status === 'skip' || row.contacted ? { status: row.status, reason: row.reason } : { status: '' as const, reason: '' };
  return initialStatus({ ...row, ...next, ...kept }) as Partial<ContactRow>;
}

function ContactLine({ row, open, onToggle, readOnly, busy, reason, onReady, onSkip, onEdit, onContactedBefore, onSuppress }: {
  row: ContactRow;
  open: boolean;
  onToggle: () => void;
  readOnly: boolean;
  busy: string | null;
  reason: string;
  onReady: () => void;
  onSkip: (why: string) => void;
  onEdit: (patch: Partial<Pick<ContactRow, 'name' | 'role' | 'email' | 'company'>>) => void;
  onContactedBefore: (on: string) => void;
  onSuppress: () => void;
}) {
  const t = useT();
  const given = parseJson<Record<string, string>>(row.given) ?? {};
  const contacted = parseJson<EarlierContact>(row.contacted);
  const colleague = parseJson<EarlierContact>(row.colleague);
  const added = new Set(row.added.split(',').filter(Boolean));
  const [form, setForm] = useState({ name: row.name, role: row.role, email: row.email, company: row.company });
  const [skipWhy, setSkipWhy] = useState('');
  const [before, setBefore] = useState('');
  const tone = row.status === 'ready' ? 'var(--pm-primary)' : row.status === 'decide' ? 'var(--pm-tertiary)' : row.status === 'skip' ? 'var(--outline)' : 'var(--on-surface-variant)';
  const statusWord = row.status === 'ready' ? t('outreach.statusReady') : row.status === 'decide' ? t('outreach.statusDecide') : row.status === 'skip' ? t('outreach.statusSkip') : t('outreach.statusOpen');
  return (
    <li data-contact={row.id} data-status={row.status || 'open'} className="rounded-xl bg-[var(--surface-container-low)]">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-start gap-3 px-3 py-2.5 text-start">
        <span aria-hidden className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: tone }} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body font-medium text-[var(--on-surface)]">
            {row.company || row.domain || t('outreach.noCompany')}
            {row.name && <span className="font-normal text-[var(--on-surface-variant)]"> · {row.name}{row.role ? `, ${row.role}` : ''}</span>}
          </span>
          <span className="block truncate text-label text-[var(--on-surface-variant)]">
            {row.email || t('outreach.noAddress')}
            {row.email_kind === 'general' && <span className="ms-2 rounded bg-[var(--surface-container-high)] px-1.5">{t('outreach.generalInbox')}</span>}
            {row.email_status === 'guess' && <span className="ms-2 rounded bg-[var(--surface-container-high)] px-1.5">{t('outreach.guessed')}</span>}
            {contacted && <span className="ms-2 rounded bg-[color-mix(in_srgb,var(--pm-tertiary)_14%,transparent)] px-1.5 text-[var(--on-surface)]">{t('outreach.contactedOn', { on: contacted.on || t('outreach.dateUnknown') })}</span>}
            {!contacted && colleague && <span className="ms-2 rounded bg-[var(--surface-container-high)] px-1.5">{t('outreach.colleagueContacted', { address: colleague.address })}</span>}
          </span>
          {reason && <span className="block text-label text-[var(--on-surface-variant)]">{reason}</span>}
        </span>
        <span className="shrink-0 text-label font-semibold" style={{ color: tone }}>{statusWord}</span>
      </button>
      {open && (
        <div data-contact-detail className="space-y-3 px-3 pb-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-[var(--surface-container-lowest)] p-2.5">
              <p className="mb-1 text-label font-semibold uppercase tracking-wider text-[var(--on-surface-variant)]">{t('outreach.fromList')}</p>
              {Object.keys(given).length ? (
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 text-label">
                  {Object.entries(given).filter(([, v]) => v).map(([k, v]) => (
                    <div key={k} className="contents"><dt className="text-[var(--on-surface-variant)]">{k}</dt><dd className="break-words text-[var(--on-surface)]">{v}</dd></div>
                  ))}
                </dl>
              ) : <p className="text-label text-[var(--on-surface-variant)]">{t('outreach.addedByHand')}</p>}
            </div>
            <div className="rounded-lg bg-[var(--surface-container-lowest)] p-2.5">
              <p className="mb-1 text-label font-semibold uppercase tracking-wider text-[var(--on-surface-variant)]">{t('outreach.addedByPm')}</p>
              {added.size || row.detail ? (
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 text-label">
                  {[...added].map((k) => (
                    <div key={k} className="contents"><dt className="text-[var(--on-surface-variant)]">{k}</dt><dd className="break-words text-[var(--on-surface)]">{String(row[k] ?? '')} {sourceChip(row, k)}</dd></div>
                  ))}
                  {row.detail && <div className="contents"><dt className="text-[var(--on-surface-variant)]">{t('outreach.detail')}</dt><dd className="break-words text-[var(--on-surface)]">{row.detail} {row.src_detail && <span className="text-[var(--pm-primary)]">[{row.src_detail}]</span>}</dd></div>}
                </dl>
              ) : <p className="text-label text-[var(--on-surface-variant)]">{t('outreach.nothingAdded')}</p>}
            </div>
          </div>
          {contacted?.thread_url && <a href={contacted.thread_url} target="_blank" rel="noreferrer" className="text-label text-[var(--pm-primary)] hover:underline">{t('outreach.openThread')}</a>}
          {!readOnly && (
            <>
              <form
                className="grid gap-2 sm:grid-cols-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  onEdit(form);
                }}
              >
                {(['company', 'name', 'role', 'email'] as const).map((k) => (
                  <label key={k} className="text-label">
                    <span className="block text-[var(--on-surface-variant)]">{t(`outreach.field.${k}`)}</span>
                    <input className={field} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} data-contact-field={k} />
                  </label>
                ))}
                <div className="sm:col-span-4">
                  <button type="submit" className={quiet} disabled={busy !== null} data-contact-save>{t('outreach.saveContact')}</button>
                </div>
              </form>
              <div className="flex flex-wrap items-center gap-2">
                {row.status !== 'ready' && row.email.trim() && (
                  <button type="button" className={quiet} disabled={busy !== null} onClick={onReady} data-contact-ready>{t('outreach.markReady')}</button>
                )}
                <input className={`${field} max-w-[220px]`} placeholder={t('outreach.skipWhy')} aria-label={t('outreach.skipWhy')} value={skipWhy} onChange={(e) => setSkipWhy(e.target.value)} />
                <button type="button" className={quiet} disabled={busy !== null || !skipWhy.trim()} onClick={() => onSkip(skipWhy.trim())} data-contact-skip>{t('outreach.skip')}</button>
              </div>
              {row.email.trim() && (
                <div className="flex flex-wrap items-center gap-2">
                  <input type="date" className={`${field} max-w-[170px]`} aria-label={t('outreach.contactedWhen')} value={before} onChange={(e) => setBefore(e.target.value)} />
                  <button type="button" className={quiet} disabled={busy !== null} onClick={() => onContactedBefore(before)} data-contacted-before>{t('outreach.contactedBefore')}</button>
                  <button type="button" className={quiet} disabled={busy !== null} onClick={onSuppress} data-suppress>{t('outreach.doNotContact')}</button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </li>
  );
}

function sourceChip(row: ContactRow, field: string) {
  const src = field === 'email' ? row.src_email : field === 'role' ? row.src_role : '';
  return src && src !== 'import' ? <span className="text-[var(--pm-primary)]">[{src}]</span> : null;
}

