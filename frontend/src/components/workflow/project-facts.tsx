'use client';

import { useState } from 'react';

import { recordFacts, retireFact, supersedeFact } from '@/lib/supabase/facts';
import { currentFacts, factSource, retiredFacts } from '@/lib/workflow/facts';
import type { Project, ProjectFact } from '@/types/project';

/**
 * The project's accepted facts and requirements (F3, 7 Oct).
 *
 * Sean, 6 Oct: "Accepted evidence is recorded once with its source and
 * provenance. Every affected artifact and check reads the same current
 * evidence." This is that record, on every stage: each fact with where it
 * came from; add one, change one (the old one is kept in the history), or
 * take one out. Every prompt is sent the current list, and a change reopens
 * the finished work that relied on it.
 */
export function ProjectFacts({
  project,
  onChanged,
  readOnly = false,
}: {
  project: Pick<Project, 'id' | 'user_id' | 'facts'>;
  onChanged: () => void | Promise<void>;
  readOnly?: boolean;
}) {
  const current = currentFacts(project.facts);
  const history = retiredFacts(project.facts);
  // Open whenever there are facts, until the user folds it themselves.
  const [toggled, setToggled] = useState<boolean | null>(null);
  const open = toggled ?? current.length > 0;
  const [adding, setAdding] = useState('');
  const [kind, setKind] = useState<ProjectFact['kind']>('fact');
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      await onChanged();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'That did not save. Nothing was changed.');
    } finally {
      setBusy(false);
    }
  };

  const field =
    'w-full rounded-lg bg-[var(--surface-container-lowest)] px-3 py-2 text-body text-[var(--on-surface)] outline-none focus:ring-2 focus:ring-[var(--pm-primary)]/40';
  const quiet = 'rounded px-1.5 py-0.5 text-label font-semibold text-[var(--pm-primary)] hover:bg-[var(--surface-container-high)] disabled:opacity-40';

  return (
    <section aria-label="Facts and requirements" className="mb-6 rounded-xl bg-[var(--surface-container-low)] px-5 py-3">
      <button
        type="button"
        onClick={() => setToggled(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left text-title text-[var(--on-surface)]"
      >
        <span aria-hidden className="material-symbols-outlined text-[18px]">fact_check</span>
        Facts and requirements
        <span className="text-label text-[var(--on-surface-variant)]">
          {current.length ? `${current.length} accepted · every stage reads these` : 'none recorded yet'}
        </span>
        <span aria-hidden className="material-symbols-outlined ml-auto text-[18px]">{open ? 'expand_less' : 'expand_more'}</span>
      </button>

      {open && (
        <div className="mt-3">
          {current.length > 0 && (
            <ul aria-label="Accepted facts" className="space-y-2">
              {current.map((f) => (
                <li key={f.id} className="text-body text-[var(--on-surface)]">
                  {editing?.id === f.id ? (
                    <div className="flex flex-col gap-2">
                      <textarea
                        value={editing.text}
                        onChange={(e) => setEditing({ id: f.id, text: e.target.value.slice(0, 2_000) })}
                        rows={2}
                        aria-label="Change this fact"
                        className={field}
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={busy || !editing.text.trim() || editing.text.trim() === f.statement}
                          onClick={() => void act(async () => {
                            await supersedeFact(project, f, editing.text);
                            setEditing(null);
                          })}
                          className="rounded-lg bg-[var(--pm-primary)] px-3 py-1 text-label text-[var(--on-primary)] disabled:opacity-40"
                        >
                          Save the change
                        </button>
                        <button type="button" onClick={() => setEditing(null)} className={quiet}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {f.kind === 'requirement' && <span className="font-semibold">Requirement: </span>}
                      {f.subject ? `${f.subject}: ` : ''}
                      {f.statement}
                      <span className="ml-2 text-label text-[var(--on-surface-variant)]">{factSource(f)}</span>
                      {!readOnly && (
                        <>
                          <button type="button" disabled={busy} onClick={() => setEditing({ id: f.id, text: f.statement })} className={`ml-2 ${quiet}`}>
                            Change
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void act(() => retireFact(f.id, 'taken out by the user'))}
                            className={quiet}
                          >
                            Take out
                          </button>
                        </>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}

          {!readOnly && (
            <div className="mt-3 flex flex-col gap-2">
              <textarea
                value={adding}
                onChange={(e) => setAdding(e.target.value.slice(0, 2_000))}
                rows={2}
                aria-label="A fact or requirement to add"
                placeholder="e.g. Candidate A has managed 100+ employees for 7 years — or a requirement: keep one researcher free"
                className={field}
              />
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value as ProjectFact['kind'])}
                  aria-label="Fact or requirement"
                  className="rounded-lg bg-[var(--surface-container-lowest)] px-2 py-1 text-label text-[var(--on-surface)]"
                >
                  <option value="fact">Fact</option>
                  <option value="requirement">Requirement</option>
                </select>
                <button
                  type="button"
                  disabled={busy || !adding.trim()}
                  onClick={() => void act(async () => {
                    await recordFacts(project, [{ statement: adding, kind, source_kind: 'brief' }]);
                    setAdding('');
                  })}
                  className="rounded-lg bg-[var(--pm-primary)] px-3 py-1 text-label text-[var(--on-primary)] disabled:opacity-40"
                >
                  {busy ? 'Saving…' : 'Add'}
                </button>
              </div>
            </div>
          )}

          {error && (
            <p role="alert" className="mt-2 text-label text-[var(--pm-error)]">{error}</p>
          )}

          {history.length > 0 && (
            <div className="mt-3">
              <button type="button" onClick={() => setShowHistory((v) => !v)} className={quiet}>
                {showHistory ? 'Hide history' : `History (${history.length})`}
              </button>
              {showHistory && (
                <ul aria-label="Earlier facts" className="mt-1 space-y-1 text-label text-[var(--on-surface-variant)]">
                  {history.map((f) => (
                    <li key={f.id}>
                      <s>{f.statement}</s> — {factSource(f)}; {f.retired_reason === 'superseded' ? 'replaced' : 'taken out'}
                      {f.retired_at ? ` ${new Date(f.retired_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
