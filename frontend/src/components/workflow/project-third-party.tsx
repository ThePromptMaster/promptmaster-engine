'use client';

import { useEffect, useState } from 'react';

import { ToolkitLogo } from '@/components/personalize/toolkit-logo';
import { useAuth } from '@/hooks/use-auth';
import { hasConnectedAccount } from '@/lib/connections/account-found';
import { MAX_HELD, shortWhen, toolkitFromSource } from '@/lib/connections/items';
import { useLocale, useT } from '@/lib/i18n/i18n-provider';
import type { ThirdPartyItem } from '@/types';
import type { Project } from '@/types/project';

const ICON: Record<ThirdPartyItem['kind'], string> = { email: 'mail', calendar_event: 'event', file: 'description' };

/**
 * What the project holds from the person's accounts (7 Nov): the emails, meetings
 * and files they added or a search read (L-203), numbered [T1]… as every prompt numbers
 * them. Their text can be read here exactly as it is sent, removed, or added to from
 * the accounts, and the switch says whether this project may search them at all.
 * Other people's words: fenced in every prompt, and never what a web search is
 * written from (L-200).
 */
export function ProjectThirdParty({
  project,
  readOnly = false,
  onSave,
  onAdd,
  onAccountSearch,
}: {
  project: Pick<Project, 'id' | 'third_party' | 'account_search'>;
  readOnly?: boolean;
  /** Save the list as it now is: patched and flushed by the workspace. */
  onSave: (items: ThirdPartyItem[]) => Promise<void>;
  /** Open the accounts to add more, once pending edits are saved. */
  onAdd: () => Promise<void>;
  /** Turn searching the person's accounts on or off for this project. */
  onAccountSearch?: (value: 'on' | 'off') => Promise<void>;
}) {
  const t = useT();
  const locale = useLocale();
  const { isGuest } = useAuth();
  const items = project.third_party ?? [];
  const [toggled, setToggled] = useState<boolean | null>(null);
  const open = toggled ?? items.length > 0;
  const [shown, setShown] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  const canSwitch = !!onAccountSearch;
  useEffect(() => {
    if (isGuest || !canSwitch) return;
    let live = true;
    void hasConnectedAccount().then((yes) => live && setConnected(yes));
    return () => {
      live = false;
    };
  }, [isGuest, canSwitch]);

  // A guest cannot connect an account, and has nothing to see until they could.
  if (isGuest && items.length === 0) return null;

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(t('conn.heldSaveError', { why: e instanceof Error ? e.message : '' }));
    } finally {
      setBusy(false);
    }
  };

  const full = items.length >= MAX_HELD;
  const quiet = 'rounded px-1.5 py-0.5 text-label font-semibold text-[var(--pm-primary)] hover:bg-[var(--surface-container-high)] disabled:opacity-40';

  return (
    <section aria-label={t('conn.heldTitle')} className="mb-6 rounded-xl bg-[var(--surface-container-low)] px-5 py-3">
      <button
        type="button"
        onClick={() => setToggled(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-start text-title text-[var(--on-surface)]"
      >
        <span aria-hidden className="material-symbols-outlined text-[18px]">inbox</span>
        {t('conn.heldTitle')}
        <span className="text-label text-[var(--on-surface-variant)]">
          {items.length ? t('conn.heldCount', { count: items.length, max: MAX_HELD }) : t('conn.heldNone')}
        </span>
        <span aria-hidden className="material-symbols-outlined ms-auto text-[18px]">{open ? 'expand_less' : 'expand_more'}</span>
      </button>

      {open && (
        <div className="mt-3">
          <p className="text-label text-[var(--on-surface-variant)]">{t('conn.heldExplain')}</p>

          {connected && onAccountSearch && (
            <label className="mt-3 flex items-start gap-3">
              <input
                type="checkbox"
                role="switch"
                aria-label={t('conn.heldSwitch')}
                checked={project.account_search === 'on'}
                disabled={readOnly || busy}
                onChange={(e) => void run(() => onAccountSearch(e.target.checked ? 'on' : 'off'))}
                className="mt-1 h-4 w-4 accent-[var(--pm-primary)]"
              />
              <span className="text-label text-[var(--on-surface-variant)]">
                <span className="font-semibold text-[var(--on-surface)]">{t('conn.heldSwitch')}</span> {t('conn.heldSwitchNote')}
              </span>
            </label>
          )}

          {items.length > 0 && (
            <ol aria-label={t('conn.heldTitle')} className="mt-3 space-y-2">
              {items.map((item, i) => {
                // The account's own line already says when; the date alone only when it gave none.
                const meta = item.source || (item.when ? shortWhen(item.when, locale) : '');
                return (
                  <li key={`${i}-${item.kind}-${item.title}`} className="text-body text-[var(--on-surface)]">
                    <span className="flex items-start gap-1.5">
                      <ToolkitLogo slug={toolkitFromSource(item.source)} fallback={ICON[item.kind]} size={16} className="mt-0.5 text-[var(--on-surface-variant)]" />
                      <span className="min-w-0">
                        <span className="font-semibold">[T{i + 1}] </span>
                        <span dir="auto">{item.title || t('conn.heldUntitled')}</span>
                        {meta && <span dir="auto" className="block text-label text-[var(--on-surface-variant)]">{meta}</span>}
                      </span>
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 ps-6">
                      <button type="button" aria-expanded={shown === i} onClick={() => setShown(shown === i ? null : i)} className={quiet}>
                        {shown === i ? t('conn.heldHide') : t('conn.heldShow')}
                      </button>
                      {!readOnly && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setShown(null);
                            void run(() => onSave(items.filter((_x, j) => j !== i)));
                          }}
                          className={quiet}
                        >
                          {t('conn.remove')}
                        </button>
                      )}
                    </span>
                    {shown === i && (
                      <pre
                        dir="auto"
                        className="ms-6 mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--surface-container-lowest)] px-3 py-2 font-sans text-label text-[var(--on-surface)]"
                      >
                        {item.text || t('conn.heldNoText')}
                      </pre>
                    )}
                  </li>
                );
              })}
            </ol>
          )}

          {items.length > 0 && <p className="mt-3 text-label text-[var(--on-surface-variant)]">{t('conn.webOff')}</p>}

          {!readOnly && !isGuest && (
            <button type="button" disabled={busy || full} onClick={() => void run(onAdd)} className={`${quiet} mt-3`}>
              {full ? t('conn.heldFull', { max: MAX_HELD }) : t('conn.heldAdd')}
            </button>
          )}
          {error && <p role="alert" className="mt-2 text-label text-[var(--pm-error)]">{error}</p>}
        </div>
      )}
    </section>
  );
}
