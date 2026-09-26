'use client';

import Link from 'next/link';

interface Props {
  onReopen: () => void;
}

/**
 * Shown in place of the transition bar once the project is finished (PM-03).
 *
 * Finishing used to change nothing visible, so the button looked broken. Now
 * the project says it is done, says where it went, and offers the way back —
 * finishing is a status, not a lock, and everything stays readable.
 */
export function ProjectFinishedBanner({ onReopen }: Props) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-3 rounded-xl bg-[var(--surface-container-low)] px-5 py-4"
    >
      <span aria-hidden className="material-symbols-outlined text-[var(--pm-primary)]">
        task_alt
      </span>
      <div className="mr-auto">
        <p className="text-title text-[var(--on-surface)]">This project is finished</p>
        <p className="text-label text-[var(--on-surface-variant)]">
          It now appears under Finished on your projects page. Every stage and version is still here.
        </p>
      </div>
      <div className="flex gap-2">
      <Link
        href="/projects"
        className="rounded-lg px-3 py-2 text-title text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)] hover:text-[var(--on-surface)]"
      >
        All projects
      </Link>
      <button
        onClick={onReopen}
        className="rounded-lg bg-[var(--surface-container-highest)] px-4 py-2 text-title text-[var(--on-surface)] hover:opacity-90"
      >
        Reopen
      </button>
      </div>
    </div>
  );
}
