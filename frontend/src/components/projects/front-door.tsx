'use client';

import { useEffect, useState } from 'react';

import { api } from '@/lib/api/client';
import { AutoGrowTextarea } from '@/components/shared/auto-grow-textarea';
import { INPUT_LIMITS } from '@/lib/projects/input-limits';

export interface DraftBrief {
  objective: string;
  audience: string;
  requirements: string[];
  evidence: string[];
  deliverables: string[];
  stages: string[];
  approvals: string[];
}

export const EMPTY_BRIEF: DraftBrief = { objective: '', audience: '', requirements: [], evidence: [], deliverables: [], stages: [], approvals: [] };

export type Turn = { role: 'user' | 'assistant'; content: string };

/**
 * "Keep this as a conversation for now" (Sean, 6 Oct, email 8). The user talks;
 * PromptMaster answers, asks at most one question at a time, and keeps a
 * visible draft brief of what the user has said. Nothing is saved: when the
 * user is ready, the brief is shown as what will become the project's initial
 * authoritative state, and only their confirmation carries it on.
 */
export function FrontDoor({
  opening,
  onReady,
  onBack,
  initialState = null,
  onStateChange,
}: {
  opening: string;
  onReady: (brief: DraftBrief, transcript: string) => void;
  onBack: () => void;
  /** A conversation kept from an earlier visit (U2). */
  initialState?: { turns: Turn[]; brief: DraftBrief; ready: boolean } | null;
  /** Told of every change, so the page can keep the setup between visits. */
  onStateChange?: (state: { turns: Turn[]; brief: DraftBrief; ready: boolean }) => void;
}) {
  const [turns, setTurns] = useState<Turn[]>(initialState?.turns ?? []);
  const [brief, setBrief] = useState<DraftBrief>(initialState?.brief ?? EMPTY_BRIEF);
  const [ready, setReady] = useState(initialState?.ready ?? false);
  useEffect(() => {
    onStateChange?.({ turns, brief, ready });
  }, [turns, brief, ready, onStateChange]);
  const [draft, setDraft] = useState(initialState?.turns.length ? '' : opening);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    const next: Turn[] = [...turns, { role: 'user', content: text }];
    setTurns(next);
    setDraft('');
    setBusy(true);
    setError(null);
    try {
      const res = await api.frontDoor({ turns: next, brief });
      setTurns([...next, { role: 'assistant', content: res.reply }]);
      setBrief(res.brief);
      setReady(res.ready);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'That did not go through. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const transcript = turns.map((t) => `${t.role === 'user' ? 'Me' : 'PromptMaster'}: ${t.content}`).join('\n\n');
  const section = (title: string, items: string[]) =>
    items.length ? (
      <div className="mt-2">
        <p className="text-label font-semibold text-[var(--on-surface)]">{title}</p>
        <ul className="list-disc pl-5 text-label text-[var(--on-surface-variant)]">
          {items.map((i) => <li key={i}>{i}</li>)}
        </ul>
      </div>
    ) : null;

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_300px]">
      <section aria-label="Conversation" className="rounded-2xl bg-[var(--surface-container-lowest)] px-5 py-4">
        <div className="space-y-3">
          {turns.length === 0 && (
            <p className="text-body text-[var(--on-surface-variant)]">
              Say what you have in mind. Nothing is created until you say so.
            </p>
          )}
          {turns.map((t, i) => (
            <p
              key={i}
              className={`rounded-xl px-4 py-2 text-body ${t.role === 'user' ? 'ml-8 bg-[var(--surface-container-high)] text-[var(--on-surface)]' : 'mr-8 bg-[var(--surface-container-low)] text-[var(--on-surface)]'}`}
            >
              {t.content}
            </p>
          ))}
          {busy && <p role="status" className="text-label text-[var(--on-surface-variant)]">Thinking…</p>}
        </div>
        <div className="mt-4 flex items-end gap-2">
          <AutoGrowTextarea
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, INPUT_LIMITS.message))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
            aria-label="Your message"
            className="min-w-0 flex-1 resize-none rounded-lg bg-[var(--surface-container-low)] px-3 py-2 text-body text-[var(--on-surface)] outline-none focus:ring-2 focus:ring-[var(--pm-primary)]/40"
          />
          <button onClick={() => void send()} disabled={!draft.trim() || busy} className="rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-label text-[var(--on-primary)] disabled:opacity-40">
            Send
          </button>
        </div>
        {error && <p role="alert" className="mt-2 text-label text-[var(--pm-error)]">{error}</p>}
        <button onClick={onBack} className="mt-4 text-label text-[var(--on-surface-variant)] hover:underline">Back</button>
      </section>

      <aside aria-label="Draft brief" className="h-fit rounded-2xl bg-[var(--surface-container-low)] px-5 py-4">
        <p className="text-label uppercase tracking-wider text-[var(--on-surface-variant)]">Draft brief — not saved</p>
        {brief.objective ? (
          <p className="mt-2 text-body text-[var(--on-surface)]">{brief.objective}</p>
        ) : (
          <p className="mt-2 text-label text-[var(--on-surface-variant)]">Builds up as you talk.</p>
        )}
        {brief.audience && <p className="mt-1 text-label text-[var(--on-surface-variant)]">For {brief.audience}</p>}
        {section('Requirements', brief.requirements)}
        {section('Facts you gave', brief.evidence)}
        {section('Deliverables', brief.deliverables)}
        {section('Stages', brief.stages)}
        {section('Your approvals', brief.approvals)}

        {brief.objective && !confirming && (
          <button
            onClick={() => setConfirming(true)}
            className={`mt-4 w-full rounded-lg px-4 py-2 text-label ${ready ? 'bg-[var(--pm-primary)] text-[var(--on-primary)]' : 'bg-[var(--surface-container-high)] text-[var(--on-surface)]'}`}
          >
            {ready ? 'Ready to create' : 'Create from this now'}
          </button>
        )}
        {confirming && (
          <div role="group" aria-label="Confirm the brief" className="mt-4 rounded-lg bg-[var(--surface-container-lowest)] px-3 py-3">
            <p className="text-label text-[var(--on-surface)]">
              I&apos;m ready to create this project. These facts, requirements and decisions will become its initial authoritative state.
            </p>
            <p className="mt-1 text-label text-[var(--on-surface-variant)]">Next you choose the workflow and can still change everything.</p>
            <div className="mt-2 flex gap-2">
              <button onClick={() => onReady(brief, transcript)} className="rounded-lg bg-[var(--pm-primary)] px-3 py-1.5 text-label text-[var(--on-primary)]">
                Create project
              </button>
              <button onClick={() => setConfirming(false)} className="rounded-lg px-3 py-1.5 text-label text-[var(--on-surface-variant)]">
                Keep talking
              </button>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
