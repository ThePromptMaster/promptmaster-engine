'use client';

import { shownCost } from '@/lib/observability/spent';

import { useT } from '@/lib/i18n/i18n-provider';
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
  canContinue = false,
  disabled,
  hideResume = false,
  compact = false,
  doing = null,
  calls = null,
}: {
  run: AgentRun | null;
  running: boolean;
  budget: number;
  onBudget: (n: number) => void;
  onGo: () => void;
  onStop: () => void;
  canResume: boolean;
  /** The last window was used up: the button starts the next one, with its history. */
  canContinue?: boolean;
  disabled: boolean;
  /** The "I need you to…" card carries the one button that resumes; a bare Resume beside it re-trips the same stop. */
  hideResume?: boolean;
  /** The pinned copy at the top of the page: the controls, without the explanation under them. */
  compact?: boolean;
  /** What Go is doing now, in plain words (`doingNow`), shown beside the button (4 Nov). */
  doing?: string | null;
  /** Model calls this run chain, against its ceiling (4 Nov). */
  calls?: { used: number; cap: number } | null;
}) {
  // Both numbers come from the run on show. The selector is the size of the
  // *next* window; mixing it in printed "20 / 12" for an ended run and
  // "3 / 25" beside a selector reading 12 (1 Oct, item 21). While a window is
  // live the selector is locked and shows that window's size: a window
  // continued from the card keeps the old size whatever was picked since.
  const t = useT();
  const used = run?.steps_used ?? 0;
  const cap = run?.budget_steps ?? budget;
  const live = Boolean(run && !run.ended_at);
  const pct = Math.min(100, Math.round((used / Math.max(1, cap)) * 100));
  // What Resume or Continue does. Under the button on the panel; on the pinned
  // copy it is the button's tooltip, since the sentence squeezed beside the
  // dock's buttons wrapped one word per line on an iPad (Sean, 25 Oct).
  const counter = run ? (
    <div className={`flex flex-1 items-center gap-2 ${compact ? 'min-w-28' : 'min-w-40'}`} aria-label={t('gc.used')}>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--surface-container-highest)]">
        <div className="h-full rounded-full bg-[var(--pm-primary)]" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-label text-[var(--on-surface-variant)]">
        {live ? t('gc.thisWindow', { used, cap }) : t('gc.lastWindow', { used, cap })}
      </span>
    </div>
  ) : null;
  const means = !running && !(hideResume && canResume) && (canResume || canContinue)
    ? canResume ? t('gc.resumeMeans') : t('gc.continueMeans')
    : null;
  return (
    <div>
    <div className="flex flex-wrap items-center gap-3">
      {running ? (
        <button
          onClick={onStop}
          className="inline-flex items-center gap-2 rounded-lg bg-[var(--pm-tertiary)] px-5 py-2 text-title text-white"
        >
          <span aria-hidden className="material-symbols-outlined">stop_circle</span>
          {t('gc.stop')}
        </button>
      ) : hideResume && canResume ? null : (
        <button
          onClick={onGo}
          disabled={disabled}
          title={compact && means ? means : undefined}
          className="inline-flex items-center gap-2 rounded-lg bg-[var(--pm-primary)] px-5 py-2 text-title text-[var(--on-primary)] disabled:opacity-50"
        >
          <span aria-hidden className="material-symbols-outlined">play_arrow</span>
          {canResume ? t('go.resume') : canContinue ? t('go.continue') : t('go.go')}
        </button>
      )}
      {/* 4 Nov (Sean): what Go is doing, in words, beside the button that started it. */}
      {running && doing && (
        <span role="status" data-go-doing className={`min-w-0 text-body text-[var(--on-surface)] ${compact ? 'truncate' : ''}`}>
          {doing}
        </span>
      )}
      {/* A live window's size is locked, so the pinned copy leaves it to the
          panel and keeps to one row. */}
      {!(compact && live) && (
      <label className="flex items-center gap-2 text-label text-[var(--on-surface-variant)]">
        {/* After a run ends the selector is the size of the *next* window, and says so
            beside a count that is about the last one (2 Oct, screenshot 8). */}
        {live || !run ? t('gc.window') : t('gc.nextWindow')}
        <select
          value={live ? cap : budget}
          onChange={(e) => onBudget(Number(e.target.value))}
          disabled={running || live}
          aria-label={t('gc.budget')}
          className="rounded-md bg-[var(--surface-container-highest)] px-2 py-1 text-label text-[var(--on-surface)]"
        >
          {BUDGETS.map((b) => (
            <option key={b} value={b}>
              {t('gc.steps', { count: b })}
            </option>
          ))}
        </select>
      </label>
      )}
      {/* The pinned copy keeps the count only while nothing is being done; the words say more. */}
      {compact && run && !(running && doing) && counter}
    </div>
    {/* 4 Nov (Sean: "I'd put the counter under Run details"): the count, the
        calls and the cost, one click away rather than the first thing read. */}
    {!compact && run && (
    <details data-run-details className="mt-2">
      <summary className="cursor-pointer text-label text-[var(--on-surface-variant)]">{t('gc.runDetails')}</summary>
      <div className="mt-2 space-y-1">
        {counter}
        {calls && (
        <p className="text-label text-[var(--on-surface-variant)]">{t('gc.calls', { used: calls.used, cap: calls.cap })}</p>
        )}
        {/* What the run has cost (31 Oct); shown once a priced step has run. */}
        {Number(run.cost_usd ?? 0) > 0 && (
        <p className="text-label text-[var(--on-surface-variant)]">
          {t('cost.run', { cost: shownCost(Number(run.cost_usd)) ?? '' })}
        </p>
        )}
        <p className="text-label text-[var(--on-surface-variant)]">
          {t('gc.explain')}
        </p>
      </div>
    </details>
    )}
    {!compact && !run && (
    <p className="mt-2 text-label text-[var(--on-surface-variant)]">
      {t('gc.explain')}
    </p>
    )}
    {/* 25 Oct (Sean: "Resume, Continue and advancing to the next stage can be
        confusing"): what the button does now, beside it. */}
    {!compact && means && (
    <p className="mt-1 text-label text-[var(--on-surface-variant)]">
      {means}
    </p>
    )}
    </div>
  );
}
