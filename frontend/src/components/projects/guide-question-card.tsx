'use client';

import { useState } from 'react';

import type { GuideQuestion } from '@/types';
import { AutoGrowTextarea } from '@/components/shared/auto-grow-textarea';
import { INPUT_LIMITS } from '@/lib/projects/input-limits';
import { useT } from '@/lib/i18n/i18n-provider';

/**
 * One "Ask me questions" question: its reason, the suggested answers as chips
 * (one, or several when they combine), an answer of the user's own that
 * becomes a chip like the offered ones, and Answer / Skip / Stop.
 *
 * Asked inside the start conversation, beside the outline (Sean, 31 Oct:
 * "put 'ask question' button in conversation part where outline is"). Give it
 * a `key` per question so the choices start empty for each.
 */
export function GuideQuestionCard({
  question,
  number,
  max,
  foldWhy = false,
  disabled = false,
  onAnswer,
  onSkip,
  onStop,
}: {
  question: GuideQuestion;
  /** Which question this is, from 1. */
  number: number;
  /** The most that will be asked, when there is a cap (Simple). */
  max?: number;
  /** The reason behind "Why this question?" rather than printed under it. */
  foldWhy?: boolean;
  disabled?: boolean;
  onAnswer: (answers: string[]) => void;
  onSkip: () => void;
  onStop: () => void;
}) {
  const t = useT();
  const [picked, setPicked] = useState<string[]>([]);
  const [typed, setTyped] = useState('');
  const [whyOpen, setWhyOpen] = useState(false);

  const toggle = (option: string) =>
    setPicked((prev) =>
      prev.includes(option) ? prev.filter((p) => p !== option) : question.multi ? [...prev, option] : [option]
    );
  const addTyped = () => {
    const text = typed.trim();
    if (!text) return;
    setPicked((prev) => (prev.includes(text) ? prev : question.multi ? [...prev, text] : [text]));
    setTyped('');
  };
  const answers = () => {
    const text = typed.trim();
    if (!text || picked.includes(text)) return picked;
    return question.multi ? [...picked, text] : [text];
  };

  const chip = 'inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-label transition-colors';
  const chipOn = `${chip} bg-[var(--pm-primary)] text-[var(--on-primary)]`;
  const chipOff = `${chip} bg-[var(--surface-container-high)] text-[var(--on-surface)] hover:bg-[var(--surface-container-highest)]`;
  const typedOnly = picked.filter((p) => !question.options.includes(p));

  return (
    <section aria-label={t('guide.question')} className="rounded-xl bg-[var(--surface-container-low)] px-4 py-3">
      {max !== undefined && (
        <p className="mb-1 text-label text-[var(--on-surface-variant)]">{t('guide.questionOf', { number, max })}</p>
      )}
      <h3 className="text-body font-semibold text-[var(--on-surface)]">{question.question}</h3>
      {question.why && !foldWhy && <p className="mt-1 text-label text-[var(--on-surface-variant)]">{question.why}</p>}
      {question.why && foldWhy && (
        <p className="mt-1 text-label text-[var(--on-surface-variant)]">
          <button type="button" aria-expanded={whyOpen} onClick={() => setWhyOpen((o) => !o)} className="underline-offset-4 hover:underline">
            {t('guide.why')}
          </button>
          {whyOpen && <span className="ms-2">{question.why}</span>}
        </p>
      )}

      {question.options.length > 0 && (
        <>
          <p className="mt-3 text-label text-[var(--on-surface-variant)]">
            {question.multi ? t('guide.chooseAny') : t('guide.chooseOne')}
          </p>
          <div role="group" aria-label={t('guide.suggested')} className="mt-1.5 flex flex-wrap gap-2">
            {question.options.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={picked.includes(option)}
                onClick={() => toggle(option)}
                disabled={disabled}
                className={picked.includes(option) ? chipOn : chipOff}
              >
                {option}
              </button>
            ))}
          </div>
        </>
      )}

      {typedOnly.length > 0 && (
        <div aria-label={t('guide.ownAnswers')} className="mt-3 flex flex-wrap gap-2">
          {typedOnly.map((answer) => (
            <span key={answer} className={chipOn}>
              {answer}
              <button
                type="button"
                aria-label={t('guide.removeAnswer', { answer })}
                onClick={() => setPicked((prev) => prev.filter((p) => p !== answer))}
                className="material-symbols-outlined text-[14px] opacity-80 hover:opacity-100"
              >
                close
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <AutoGrowTextarea
          value={typed}
          rows={1}
          onChange={(e) => setTyped(e.target.value.slice(0, INPUT_LIMITS.message))}
          onKeyDown={(e) => {
            // Enter adds the answer as a chip; Shift+Enter starts a new line.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              addTyped();
            }
          }}
          aria-label={t('guide.ownAnswer')}
          placeholder={question.options.length ? t('guide.orType') : t('guide.type')}
          className="min-w-0 flex-1 rounded-lg bg-[var(--surface-container-lowest)] px-3 py-2 text-body text-[var(--on-surface)] outline-none placeholder:text-[var(--on-surface-variant)]/70 focus:ring-2 focus:ring-[var(--pm-primary)]/40"
        />
        <button
          type="button"
          onClick={addTyped}
          disabled={!typed.trim() || disabled}
          className="rounded-lg bg-[var(--surface-container-high)] px-3 py-2 text-label text-[var(--on-surface)] disabled:opacity-40"
        >
          {t('guide.add')}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onAnswer(answers())}
          disabled={disabled || answers().length === 0}
          className="rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-label text-[var(--on-primary)] transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {t('guide.next')}
        </button>
        <button type="button" onClick={onSkip} disabled={disabled} className="px-2 py-2 text-label text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] disabled:opacity-40">
          {t('guide.skip')}
        </button>
        <button type="button" onClick={onStop} disabled={disabled} className="ms-auto px-2 py-2 text-label text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] disabled:opacity-40">
          {t('door.stopAsking')}
        </button>
      </div>
    </section>
  );
}
