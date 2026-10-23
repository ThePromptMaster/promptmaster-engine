'use client';

import { shownActionLabel } from '@/lib/i18n/go';
import { useT } from '@/lib/i18n/i18n-provider';
import { useState } from 'react';

import { MarkdownOutput } from '@/components/shared/markdown-output';
import { DiffText, useWordDiff } from '@/components/workflow/revised-preview';
import type { AgentStep } from '@/types/agent';
import type { AnswerContradiction } from '@/lib/api/client';

/** The run is waiting on the user: approve this move, or decline it. */
export function DecisionPrompt({
  step,
  stale = false,
  label,
  effect,
  onApprove,
  onReplan,
  onDecline,
}: {
  step: AgentStep;
  /** Proposed before the stage last changed: its reasons may no longer hold. */
  stale?: boolean;
  /** The step's name on its stage (`stepActionLabel`). */
  label?: string;
  /** What approving it does, from the code (`whatApprovalDoes`). */
  effect?: string | null;
  onApprove: () => void;
  onReplan?: () => void;
  onDecline: () => void;
}) {
  const t = useT();
  return (
    <section aria-label={t('dp.label')} className="rounded-xl bg-[var(--surface-container-highest)] px-5 py-4">
      <p className="text-label uppercase tracking-wide text-[var(--on-surface-variant)]">{t('dp.next')}</p>
      <p className="mt-1 text-title text-[var(--on-surface)]">{label ?? shownActionLabel(step.action_key)}</p>
      {effect && <p data-effect className="mt-1 text-body text-[var(--on-surface)]">{t('dp.does')}{effect}</p>}
      {step.decision_question && <p className="mt-1 text-body text-[var(--on-surface)]">{step.decision_question}</p>}
      {step.rationale && <p className="mt-1 text-body text-[var(--on-surface-variant)]">{t('dp.why')}{step.rationale}</p>}
      {step.expected_outcome && (
        <p className="mt-1 text-label text-[var(--on-surface-variant)]">{t('dp.expects')}{step.expected_outcome}</p>
      )}
      {stale && (
        <p role="status" className="mt-2 text-label text-[var(--pm-tertiary)]">
          {t('dp.stale')}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        {stale && onReplan ? (
          <button onClick={onReplan} className="rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-title text-[var(--on-primary)]">
            {t('dp.proposeAgain')}
          </button>
        ) : (
          <button onClick={onApprove} className="rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-title text-[var(--on-primary)]">
            {t('dp.approve')}
          </button>
        )}
        <button onClick={onDecline} className="rounded-lg px-4 py-2 text-title text-[var(--on-surface-variant)]">
          {t('dp.decline')}
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
  expertPackage,
  choices = [],
  change,
}: {
  question: string;
  /**
   * The stage's latest version came from applied findings: what it changed,
   * shown beside the question (19 Oct, Research › Method — Go asked which
   * version should go forward and could not say what the newer one changed).
   */
  change?: LatestChange;
  /** One-click answers (13 Oct, Sean: "which version should govern" was a typed answer). */
  choices?: string[];
  /** Q3a: the package prepared for an expert's review, as markdown. */
  expertPackage?: string;
  /** With the contradiction the user chose to record the answer over (L-65). */
  onAnswer: (text: string, contradicted?: AnswerContradiction) => void;
  /** Reads the answer against the saved record first; null when nothing contradicts it. */
  checkAnswer?: (text: string) => Promise<AnswerContradiction | null>;
  /** Approvals the question asks for, offered as the tick itself (4 Oct). */
  approvals?: { id: string; label: string }[];
  onTick?: (approval: { id: string; label: string }) => Promise<void>;
}) {
  const t = useT();
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
    <section aria-label={t('qp.label')} className="rounded-xl bg-[var(--surface-container-highest)] px-5 py-4">
      <p className="text-label uppercase tracking-wide text-[var(--on-surface-variant)]">{t('qp.asks')}</p>
      <p className="mt-1 text-body text-[var(--on-surface)]">{question}</p>
      {change && <WhatChanged change={change} />}
      {expertPackage && <ExpertPackageCard markdown={expertPackage} />}
      {choices.length > 0 && (
        <div aria-label={t('qp.answers')} className="mt-3 flex flex-wrap gap-2">
          {choices.map((c) => (
            <button
              key={c}
              type="button"
              disabled={checking}
              onClick={() => onAnswer(c)}
              className="rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-left text-title text-[var(--on-primary)] disabled:opacity-60"
            >
              {c}
            </button>
          ))}
        </div>
      )}
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
                  .catch((e) => setTickError(e instanceof Error && e.message ? e.message : t('qp.tickFailed')))
                  .finally(() => setTicking(null));
              }}
              className="flex items-center gap-2 rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-left text-title text-[var(--on-primary)] disabled:opacity-60"
            >
              <span aria-hidden className="material-symbols-outlined text-[20px]">check_box</span>
              {ticking === a.id ? t('qp.recording') : t('qp.tick', { label: a.label })}
            </button>
          ))}
          <span className="text-label text-[var(--on-surface-variant)]">
            {t('qp.tickNote')}
          </span>
          {tickError && <span role="alert" className="text-label text-[var(--pm-error)]">{tickError}</span>}
        </div>
      )}
      {contradiction && (
        <div role="alert" aria-label={t('qp.disagree')} className="mt-3 rounded-lg bg-[var(--surface-container-lowest)] px-4 py-3">
          <p className="text-label uppercase tracking-wide text-[var(--on-surface-variant)]">{t('qp.disagree')}</p>
          {contradiction.claim && <p className="mt-1 text-body text-[var(--on-surface)]">{t('qp.yourAnswerSays')}{contradiction.claim}</p>}
          <p className="mt-1 text-body text-[var(--on-surface)]">
            {contradiction.document}{contradiction.version ? ` (v${contradiction.version})` : ''}{t('qp.says')}<q>{contradiction.quote}</q>
          </p>
          {contradiction.explanation && <p className="mt-1 text-label text-[var(--on-surface-variant)]">{contradiction.explanation}</p>}
          <p className="mt-2 text-label text-[var(--on-surface-variant)]">
            {t('qp.becomesFact')}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onAnswer(text, contradiction)}
              className="rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-label text-[var(--on-primary)]"
            >
              {t('qp.recordAnyway')}
            </button>
            <button
              type="button"
              onClick={() => setContradiction(null)}
              className="rounded-lg bg-[var(--surface-container-high)] px-4 py-2 text-label text-[var(--on-surface)]"
            >
              {t('qp.edit')}
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
        aria-label={t('qp.answerLabel')}
        placeholder={choices.length ? t('qp.orElse') : t('qp.answerHint')}
        className="mt-3 w-full resize-none rounded-lg bg-[var(--surface-container-lowest)] px-3 py-2 text-body text-[var(--on-surface)] outline-none"
      />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          onClick={() => void submit()}
          disabled={!text.trim() || checking || contradiction !== null}
          className="rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-title text-[var(--on-primary)] disabled:opacity-40"
        >
          {checking ? t('qp.checking') : t('qp.answerContinue')}
        </button>
        <span className="text-label text-[var(--on-surface-variant)]">
          {t('qp.orChange')}
        </span>
      </div>
    </section>
  );
}

