'use client';

import { AutoGrowTextarea } from '@/components/shared/auto-grow-textarea';
import type { GuideQuestion } from '@/types';

interface Props {
  questions: GuideQuestion[];
  answers: Record<string, string>;
  onAnswer: (id: string, answer: string) => void;
}

/**
 * PM-09 "Guide me — ask me questions". A few questions generated from the
 * objective, each with a one-line reason and clickable example answers
 * ("buttonize it"); every one can be left blank.
 */
export function GuideQuestions({ questions, answers, onAnswer }: Props) {
  return (
    <ol className="space-y-5">
      {questions.map((q, index) => (
        <li key={q.id} className="rounded-2xl bg-[var(--surface-container-lowest)] px-6 py-5">
          <label htmlFor={`guide-${q.id}`} className="block text-title text-[var(--on-surface)]">
            {index + 1}. {q.question}
          </label>
          {q.why && <p className="mt-1 text-label text-[var(--on-surface-variant)]">{q.why}</p>}

          {q.options.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {q.options.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={answers[q.id] === option}
                  onClick={() => onAnswer(q.id, option)}
                  className={`rounded-lg px-3 py-1.5 text-label transition-colors ${
                    answers[q.id] === option
                      ? 'bg-[var(--pm-primary)] text-[var(--on-primary)]'
                      : 'bg-[var(--surface-container-high)] text-[var(--on-surface)] hover:bg-[var(--surface-container-highest)]'
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          )}

          <AutoGrowTextarea
            id={`guide-${q.id}`}
            value={answers[q.id] ?? ''}
            onChange={(e) => onAnswer(q.id, e.target.value)}
            rows={1}
            placeholder="Or answer in your own words — or leave it blank"
            className="mt-3 w-full rounded-lg bg-[var(--surface-container-low)] px-3 py-2 text-body text-[var(--on-surface)] outline-none placeholder:text-[var(--on-surface-variant)]/70 focus:ring-2 focus:ring-[var(--pm-primary)]/40"
          />
        </li>
      ))}
    </ol>
  );
}
