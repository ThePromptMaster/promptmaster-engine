/**
 * A question Go already asked, and was answered, is not asked again while
 * nothing the user did has changed it (4 Nov, Sean, Lakeside proposal). Pure.
 *
 * On production Go asked three times, at 12:11, 12:18 and 12:21, how the
 * notes after section 7 should come out — each time after Sean had answered,
 * each time pointing at the same button — while the run's cost rose from
 * $1.81 to $2.61. Each question ended the run and Resume began a fresh
 * window, so the no-change and no-progress stops, which compare within a
 * window, never saw the repeat. "We also need a guard against repeated
 * questions that make no progress": a repeat now pauses the run once, saying
 * what was asked, what the user answered and what is still open, and spends
 * nothing more until the user acts.
 */
import { isDelegatedAnswer } from '@/lib/workflow/answers';
import { USER_CHOSEN_OPERATIONS } from '@/lib/workflow/fact-reconcile';

import { USER_ANSWER_STEP } from './actions';

/** What the guard reads of a step. */
export interface AskedStep {
  action_key: string;
  stage_id?: string | null;
  decision_question?: string | null;
  output?: string | null;
  params?: Record<string, unknown> | null;
  cost_usd?: number | null;
  started_at?: string | null;
  finished_at?: string | null;
}

/** Shared content words, as a share of the shorter question, above which two questions are one. */
export const SAME_QUESTION = 0.3;

const STOP_WORDS = new Set(
  ('the and that this with from your there they them then than have will would could should which what when where about into only ' +
    'also just more most such each every been being were their once still some other over under after before because while these those ' +
    'here does done like make made need needs want wants onto upon very much many must shall said says asked please whether').split(' ')
);

function stem(word: string): string {
  return word.replace(/(?:ing|ed|es|s)$/, '').replace(/e$/, '');
}

/** The question's own words: its first paragraph, without the pointer to a button or the audit. */
function contentWords(question: string): Set<string> {
  const first = question.split(/\n\s*\n/)[0] ?? '';
  return new Set(
    first
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !STOP_WORDS.has(w))
      .map(stem)
  );
}

/** Shared content words as a share of the shorter question's. */
export function questionOverlap(a: string, b: string): number {
  const A = contentWords(a);
  const B = contentWords(b);
  const fewer = Math.min(A.size, B.size);
  if (!fewer) return 0;
  return [...A].filter((w) => B.has(w)).length / fewer;
}

/** Words that ask the user to approve or re-confirm the work. */
const APPROVAL = /\b(?:approve|approval|re-?confirm|sign off on)\b/i;

/**
 * Whether the question asks for approval: one of the sentences of its first
 * paragraph that ends in "?" does. Not only the first sentence (4 Nov, prod,
 * Lakeside copy: "Section 6 now lists the items to confirm in alphabetical
 * order. Do you approve this version as the finished proposal?" was stopped as
 * a repeat after the revision the user asked for), and never a statement:
 * Sean's notes questions said "please re-approve the proposal" and "Approving
 * the document does not authorise…" around a question about the notes.
 */
export function asksForApproval(question: string): boolean {
  return (question.split(/\n\s*\n/)[0] ?? '')
    .split(/(?<=[.?!])\s+/)
    .some((sentence) => sentence.trim().endsWith('?') && APPROVAL.test(sentence));
}

function controlOf(step: AskedStep): string {
  const c = step.params?.control;
  return typeof c === 'string' ? c.trim().toLowerCase() : '';
}

function questionOf(step: AskedStep): string {
  return (step.decision_question || step.output || '').trim();
}

export interface Repeat {
  /** The earlier question, as asked. */
  asked: string;
  /** What the user answered it. */
  answer: string;
  /** Go's moves on the stage since that answer. */
  moves: number;
  /** What those moves cost, where it is known. */
  spent: number;
  /**
   * It names the same button, in different words (5 Nov, a research project: the
   * pause quoted a convention question from an hour before, when what was left
   * was the user's own check, under the button both questions named).
   */
  byButton: boolean;
  /** The button, as the question named it. */
  control: string;
}

/**
 * The earlier question this one repeats, if any: asked on the same stage,
 * answered by the user, with nothing the user did on that stage since — no
 * version of their own, no fact they added — and either most of its words or
 * the same button named.
 */