/**
 * Q3a (Sean, 9 Oct): "PromptMaster should prepare a concise package containing
 * the question, assumptions, derivation or computation, evidence, unresolved
 * issue, and specific judgment requested." Shown with the question, to copy
 * or download and send to whoever can judge it.
 */
function ExpertPackageCard({ markdown }: { markdown: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const download = () => {
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'expert-review.md';
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    // Closed and rendered (Sean, 10 Oct, email 7.3: raw "## Question" and
    // "## Assumptions" in the main view). The copy and download keep the markdown.
    <details aria-label={t('qp.packageLabel')} className="mt-3 rounded-lg bg-[var(--surface-container-lowest)] px-4 py-3">
      <summary className="cursor-pointer text-label text-[var(--on-surface-variant)]">
        {t('qp.package')}
      </summary>
      <div className="mt-2 max-h-80 overflow-auto">
        <MarkdownOutput content={markdown} />
      </div>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => void navigator.clipboard?.writeText(markdown).then(() => setCopied(true))}
          className="flex items-center gap-1 rounded-lg bg-[var(--surface-container-high)] px-3 py-1.5 text-label text-[var(--on-surface)]"
        >
          <span aria-hidden className="material-symbols-outlined text-[18px]">content_copy</span>
          {copied ? t('qp.copied') : t('qp.copy')}
        </button>
        <button
          type="button"
          onClick={download}
          className="flex items-center gap-1 rounded-lg bg-[var(--surface-container-high)] px-3 py-1.5 text-label text-[var(--on-surface)]"
        >
          <span aria-hidden className="material-symbols-outlined text-[18px]">download</span>
          {t('qp.download')}
        </button>
      </div>
    </details>
  );
}

export interface LatestChange {
  stageLabel: string;
  version: number;
  previous: number;
  before: string;
  after: string;
  summary: string;
}

/** What the newest version changed against the one before, in place. */
function WhatChanged({ change }: { change: LatestChange }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const { parts, added, removed } = useWordDiff(change.before, change.after);
  return (
    <div aria-label={t('qp.changedLabel')} className="mt-3 rounded-lg bg-[var(--surface-container)] px-4 py-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-left text-title text-[var(--on-surface)]"
      >
        <span>
          {t('qp.changed', { stage: change.stageLabel, version: change.version, previous: change.previous })} ·{' '}
          <span className="text-[var(--pm-success)]">{t('qp.added', { count: added })}</span> ·{' '}
          <span className="text-[var(--pm-error)]">{t('qp.removed', { count: removed })}</span>
        </span>
        <span aria-hidden className="material-symbols-outlined text-[20px]">{open ? 'expand_less' : 'expand_more'}</span>
      </button>
      {change.summary && <p className="mt-1 text-label text-[var(--on-surface-variant)]">{change.summary}</p>}
      {open && <DiffText parts={parts} testId="what-changed-diff" className="mt-2 max-h-[40vh]" />}
    </div>
  );
}
