'use client';

import { useState } from 'react';

import type { CompletionSummary } from '@/lib/workflow/engine';
import type { BlockKind } from '@/lib/workflow/types';

const BLOCK_KINDS: { kind: BlockKind; label: string; hint: string }[] = [
  { kind: 'data_missing', label: 'Waiting on information', hint: 'Figures, sources or answers you do not have yet' },
  { kind: 'tool_missing', label: 'Needs a tool PromptMaster does not have', hint: 'e.g. running code, a database, a lab result' },
  { kind: 'needs_decision', label: 'Needs a decision', hint: 'Someone has to choose before this can go on' },
];

/** PM-13: "blocked" is a status with a reason, not a stage left quietly undone. */
export function BlockForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (block: { kind: BlockKind; reason: string }) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<BlockKind>('data_missing');
  const [reason, setReason] = useState('');
  return (
    <section aria-label="Mark as blocked" className="rounded-xl bg-[var(--surface-container-high)] px-5 py-4">
      <p className="text-body text-[var(--on-surface)]">What is this stage waiting on?</p>
      <div role="radiogroup" aria-label="Why it is blocked" className="mt-3 grid gap-2 sm:grid-cols-3">
        {BLOCK_KINDS.map((option) => (
          <button
            key={option.kind}
            role="radio"
            aria-checked={kind === option.kind}
            onClick={() => setKind(option.kind)}
            className={`rounded-lg px-3 py-2 text-left transition-colors ${
              kind === option.kind
                ? 'bg-[var(--pm-primary)] text-[var(--on-primary)]'
                : 'bg-[var(--surface-container-highest)] text-[var(--on-surface)]'
            }`}
          >
            <span className="block text-label font-semibold">{option.label}</span>
            <span className="block text-label opacity-80">{option.hint}</span>
          </button>
        ))}
      </div>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        aria-label="What exactly is missing"
        placeholder="What exactly is missing? (required)"
        className="mt-3 w-full resize-none rounded-lg bg-[var(--surface-container-lowest)] px-3 py-2 text-body text-[var(--on-surface)] outline-none"
      />
      <div className="mt-3 flex gap-2">
        <button
          onClick={() => onSubmit({ kind, reason: reason.trim() })}
          disabled={!reason.trim()}
          className="rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-title text-[var(--on-primary)] disabled:opacity-40"
        >
          Mark as blocked
        </button>
        <button onClick={onCancel} className="rounded-lg px-4 py-2 text-title text-[var(--on-surface-variant)]">
          Cancel
        </button>
      </div>
    </section>
  );
}

export function BlockedNotice({ kind, reason, onUnblock }: { kind: BlockKind; reason: string; onUnblock: () => void }) {
  const label = BLOCK_KINDS.find((k) => k.kind === kind)?.label ?? 'Blocked';
  return (
    <div role="status" className="flex flex-wrap items-center gap-3 rounded-xl bg-[var(--surface-container-high)] px-5 py-4">
      <span aria-hidden className="material-symbols-outlined text-[var(--pm-tertiary)]">block</span>
      <div className="mr-auto">
        <p className="text-title text-[var(--on-surface)]">Blocked — {label.toLowerCase()}</p>
        <p className="text-label text-[var(--on-surface-variant)]">{reason}</p>
      </div>
      <button onClick={onUnblock} className="rounded-lg bg-[var(--surface-container-highest)] px-4 py-2 text-title text-[var(--on-surface)]">
        Unblock
      </button>
    </div>
  );
}

/**
 * PM-14: what finishing would be finishing. The deliverable is the question;
 * the stage counts are context. Finishing without the deliverable is allowed
 * — it is the user's project — but it is said out loud first.
 */
export function CompletionDialog({
  summary,
  busy,
  onConfirm,
  onCancel,
}: {
  summary: CompletionSummary;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const rows: [string, number][] = [
    ['completed', summary.completed],
    ['skipped on purpose', summary.skipped],
    ['left open', summary.leftOpen],
    ['blocked', summary.blocked],
    ['not started', summary.notStarted],
  ];
  return (
    <section aria-label="Finish the project" className="rounded-xl bg-[var(--surface-container-high)] px-6 py-5">
      <h3 className="text-title text-[var(--on-surface)]">Finish this project?</h3>
      <p className="mt-3 flex items-center gap-2 text-body text-[var(--on-surface)]">
        <span
          aria-hidden
          className={`material-symbols-outlined ${summary.deliverableDone ? 'text-[var(--pm-secondary)]' : 'text-[var(--pm-tertiary)]'}`}
        >
          {summary.deliverableDone ? 'task_alt' : 'error'}
        </span>
        {summary.deliverableDone
          ? `The deliverable (${summary.deliverable?.short_label ?? 'the main artifact'}) is done.`
          : `The deliverable (${summary.deliverable?.short_label ?? 'the main artifact'}) is not done yet.`}
      </p>
      <p className="mt-2 text-label text-[var(--on-surface-variant)]">
        Stages: {rows.filter(([, n]) => n > 0).map(([label, n]) => `${n} ${label}`).join(' · ') || 'none'}
      </p>
      {!summary.deliverableDone && (
        <p className="mt-2 text-label text-[var(--on-surface-variant)]">
          Finishing now records the project as finished without it. You can reopen it at any time.
        </p>
      )}
      <div className="mt-4 flex gap-2">
        <button
          onClick={onConfirm}
          disabled={busy}
          className="rounded-lg bg-[var(--pm-primary)] px-5 py-2 text-title text-[var(--on-primary)] disabled:opacity-50"
        >
          {summary.deliverableDone ? 'Finish project' : 'Finish anyway'}
        </button>
        <button onClick={onCancel} className="rounded-lg px-4 py-2 text-title text-[var(--on-surface-variant)]">
          Not yet
        </button>
      </div>
    </section>
  );
}
