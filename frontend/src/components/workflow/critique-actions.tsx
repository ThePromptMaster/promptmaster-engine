'use client';

/**
 * After a critique, the easy actions (PM-22). Sean, Sep 10: "After critique,
 * I want easy actions such as: Apply recommended fixes; Apply selected fixes;
 * Review individually; Show revised version first." And "buttonize it": every
 * point is its own button.
 *
 * One component for both places critique appears — the stage check's findings
 * and a Challenge / Reframe / Self-audit — so they behave identically. It
 * never applies anything itself: it says which points, and whether to show the
 * revision first; use-apply-findings does the rest.
 */

import { useState } from 'react';

export interface ActionablePoint {
  id: string;
  text: string;
  /** What to do about it, when the critique said. */
  change?: string;
  /** The critique's explanation of the point. */
  detail?: string;
  /** The section of the critique it came from. */
  group?: string;
}

interface Props {
  title: string;
  points: ActionablePoint[];
  busy: boolean;
  onApply: (ids: string[], showFirst: boolean) => void;
}

export function CritiqueActions({ title, points, busy, onApply }: Props) {
  const [selected, setSelected] = useState<string[]>([]);
  const [showFirst, setShowFirst] = useState(true);
  const [reviewing, setReviewing] = useState(false);

  if (points.length === 0) return null;
  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => (on ? [...new Set([...prev, id])] : prev.filter((x) => x !== id)));

  return (
    <section aria-label={title} className="rounded-xl bg-[var(--surface-container-low)] px-5 py-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-title text-[var(--on-surface)]">{title}</h3>
        <label className="flex items-center gap-2 text-label text-[var(--on-surface-variant)]">
          <input
            type="checkbox"
            checked={showFirst}
            onChange={(e) => setShowFirst(e.target.checked)}
            className="h-4 w-4 accent-[var(--pm-primary)]"
          />
          Show the revised version first
        </label>
      </header>

      <ul className="mt-3 space-y-2">
        {points.map((p, i) => (
          <li key={p.id} className="flex items-start gap-3 rounded-lg bg-[var(--surface-container-lowest)] px-4 py-2.5">
            <input
              type="checkbox"
              checked={selected.includes(p.id)}
              onChange={(e) => toggle(p.id, e.target.checked)}
              aria-label={`Select: ${p.text}`}
              className="mt-1 h-4 w-4 shrink-0 accent-[var(--pm-primary)]"
            />
            <div className="min-w-0 flex-1">
              {p.group && p.group !== points[i - 1]?.group && (
                <p className="text-label uppercase tracking-wide text-[var(--on-surface-variant)]">{p.group}</p>
              )}
              <p className="text-body text-[var(--on-surface)]">{p.text}</p>
              {p.detail && <p className="text-label text-[var(--on-surface-variant)]">{p.detail}</p>}
              {p.change && <p className="text-label text-[var(--on-surface-variant)]">Fix: {p.change}</p>}
            </div>
            <button
              onClick={() => onApply([p.id], showFirst)}
              disabled={busy}
              aria-label={`Apply: ${p.text}`}
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--pm-primary)]/10 px-3 py-1 text-label font-medium text-[var(--pm-primary)] hover:bg-[var(--pm-primary)]/20 disabled:opacity-40"
            >
              <span aria-hidden className="material-symbols-outlined text-[16px]">auto_fix_high</span>
              Apply
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => onApply(points.map((p) => p.id), showFirst)}
          disabled={busy}
          className="rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-label font-medium text-[var(--on-primary)] disabled:opacity-40"
        >
          {points.length === 1 ? 'Apply the recommended fix' : `Apply all ${points.length} recommended fixes`}
        </button>
        <button
          onClick={() => onApply(selected, showFirst)}
          disabled={busy || selected.length === 0}
          className="rounded-lg bg-[var(--surface-container-highest)] px-4 py-2 text-label font-medium text-[var(--on-surface)] disabled:opacity-40"
        >
          Apply selected{selected.length ? ` (${selected.length})` : ''}
        </button>
        <button
          onClick={() => setReviewing(true)}
          disabled={busy}
          className="rounded-lg bg-[var(--surface-container-highest)] px-4 py-2 text-label font-medium text-[var(--on-surface)] disabled:opacity-40"
        >
          Review one by one
        </button>
      </div>
      <p className="mt-2 text-label text-[var(--on-surface-variant)]">
        Every fix makes a new version; the current one stays in history.
      </p>

      {reviewing && (
        <ReviewOneByOne
          points={points}
          onDone={(ids) => {
            setReviewing(false);
            if (ids.length) onApply(ids, showFirst);
          }}
          onCancel={() => setReviewing(false)}
        />
      )}
    </section>
  );
}

