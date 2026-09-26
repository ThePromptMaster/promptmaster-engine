'use client';

import type { AgentRun } from '@/types/agent';

const BUDGETS = [5, 12, 25];

/** Go / Stop and the step budget. */
export function GoControl({
  run,
  running,
  budget,
  onBudget,
  onGo,
  onStop,
  canResume,
  disabled,
}: {
  run: AgentRun | null;
  running: boolean;
  budget: number;
  onBudget: (n: number) => void;
  onGo: () => void;
  onStop: () => void;
  canResume: boolean;
  disabled: boolean;
}) {
  const used = run?.steps_used ?? 0;
  const cap = run && !run.ended_at ? run.budget_steps : budget;
  const pct = Math.min(100, Math.round((used / Math.max(1, cap)) * 100));
  return (
    <div className="flex flex-wrap items-center gap-3">
      {running ? (
        <button
          onClick={onStop}
          className="inline-flex items-center gap-2 rounded-lg bg-[var(--pm-tertiary)] px-5 py-2 text-title text-white"
        >
          <span aria-hidden className="material-symbols-outlined">stop_circle</span>
          Stop
        </button>
      ) : (
        <button
          onClick={onGo}
          disabled={disabled}
          className="inline-flex items-center gap-2 rounded-lg bg-[var(--pm-primary)] px-5 py-2 text-title text-[var(--on-primary)] disabled:opacity-50"
        >
          <span aria-hidden className="material-symbols-outlined">play_arrow</span>
          {canResume ? 'Resume' : 'Go'}
        </button>
      )}
      <label className="flex items-center gap-2 text-label text-[var(--on-surface-variant)]">
        Budget
        <select
          value={budget}
          onChange={(e) => onBudget(Number(e.target.value))}
          disabled={running || Boolean(run && !run.ended_at)}
          aria-label="Step budget"
          className="rounded-md bg-[var(--surface-container-highest)] px-2 py-1 text-label text-[var(--on-surface)]"
        >
          {BUDGETS.map((b) => (
            <option key={b} value={b}>
              {b} steps
            </option>
          ))}
        </select>
      </label>
      {run && (
        <div className="flex min-w-40 flex-1 items-center gap-2" aria-label="Budget used">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--surface-container-highest)]">
            <div className="h-full rounded-full bg-[var(--pm-primary)]" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-label text-[var(--on-surface-variant)]">
            {used} / {cap} steps
          </span>
        </div>
      )}
    </div>
  );
}
