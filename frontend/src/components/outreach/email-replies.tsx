'use client';

import { useState } from 'react';

import { api } from '@/lib/api/client';
import { useT } from '@/lib/i18n/i18n-provider';
import { blankContact, initialStatus, parseContacts, serializeContacts, type ContactRow } from '@/lib/outreach/contacts';
import { firstName, parseDrafts, parseMessage, serializeDrafts, syncDrafts } from '@/lib/outreach/drafts';
import { inboxKind } from '@/lib/outreach/import';
import type { InboundRecord } from '@/lib/supabase/outreach-sends';
import type { OutreachContext } from '@/components/workflow/renderers/types';

const quiet = 'rounded-lg bg-[var(--surface-container-high)] px-3 py-1.5 text-label font-medium text-[var(--on-surface)] hover:bg-[var(--surface-container-highest)] disabled:opacity-50';
let n = 0;
const newId = (p: string) => `${p}_${Date.now().toString(36)}${(n++).toString(36)}`;

interface Person {
  name: string;
  role: string;
  email: string;
  quote: string;
}

/**
 * What came back for one email (Sean, 26 Nov): a reply, an automatic reply, a bounce or an opt-out,
 * read by the job runner. A reply that names someone else offers them as the next contact: added
 * with the reply as the source, and a note drafted for them, not approved.
 */
export function EmailReplies({ records, contact, context, readOnly }: { records: readonly InboundRecord[]; contact: ContactRow | undefined; context: OutreachContext; readOnly: boolean }) {
  const t = useT();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  if (!records.length) return null;
  const when = (r: InboundRecord) => (r.received_at ? new Date(r.received_at).toLocaleDateString() : '');
  const reply = records.find((r) => r.kind === 'reply');

  const ask = async () => {
    if (!reply) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.outreachReplySuggestion({ reply: reply.text, contact: contact?.name ?? '', company: contact?.company ?? '' });
      setPeople(res.people);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const add = async (p: Person) => {
    const contacts = context.parts.contacts;
    const drafts = context.parts.drafts;
    if (!contacts || !drafts) return;
    setBusy(true);
    setError(null);
    try {
      const doc = parseContacts(contacts.content);
      const domain = contact?.domain || (p.email.includes('@') ? p.email.split('@')[1].toLowerCase() : '');
      const added = ['name', ...(p.role ? ['role'] : []), ...(p.email ? ['email'] : [])];
      const row = initialStatus({
        ...blankContact(newId('c')),
        company: contact?.company ?? '',
        website: contact?.website ?? '',
        domain,
        name: p.name,
        role: p.role,
        email: p.email,
        email_kind: p.email ? inboxKind(p.email) : '',
        email_status: p.email ? 'verified' : '',
        src_name: 'reply',
        src_role: p.role ? 'reply' : '',
        src_email: p.email ? 'reply' : '',
        added: added.join(','),
        detail: contact?.detail ?? '',
        // True by the reply itself: the person written to named them.
        personal_line: contact?.name ? `${firstName(contact.name)} suggested I get in touch with you.` : '',
        researched: p.email ? new Date().toISOString() : '',
      });
      const items = [...doc.items, row];
      await context.save(contacts.stageId, serializeContacts({ ...doc, items }), 'outreach_edit', `Added ${p.name}, named in ${contact?.name || 'a'} reply.`);
      const message = parseMessage(context.parts.message?.content);
      if (message && row.status === 'ready') {
        await context.save(drafts.stageId, serializeDrafts(syncDrafts(items, message, parseDrafts(drafts.content), () => newId('d'))), 'outreach_drafts', `Drafted a note to ${p.name}.`);
      }
      setSaid(t('outreach.addedNext', { name: p.name }));
      setPeople(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-email-replies className="space-y-1.5 rounded-lg bg-[var(--surface-container-lowest)] p-2.5 text-label">
      {records.map((r) => (
        <p key={r.id} data-inbound={r.kind} className={r.kind === 'reply' ? 'text-[var(--on-surface)]' : 'text-[var(--on-surface-variant)]'}>
          {t(`outreach.inbound.${r.kind}`, { when: when(r), text: r.text.length > 300 ? `${r.text.slice(0, 297)}…` : r.text })}
        </p>
      ))}
      {reply && !readOnly && people === null && (
        <button type="button" className={quiet} disabled={busy} onClick={() => void ask()} data-who-next>{t('outreach.whoNext')}</button>
      )}
      {people?.length === 0 && <p className="text-[var(--on-surface-variant)]">{t('outreach.noOneNamed')}</p>}
      {people?.map((p) => (
        <div key={`${p.name}${p.email}`} className="flex flex-wrap items-center gap-2" data-next-contact>
          <span className="min-w-0 flex-1">
            {p.name}{p.role ? `, ${p.role}` : ''}{p.email ? ` · ${p.email}` : ''} <span className="text-[var(--on-surface-variant)]">“{p.quote}”</span>
          </span>
          <button type="button" className={quiet} disabled={busy} onClick={() => void add(p)} data-add-next>{t('outreach.addAndDraft', { name: firstName(p.name) || p.name })}</button>
        </div>
      ))}
      {said && <p role="status" className="text-[var(--pm-primary)]">{said}</p>}
      {error && <p role="alert" className="text-[var(--pm-error)]">{error}</p>}
    </div>
  );
}
