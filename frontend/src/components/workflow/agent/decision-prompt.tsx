'use client';

import { useState } from 'react';

import { actionLabel } from '@/lib/agent/actions';
import type { AgentStep } from '@/types/agent';
import type { AnswerContradiction } from '@/lib/api/client';

/** The run is waiting on the user: approve this move, or decline it. */
export function DecisionPrompt({
  step,
  stale = false,
  onApprove,
  onReplan,
  onDecline,
}: {
  step: AgentStep;
  /** Proposed before the stage last changed: its reasons may no longer hold. */
  stale?: boolean;
  onApprove: () => void;
  onReplan?: () => void;
  onDecline: () => void;
}) {
  return (
    <section aria-label="Go mode needs your approval" className="rounded-xl bg-[var(--surface-container-highest)] px-5 py-4">
      <p className="text-label uppercase tracking-wide text-[var(--on-surface-variant)]">Next move — needs your approval</p>
      <p className="mt-1 text-title text-[var(--on-surface)]">{actionLabel(step.action_key)}</p>
      {step.decision_question && <p className="mt-1 text-body text-[var(--on-surface)]">{step.decision_question}</p>}
      {step.rationale && <p className="mt-1 text-body text-[var(--on-surface-variant)]">Why: {step.rationale}</p>}
      {step.expected_outcome && (
        <p className="mt-1 text-label text-[var(--on-surface-variant)]">Expected: {step.expected_outcome}</p>
      )}
      {stale && (
        <p role="status" className="mt-2 text-label text-[var(--pm-tertiary)]">
          Proposed before your latest change to this stage, so this reasoning may no longer hold.
        </p>
      )}
      <div className="mt-3 flex gap-2">
        {stale && onReplan ? (
          <button onClick={onReplan} className="rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-title text-[var(--on-primary)]">
            Propose again
          </button>
        ) : (
          <button onClick={onApprove} className="rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-title text-[var(--on-primary)]">
            Approve
          </button>
        )}
        <button onClick={onDecline} className="rounded-lg px-4 py-2 text-title text-[var(--on-surface-variant)]">
          Decline
        </button>
      </div>
    </section>
  );
}

/**
 * The run stopped on a question (request_user_decision, or "the work looks
 * done but the deliverable is not"). Answer it here, or change the project —
 * tick a requirement, edit the draft — and press Resume.
 */
export function QuestionPrompt({
  question,
  onAnswer,
  checkAnswer,
  approvals = [],
  onTick,
}: {
  question: string;
  /** With the contradiction the user chose to record the answer over (L-65). */
  onAnswer: (text: string, contradicted?: AnswerContradiction) => void;
  /** Reads the answer against the saved record first; null when nothing contradicts it. */
  checkAnswer?: (text: string) => Promise<AnswerContradiction | null>;
  /** Approvals the question asks for, offered as the tick itself (4 Oct). */
  approvals?: { id: string; label: string }[];
  onTick?: (approval: { id: string; label: string }) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [checking, setChecking] = useState(false);
  const [contradiction, setContradiction] = useState<AnswerContradiction | null>(null);
  const [ticking, setTicking] = useState<string | null>(null);
  async function submit() {
    if (!checkAnswer) return onAnswer(text);
    setChecking(true);
    try {
      const found = await checkAnswer(text);
      if (found) setContradiction(found);
      else onAnswer(text);
    } finally {
      setChecking(false);
    }
  }
  const [tickError, setTickError] = useState<string | null>(null);
  return (
    <section aria-label="Go mode asks you" className="rounded-xl bg-[var(--surface-container-highest)] px-5 py-4">
      <p className="text-label uppercase tracking-wide text-[var(--on-surface-variant)]">Go mode asks</p>
      <p className="mt-1 text-body text-[var(--on-surface)]">{question}</p>
      {onTick && approvals.length > 0 && (
        <div className="mt-3 flex flex-col items-start gap-2">
          {approvals.map((a) => (
            <button
              key={a.id}
              type="button"
              disabled={ticking !== null}
              onClick={() => {
                setTicking(a.id);
                setTickError(null);
                void onTick(a)
                  .catch((e) => setTickError(e instanceof Error && e.message ? e.message : 'That did not go through.'))
                  .finally(() => setTicking(null));
              }}
              className="flex items-center gap-2 rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-left text-title text-[var(--on-primary)] disabled:opacity-60"
            >
              <span aria-hidden className="material-symbols-outlined text-[20px]">check_box</span>
              {ticking === a.id ? 'Recording…' : `Tick: “${a.label}”`}
            </button>
          ))}
          <span className="text-label text-[var(--on-surface-variant)]">
            Ticking records your approval and Go carries on. If it is not right yet, say what to change below.
          </span>
          {tickError && <span role="alert" className="text-label text-[var(--pm-error)]">{tickError}</span>}
        </div>
      )}
      {contradiction && (
        <div role="alert" aria-label="Your answer and the record disagree" className="mt-3 rounded-lg bg-[var(--surface-container-lowest)] px-4 py-3">
          <p className="text-label uppercase tracking-wide text-[var(--on-surface-variant)]">Your answer and the record disagree</p>
          {contradiction.claim && <p className="mt-1 text-body text-[var(--on-surface)]">Your answer says: {contradiction.claim}</p>}
          <p className="mt-1 text-body text-[var(--on-surface)]">
            {contradiction.document}{contradiction.version ? ` (v${contradiction.version})` : ''} says: <q>{contradiction.quote}</q>
          </p>
          {contradiction.explanation && <p className="mt-1 text-label text-[var(--on-surface-variant)]">{contradiction.explanation}</p>}
          <p className="mt-2 text-label text-[var(--on-surface-variant)]">
            Your answer becomes a fact every stage follows. If the record is wrong, record it anyway; otherwise change your answer.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onAnswer(text, contradiction)}
              className="rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-label text-[var(--on-primary)]"
            >
              Record my answer anyway
            </button>
            <button
              type="button"
              onClick={() => setContradiction(null)}
              className="rounded-lg bg-[var(--surface-container-high)] px-4 py-2 text-label text-[var(--on-surface)]"
            >
              Edit my answer
            </button>
          </div>
        </div>
      )}
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setContradiction(null);
        }}
        rows={2}
        aria-label="Your answer"
        placeholder="Your answer…"
        className="mt-3 w-full resize-none rounded-lg bg-[var(--surface-container-lowest)] px-3 py-2 text-body text-[var(--on-surface)] outline-none"
      />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          onClick={() => void submit()}
          disabled={!text.trim() || checking || contradiction !== null}
          className="rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-title text-[var(--on-primary)] disabled:opacity-40"
        >
          {checking ? 'Checking against the record…' : 'Answer and continue'}
        </button>
        <span className="text-label text-[var(--on-surface-variant)]">
          Or change the project yourself — tick a requirement, edit the draft — and press Resume.
        </span>
      </div>
    </section>
  );
}
