'use client';

import { MarkdownOutput } from '@/components/shared/markdown-output';
import type { Commentary, ToolKind } from './use-stage-tools';

const RUNNING_LABEL: Record<ToolKind, string> = {
  continue: 'Continuing the draft…',
  drift_alert: 'Realigning to the objective…',
  refine_shorter: 'Making it shorter…',
  refine_concrete: 'Making it more concrete…',
  refine_technical: 'Making it more technical…',
  refine_cautious: 'Making it more cautious…',
  refine_angle: 'Trying a different angle…',
  challenge: 'Building the case against this draft…',
  reframe: 'Looking at it another way…',
  self_audit: 'Running the Cold Critic self-audit…',
};

interface Props {
  running: ToolKind | null;
  error: string | null;
  commentary: Commentary | null;
  onDismiss: () => void;
}

/**
 * What a stage tool is doing, or what it said (PM-10).
 *
 * Rewrites land as a new version in the version bar, so all this shows for
 * them is progress. Critiques are commentary about the draft and are shown
 * here in full, beside it — they never replace it.
 */
export function StageToolResult({ running, error, commentary, onDismiss }: Props) {
  if (running) {
    return (
      <div role="status" className="mb-6 flex items-center gap-3 rounded-xl bg-[var(--surface-container-low)] px-5 py-3">
        <span
          aria-hidden
          className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--pm-primary)] border-t-transparent"
        />
        <span className="text-body text-[var(--on-surface-variant)]">{RUNNING_LABEL[running]}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="mb-6 flex items-start gap-3 rounded-xl bg-[var(--error-container)] px-5 py-3">
        <p className="flex-1 text-body text-[var(--on-error-container)]">{error}</p>
        <button onClick={onDismiss} className="text-label text-[var(--on-error-container)] underline">
          Dismiss
        </button>
      </div>
    );
  }

  if (!commentary) return null;

  return (
    <section aria-label={commentary.title} className="mb-6 rounded-xl bg-[var(--surface-container-low)] px-6 py-5">
      <header className="mb-3 flex items-center gap-2">
        <span aria-hidden className="material-symbols-outlined text-[var(--pm-primary)]">
          forum
        </span>
        <h3 className="flex-1 text-title text-[var(--on-surface)]">{commentary.title}</h3>
        <button
          onClick={onDismiss}
          className="rounded-lg px-3 py-1.5 text-label text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)] hover:text-[var(--on-surface)]"
        >
          Close
        </button>
      </header>
      <p className="mb-3 text-label text-[var(--on-surface-variant)]">
        Commentary on your draft — nothing has been changed. Use the side chat&apos;s Instruct mode to act on any of it.
      </p>
      <MarkdownOutput content={commentary.text} />
    </section>
  );
}
