'use client';

import { useEffect, useState } from 'react';

import { useT } from '@/lib/i18n/i18n-provider';
import { outreachCounts } from '@/lib/outreach/summary';
import { listSends, type SendRecord } from '@/lib/supabase/outreach-sends';
import type { OutreachContext } from '@/components/workflow/renderers/types';

/** "What needs you" on every outreach stage (`lib/outreach/summary.ts`). */
export function OutreachSummary({ context }: { context: OutreachContext }) {
  const t = useT();
  const [sends, setSends] = useState<SendRecord[]>([]);
  const draftsContent = context.parts.drafts?.content;
  useEffect(() => {
    let live = true;
    listSends(context.project.id)
      .then((s) => live && setSends(s))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [context.project.id, draftsContent]);
  const c = outreachCounts({ contacts: context.parts.contacts?.content, message: context.parts.message?.content, drafts: draftsContent, sends, facts: context.project.facts });
  const needs = [
    c.decide ? t('outreach.sum.decide', { count: c.decide }) : '',
    c.search ? t('outreach.sum.search', { count: c.search }) : '',
    c.approve ? t('outreach.sum.approve', { count: c.approve }) : '',
    c.held ? t('outreach.sum.held', { count: c.held }) : '',
    c.failed ? t('outreach.sum.failed', { count: c.failed }) : '',
  ].filter(Boolean);
  const done = [c.scheduled ? t('outreach.sum.scheduled', { count: c.scheduled }) : '', c.sent ? t('outreach.sum.sent', { count: c.sent }) : ''].filter(Boolean);
  if (!needs.length && !done.length) return null;
  return (
    <div data-outreach-summary className="mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-xl bg-[var(--surface-container-low)] px-3 py-2 text-label">
      {needs.length > 0 && <span className="font-semibold text-[var(--on-surface)]">{t('outreach.needsYou')}</span>}
      {needs.map((line) => <span key={line} className="text-[var(--pm-tertiary)]">{line}</span>)}
      {done.map((line) => <span key={line} className="text-[var(--on-surface-variant)]">{line}</span>)}
    </div>
  );
}
