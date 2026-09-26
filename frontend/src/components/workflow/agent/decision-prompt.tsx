'use client';

import { useState } from 'react';

import { actionLabel } from '@/lib/agent/actions';
import type { AgentStep } from '@/types/agent';

/** The run is waiting on the user: approve this move, or decline it. */
export function DecisionPrompt({
  step,
  onApprove,
  onDecline,
}: {
  step: AgentStep;
  onApprove: () => void;
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
      <div className="mt-3 flex gap-2">
        <button onClick={onApprove} className="rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-title text-[var(--on-primary)]">
          Approve
        </button>
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
export function QuestionPrompt({ question, onAnswer }: { question: string; onAnswer: (text: string) => void }) {
  const [text, setText] = useState('');
  return (
    <section aria-label="Go mode asks you" className="rounded-xl bg-[var(--surface-container-highest)] px-5 py-4">
      <p className="text-label uppercase tracking-wide text-[var(--on-surface-variant)]">Go mode asks</p>
      <p className="mt-1 text-body text-[var(--on-surface)]">{question}</p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        aria-label="Your answer"
        placeholder="Your answer…"
        className="mt-3 w-full resize-none rounded-lg bg-[var(--surface-container-lowest)] px-3 py-2 text-body text-[var(--on-surface)] outline-none"
      />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          onClick={() => onAnswer(text)}
          disabled={!text.trim()}
          className="rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-title text-[var(--on-primary)] disabled:opacity-40"
        >
          Answer and continue
        </button>
        <span className="text-label text-[var(--on-surface-variant)]">
          Or change the project yourself — tick a requirement, edit the draft — and press Resume.
        </span>
      </div>
    </section>
  );
}