/** "Review individually": one point at a time — keep it or skip it — then apply the kept ones together. */
function ReviewOneByOne({
  points,
  onDone,
  onCancel,
}: {
  points: ActionablePoint[];
  onDone: (ids: string[]) => void;
  onCancel: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [kept, setKept] = useState<string[]>([]);
  const finished = index >= points.length;
  const point = points[Math.min(index, points.length - 1)];

  const decide = (keep: boolean) => {
    setKept((prev) => (keep ? [...prev.filter((x) => x !== point.id), point.id] : prev.filter((x) => x !== point.id)));
    setIndex((i) => i + 1);
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Review one by one" className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 py-16">
      <div className="w-full max-w-[620px] rounded-2xl bg-[var(--surface-container)] px-7 py-6 shadow-2xl">
        {!finished ? (
          <>
            <p className="text-label uppercase tracking-wide text-[var(--on-surface-variant)]">
              Point {index + 1} of {points.length}
            </p>
            {point.group && <p className="mt-2 text-label uppercase tracking-wide text-[var(--on-surface-variant)]">{point.group}</p>}
            <p className="mt-2 text-body text-[var(--on-surface)]">{point.text}</p>
            {point.detail && <p className="mt-1 text-label text-[var(--on-surface-variant)]">{point.detail}</p>}
            {point.change && <p className="mt-1 text-label text-[var(--on-surface-variant)]">Fix: {point.change}</p>}
            <div className="mt-5 flex flex-wrap gap-2">
              <button onClick={() => decide(true)} className="rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-title text-[var(--on-primary)]">
                Apply this
              </button>
              <button onClick={() => decide(false)} className="rounded-lg bg-[var(--surface-container-highest)] px-4 py-2 text-title text-[var(--on-surface)]">
                Skip
              </button>
              {index > 0 && (
                <button onClick={() => setIndex((i) => i - 1)} className="rounded-lg px-3 py-2 text-title text-[var(--on-surface-variant)]">
                  Back
                </button>
              )}
              <button onClick={onCancel} className="ml-auto rounded-lg px-3 py-2 text-title text-[var(--on-surface-variant)]">
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-title text-[var(--on-surface)]">
              {kept.length === 0 ? 'Nothing kept' : `${kept.length} of ${points.length} to apply`}
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-body text-[var(--on-surface)]">
              {points.filter((p) => kept.includes(p.id)).map((p) => (
                <li key={p.id}>{p.text}</li>
              ))}
            </ul>
            <div className="mt-5 flex gap-2">
              <button
                onClick={() => onDone(kept)}
                disabled={kept.length === 0}
                className="rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-title text-[var(--on-primary)] disabled:opacity-40"
              >
                Apply {kept.length || ''} {kept.length === 1 ? 'fix' : 'fixes'}
              </button>
              <button onClick={() => setIndex(0)} className="rounded-lg px-3 py-2 text-title text-[var(--on-surface-variant)]">
                Start over
              </button>
              <button onClick={onCancel} className="ml-auto rounded-lg px-3 py-2 text-title text-[var(--on-surface-variant)]">
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
