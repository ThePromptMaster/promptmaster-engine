'use client';

import { useT } from '@/lib/i18n/i18n-provider';
import { useState } from 'react';

import { api } from '@/lib/api/client';
import { retireSource, saveSources } from '@/lib/supabase/sources';
import { inputsFrom } from '@/lib/workflow/stage-requests';
import { currentSources } from '@/lib/workflow/sources';
import type { Project } from '@/types/project';

/**
 * Web access and the project's saved sources (20 Oct; Sean: "Can we add web
 * search and source retrieval … with citations and saved sources? On and off
 * button? I don't know, what's the best option").
 *
 * On by default (22 Oct), per project. When on, a search goes through the backend's
 * web search, and what it returns is saved here: every stage, check and chat
 * is sent the current sources and cites them as [S1], [S2], …. Taking one out
 * keeps it in the history; a later prompt no longer cites it.
 */
export function WebSources({
  project,
  stageId,
  onToggle,
  onChanged,
  readOnly = false,
}: {
  project: Project;
  stageId: string;
  /** Turn the switch on or off: written through, then recorded as the user's. */
  onToggle: (value: 'on' | 'off') => Promise<void> | void;
  onChanged: () => void | Promise<void>;
  readOnly?: boolean;
}) {
  const t = useT();
  const on = project.web_access === 'on';
  const sources = currentSources(project.sources);
  const [toggled, setToggled] = useState<boolean | null>(null);
  // Open by itself only once there are sources: with the switch on by default,
  // opening on `on` would unfold this panel on every stage of every project.
  const open = toggled ?? sources.length > 0;
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    const q = query.trim();
    if (q.length < 2 || busy) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const found = await api.agentWebSearch({ inputs: inputsFrom(project), query: q, web_access: 'on', model: project.model });
      const saved = await saveSources(project, found.sources, { query: q, stageId });
      await onChanged();
      setQuery('');
      setNote(
        found.sources.length
          ? `${t('web.newSaved', { count: saved.length })}${found.sources.length > saved.length ? t('web.alreadyOnRecord', { count: found.sources.length - saved.length }) : ''}.`
          : t('web.noResults')
      );
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : t('web.failed'));
    } finally {
      setBusy(false);
    }
  };

  const quiet = 'rounded px-1.5 py-0.5 text-label font-semibold text-[var(--pm-primary)] hover:bg-[var(--surface-container-high)] disabled:opacity-40';

  return (
    <section aria-label={t('web.label')} className="mb-6 rounded-xl bg-[var(--surface-container-low)] px-5 py-3">
      <button
        type="button"
        onClick={() => setToggled(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left text-title text-[var(--on-surface)]"
      >
        <span aria-hidden className="material-symbols-outlined text-[18px]">travel_explore</span>
        {t('web.title')}
        <span className="text-label text-[var(--on-surface-variant)]">
          {on ? t('web.on') : t('web.off')}
          {sources.length ? t('web.saved', { count: sources.length }) : ''}
        </span>
        <span aria-hidden className="material-symbols-outlined ml-auto text-[18px]">{open ? 'expand_less' : 'expand_more'}</span>
      </button>

      {open && (
        <div className="mt-3">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              role="switch"
              aria-label={t('web.switch')}
              checked={on}
              disabled={readOnly || busy}
              onChange={(e) => void onToggle(e.target.checked ? 'on' : 'off')}
              className="mt-1 h-4 w-4 accent-[var(--pm-primary)]"
            />
            <span className="text-label text-[var(--on-surface-variant)]">
              <span className="font-semibold text-[var(--on-surface)]">{t('web.switch')}</span> {t('web.explain')}
            </span>
          </label>

          {on && !readOnly && (
            <form
              aria-label={t('web.form')}
              className="mt-3 flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void search();
              }}
            >
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value.slice(0, 400))}
                placeholder={t('web.queryHint')}
                aria-label={t('web.queryLabel')}
                className="min-w-0 flex-[1_1_14rem] rounded-lg bg-[var(--surface-container-lowest)] px-3 py-1.5 text-body text-[var(--on-surface)] outline-none focus:ring-2 focus:ring-[var(--pm-primary)]/40"
              />
              <button
                type="submit"
                disabled={busy || query.trim().length < 2}
                className="rounded-lg bg-[var(--pm-primary)] px-3 py-1.5 text-label font-semibold text-[var(--on-primary)] disabled:opacity-40"
              >
                {busy ? t('web.searching') : t('web.search')}
              </button>
            </form>
          )}
          {note && <p role="status" className="mt-2 text-label text-[var(--on-surface-variant)]">{note}</p>}
          {error && <p role="alert" className="mt-2 text-label text-[var(--pm-error)]">{error}</p>}

          {sources.length > 0 && (
            <ol aria-label={t('web.list')} className="mt-3 space-y-2">
              {sources.map((s, i) => (
                <li key={s.id} className="text-body text-[var(--on-surface)]">
                  <span className="font-semibold">[S{i + 1}] </span>
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-[var(--pm-primary)] underline">
                    {s.title || s.url}
                  </a>
                  <span className="ml-2 text-label text-[var(--on-surface-variant)]">
                    {t('web.retrieved', { date: s.retrieved_at.slice(0, 10) })}{s.origin === 'agent' ? t('web.byGo') : ''}{t('web.searched', { query: s.query })}
                  </span>
                  {s.excerpt && <span className="block text-label text-[var(--on-surface-variant)]">{s.excerpt}</span>}
                  {!readOnly && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setBusy(true);
                        void retireSource(s.id).then(() => onChanged()).catch((e) => setError(e instanceof Error ? e.message : t('web.saveError'))).finally(() => setBusy(false));
                      }}
                      className={quiet}
                    >
                      {t('web.takeOut')}
                    </button>
                  )}
                </li>
              ))}
            </ol>
          )}
          {!sources.length && on && (
            <p className="mt-2 text-label text-[var(--on-surface-variant)]">{t('web.none')}</p>
          )}
        </div>
      )}
    </section>
  );
}