export function repeatedQuestion(input: {
  question: string;
  control?: string | null;
  stageId: string;
  steps: readonly AskedStep[];
  versions?: readonly { source_operation: string; created_at: string }[];
  facts?: readonly { created_at: string; accepted_by?: string | null; source_ref?: Record<string, unknown> | null; retired_at?: string | null }[];
}): Repeat | null {
  const { question, stageId, steps } = input;
  if (!question.trim()) return null;
  const control = (input.control ?? '').trim().toLowerCase();
  const userChangedSince = (iso: string) => {
    const at = Date.parse(iso);
    if (Number.isNaN(at)) return true;
    const edited = (input.versions ?? []).some((v) => USER_CHOSEN_OPERATIONS.has(v.source_operation) && Date.parse(v.created_at) > at);
    // An answer to Go's question is recorded as a fact too; that is the answer, not a change.
    const added = (input.facts ?? []).some(
      (f) => !f.retired_at && f.accepted_by === 'user' && f.source_ref?.via !== 'go answer' && Date.parse(f.created_at) > at
    );
    return edited || added;
  };
  // Asking to approve the current version again after Go changed it is the
  // next step, not a repeat: "make it shorter" answered, the shorter version
  // is the one to approve (4 Nov prod pass on the Lakeside copy).
  const approval = asksForApproval(question);
  const newVersionSince = (iso: string) => {
    const at = Date.parse(iso);
    return !Number.isNaN(at) && (input.versions ?? []).some((v) => Date.parse(v.created_at) > at);
  };
  let found: Repeat | null = null;
  steps.forEach((step, i) => {
    if (step.action_key !== 'request_user_decision' || step.stage_id !== stageId) return;
    const answerAt = steps.findIndex((s, j) => j > i && s.action_key === USER_ANSWER_STEP);
    if (answerAt < 0) return;
    const answered = steps[answerAt];
    const answer = (answered.output ?? '').trim();
    if (!answer || userChangedSince(answered.finished_at ?? answered.started_at ?? '')) return;
    if (approval && newVersionSince(step.finished_at ?? step.started_at ?? '')) return;
    // Answered again since in their own words: the answer to a pause. That is new
    // to go on, so the question may be asked once more (5 Nov).
    if (steps.slice(answerAt + 1).some((s) => s.action_key === USER_ANSWER_STEP && (s.output ?? '').trim() && !isDelegatedAnswer(s.output ?? ''))) return;
    const asked = questionOf(step);
    const sameButton = Boolean(control) && controlOf(step) === control;
    const sameWords = questionOverlap(asked, question) >= SAME_QUESTION;
    if (!sameButton && !sameWords) return;
    const since = steps.slice(answerAt + 1).filter((s) => s.stage_id === stageId && s.action_key !== USER_ANSWER_STEP);
    found = {
      asked: asked.split(/\n\s*\n/)[0].trim(),
      answer,
      moves: since.length,
      spent: since.reduce((sum, s) => sum + (Number(s.cost_usd) || 0), 0),
      byButton: !sameWords,
      control: (input.control ?? '').trim(),
    };
  });
  return found;
}

const clip = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
};

/**
 * Why the run paused, once (stop.repeatQuestion). The same shape as the
 * sentence in `messages/areas/stop.ts`, so the screen shows it translated.
 */
export function repeatPause(repeat: Repeat, stageLabel: string, open: string): string {
  const still = clip(open.split(/\n\s*\n/)[0] ?? open, 300);
  const stated = /[.?!…]$/.test(still) ? still : `${still}.`;
  if (repeat.byButton) {
    return (
      `The next step here is yours: "${clip(repeat.control, 200)}". ` +
      `${repeat.moves} moves on ${stageLabel} since your last answer have not changed that, so I have stopped rather than ask again. ` +
      `I was going to ask: ${stated} ` +
      'Nothing more is spent until you act: do that, change the text yourself, or tell me what to do differently here.'
    );
  }
  return (
    `I asked this before — "${clip(repeat.asked, 300)}" — and you answered "${clip(repeat.answer, 200)}". ` +
    `${repeat.moves} moves on ${stageLabel} since then have not settled it, so I have stopped rather than ask you again. ` +
    `Still open: ${stated} ` +
    'Nothing more is spent until you act: change the text yourself, or tell me what to do differently here.'
  );
}
