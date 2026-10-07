'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/lib/api/client';
import type { GuideQuestion } from '@/types';
import { AutoGrowTextarea } from '@/components/shared/auto-grow-textarea';
import { INPUT_LIMITS } from '@/lib/projects/input-limits';

export interface GuideAnswered {
  question: GuideQuestion;
  /** What the user chose or typed. Empty when the question was skipped. */
  answers: string[];
}

/** What is sent on: the question and its answers as one line. Skipped questions are left out. */
export function answersForSetup(answered: readonly GuideAnswered[]): { question: string; answer: string }[] {
  return answered
    .map((a) => ({ question: a.question.question, answer: a.answers.join('; ') }))
    .filter((a) => a.answer.trim());
}

/**
 * "Guide me", one question at a time (1 Oct, item 9).
 *
 * The earlier version was a form: three to five questions written before any
 * was answered, one answer each. Here each question is asked after the last
 * is answered, so it can follow up; a question whose options can combine
 * takes several; an answer typed in becomes a chip like the offered ones and
 * can be removed; and the user can stop at any point with what they have
 * given — PromptMaster also stops by itself once it has enough.
 */
export function GuideInterview({
  objective,
  material = '',
  busy = false,
  onDone,
  onBack,
}: {
  objective: string;
  /** What was attached on the start screen, so no question asks what it says. */
  material?: string;
  /** The setup is being worked out from the answers. */
  busy?: boolean;
  onDone: (answers: { question: string; answer: string }[]) => void;
  onBack: () => void;
}) {
  const [answered, setAnswered] = useState<GuideAnswered[]>([]);
  const [current, setCurrent] = useState<GuideQuestion | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [typed, setTyped] = useState('');
  const [loading, setLoading] = useState(true);
  const [enough, setEnough] = useState<string | null>(null);
  const started = useRef(false);

  const ask = useCallback(
    async (soFar: GuideAnswered[]) => {
      setLoading(true);
      setPicked([]);
      setTyped('');
      try {
        const res = await api.guideNextQuestion({
          objective,
          ...(material ? { material } : {}),
          answered: soFar.map((a) => ({ question: a.question.question, answer: a.answers.join('; ') })),
        });
        if (res.enough || !res.question) {
          setCurrent(null);
          setEnough(res.reason || 'That is enough to set this up.');
          onDone(answersForSetup(soFar));
        } else setCurrent(res.question);
      } catch (e) {
        // Not being able to ask more is a reason to go on with what there is —
        // but the reason is said: a refused answer is not "no more questions".
        setCurrent(null);
        const why = e instanceof Error && e.message ? ` (${e.message})` : '';
        setEnough(`I could not get another question${why}, so I will go on with what you have told me.`);
        onDone(answersForSetup(soFar));
      } finally {
        setLoading(false);
      }
    },
    [objective, material, onDone]
  );

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void ask([]);
  }, [ask]);

  const toggle = (option: string) =>
    setPicked((prev) =>
      prev.includes(option) ? prev.filter((p) => p !== option) : current?.multi ? [...prev, option] : [option]
    );
  const addTyped = () => {
    const text = typed.trim();
    if (!text) return;
    setPicked((prev) => (prev.includes(text) ? prev : current?.multi ? [...prev, text] : [text]));
    setTyped('');
  };
  const next = (answers: string[]) => {
    if (!current) return;
    const soFar = [...answered, { question: current, answers }];
    setAnswered(soFar);
    void ask(soFar);
  };
  /** Take an answer back out of an earlier question. */
  const removeEarlier = (index: number, answer: string) =>
    setAnswered((prev) => prev.map((a, i) => (i === index ? { ...a, answers: a.answers.filter((x) => x !== answer) } : a)));

  const chip = 'inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-label transition-colors';
  const chipOn = `${chip} bg-[var(--pm-primary)] text-[var(--on-primary)]`;
  const chipOff = `${chip} bg-[var(--surface-container-high)] text-[var(--on-surface)] hover:bg-[var(--surface-container-highest)]`;
  const typedOnly = picked.filter((p) => !current?.options.includes(p));
  const stopping = busy || Boolean(enough);

  return (
    <div>
      {answered.length > 0 && (
        <ol aria-label="Your answers so far" className="mb-5 space-y-3">
          {answered.map((a, index) => (
            <li key={a.question.id} className="rounded-xl bg-[var(--surface-container-low)] px-5 py-3">
              <p className="text-label text-[var(--on-surface-variant)]">{index + 1}. {a.question.question}</p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {a.answers.length === 0 && <span className="text-label text-[var(--on-surface-variant)]">Skipped</span>}
                {a.answers.map((answer) => (
                  <span key={answer} className={chipOn}>
                    {answer}
                    {!stopping && (
                      <button
                        type="button"
                        aria-label={`Remove "${answer}"`}
                        onClick={() => removeEarlier(index, answer)}
                        className="material-symbols-outlined text-[14px] opacity-80 hover:opacity-100"
                      >
                        close
                      </button>
                    )}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ol>
      )}

      {loading && (
        <p role="status" className="rounded-2xl bg-[var(--surface-container-lowest)] px-6 py-5 text-body text-[var(--on-surface-variant)]">
          {answered.length === 0 ? 'Thinking of the first question…' : 'Thinking of the next question…'}
        </p>
      )}

      {!loading && current && (
        <section aria-label="Question" className="rounded-2xl bg-[var(--surface-container-lowest)] px-6 py-5">
          <h2 className="text-title text-[var(--on-surface)]">{answered.length + 1}. {current.question}</h2>
          {current.why && <p className="mt-1 text-label text-[var(--on-surface-variant)]">{current.why}</p>}

          {current.options.length > 0 && (
            <>
              <p className="mt-3 text-label text-[var(--on-surface-variant)]">
                {current.multi ? 'Choose any that apply.' : 'Choose one.'}
              </p>
              <div role="group" aria-label="Suggested answers" className="mt-1.5 flex flex-wrap gap-2">
                {current.options.map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={picked.includes(option)}
                    onClick={() => toggle(option)}
                    className={picked.includes(option) ? chipOn : chipOff}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </>
          )}

          {typedOnly.length > 0 && (
            <div aria-label="Your own answers" className="mt-3 flex flex-wrap gap-2">
              {typedOnly.map((answer) => (
                <span key={answer} className={chipOn}>
                  {answer}
                  <button
                    type="button"
                    aria-label={`Remove "${answer}"`}
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
                // Enter answers; Shift+Enter starts a new line in a long answer.
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  addTyped();
                }
              }}
              aria-label="Your own answer"
              placeholder={current.options.length ? 'Or type your own answer' : 'Type your answer'}
              className="min-w-0 flex-1 rounded-lg bg-[var(--surface-container-low)] px-3 py-2 text-body text-[var(--on-surface)] outline-none placeholder:text-[var(--on-surface-variant)]/70 focus:ring-2 focus:ring-[var(--pm-primary)]/40"
            />
            <button
              type="button"
              onClick={addTyped}
              disabled={!typed.trim()}
              className="rounded-lg bg-[var(--surface-container-high)] px-3 py-2 text-label text-[var(--on-surface)] disabled:opacity-40"
            >
              Add
            </button>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => next(typed.trim() && !picked.includes(typed.trim()) ? (current.multi ? [...picked, typed.trim()] : [typed.trim()]) : picked)}
              disabled={picked.length === 0 && !typed.trim()}
              className="rounded-xl bg-[var(--pm-primary)] px-5 py-2.5 text-title text-[var(--on-primary)] transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              Next question
            </button>
            <button type="button" onClick={() => next([])} className="px-2 py-2.5 text-body text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]">
              Skip this one
            </button>
          </div>
        </section>
      )}

      {enough && (
        <p role="status" className="rounded-2xl bg-[var(--surface-container-lowest)] px-6 py-5 text-body text-[var(--on-surface)]">
          {enough} {busy ? 'Working out a setup…' : ''}
        </p>
      )}

      <div className="mt-8 flex flex-wrap items-center gap-3">
        {!enough && (
          <button
            type="button"
            onClick={() => {
              const withCurrent = current && picked.length ? [...answered, { question: current, answers: picked }] : answered;
              setEnough('Going on with what you have told me.');
              setCurrent(null);
              onDone(answersForSetup(withCurrent));
            }}
            disabled={busy || loading}
            className="rounded-xl bg-[var(--surface-container-highest)] px-5 py-2.5 text-title text-[var(--on-surface)] hover:opacity-90 disabled:opacity-40"
          >
            That&apos;s enough — recommend a setup
          </button>
        )}
        <button type="button" onClick={onBack} disabled={busy} className="px-3 py-2.5 text-body text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]">
          Back
        </button>
      </div>
    </div>
  );
}
