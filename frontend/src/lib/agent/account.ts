/**
 * The short account of a Go run (Q3c). Pure, and derived from the step
 * record — never written by a model.
 *
 * Sean, 9 Oct: "The main experience should be: give it a goal or question,
 * press Go, and receive a short account of what it did, what it is doing
 * next, or exactly why it paused. The detailed stages, evidence, and history
 * remain available underneath." And: "A resource-window pause should
 * preserve progress and be distinguished from a technical blocker or
 * completion."
 */

import type { AgentRun, AgentStep } from '@/types/agent';
import { actionFor, actionLabel, ROUTINE_DEFAULT_STEP, USER_ANSWER_STEP } from './actions';
import { questionOverlap, SAME_QUESTION } from './repeat-question';
import { translate, type Vars } from '@/lib/i18n/translate';
import type { Locale } from '@/lib/i18n/locales';
import { shownStopReason } from '@/lib/i18n/stop-reasons';
import { shownActionLabel } from '@/lib/i18n/go';
import { describeNeed, isClearedNote, type NeedsUser } from './needs';

export type PauseKind = 'working' | 'window' | 'blocker' | 'decision' | 'complete' | 'stopped';

export interface RunAccount {
  /** "Ran 3 computations in the sandbox; derived 1 result; …", or '' before anything was done. */
  did: string;
  kind: PauseKind;
  /** What it is doing now, or exactly why it paused. */
  now: string;
  /** What it set aside rather than stop for, each in a line. */
  setAside: string[];
}

function firstSentence(text: string): string {
  const t = text.trim().split('\n')[0];
  const m = /^(.{20,}?[.?!])\s/.exec(`${t} `);
  return (m ? m[1] : t).slice(0, 300);
}

/**
 * Whether the user has answered this kept question since it was set aside: the
 * same words, asked at a later step, with an answer after it. A run told "do
 * whatever is best" went on listing the question as kept for the user after it
 * had settled it (6 Nov, production).
 */
function answeredSince(steps: readonly AgentStep[], from: number, kept: string): boolean {
  const later = steps.slice(from);
  return later.some((s, i) =>
    s.action_key === 'request_user_decision' &&
    questionOverlap(s.decision_question || s.output || '', kept) >= SAME_QUESTION &&
    later.slice(i + 1).some((a) => a.action_key === USER_ANSWER_STEP)
  );
}

/** A question Go set aside for the user rather than stop for, still unanswered. */
export interface KeptQuestion { stepId: string; stageId: string; question: string; choices: string[] }

/**
 * The questions set aside in these steps that nobody has answered since (12
 * Nov). They were listed in the run's account and never asked again: "asked
 * once the work has nowhere further to go, or at the end" was the intent, and
 * nothing did it. `answeredElsewhere` names the steps a recorded answer covers
 * (an answer given from the list of what is waiting, kept on its fact).
 */
export function keptQuestions(steps: readonly AgentStep[], answeredElsewhere: ReadonlySet<string> = new Set()): KeptQuestion[] {
  const out: KeptQuestion[] = [];
  const seen = new Set<string>();
  steps.forEach((s, i) => {
    const question = typeof s.params?.set_aside_question === 'string' ? s.params.set_aside_question.trim() : '';
    if (!question || answeredElsewhere.has(s.id) || answeredSince(steps, i, question)) return;
    const key = question.toLowerCase().replace(/\s+/g, ' ').slice(0, 160);
    if (seen.has(key)) return;
    seen.add(key);
    const choices = Array.isArray(s.params?.choices) ? (s.params.choices as unknown[]).filter((c): c is string => typeof c === 'string' && Boolean(c.trim())).slice(0, 4) : [];
    out.push({ stepId: s.id, stageId: s.stage_id, question: question.slice(0, 600), choices });
  });
  return out;
}

/** Whether a repair closed its stage. A step from before this was recorded says so in its own words. */
function closedItsStage(s: AgentStep): boolean {
  return s.changes?.stage_closed ?? /marked complete again|your approval carries/.test(s.output ?? '');
}

/**
 * The account in the interface's language (client, 21 Oct: "pick your
 * language"). It is derived on every render and never stored; the stop
 * reason it quotes is recorded in English and shown translated where Go wrote
 * it in code (`shownStopReason`).
 */
export function runAccount(
  run: AgentRun | null,
  steps: readonly AgentStep[],
  stageLabel: (id: string) => string,
  locale: Locale = 'en',
  /** A stage's English name, as the screen says it: for the names inside a recorded reason. */
  stageByEnglish?: (english: string) => string
): RunAccount | null {
  if (!run) return null;
  const t = (key: string, vars?: Vars) => translate(locale, key, vars);
  const ok = steps.filter((s) => s.status === 'succeeded');
  const executed = ok.filter((s) => s.execution_label === 'code_executed' || s.execution_label === 'simulation_run').length;
  const derived = ok.filter((s) => actionFor(s.action_key)?.performer === 'reason').length;
  const lookups = ok.filter((s) => s.action_key === 'check_literature').length;
  // What each stage's last repair came to. "Repaired" means the stage closed
  // again: a repair saved with its stage still reopened, or one that failed its
  // check, was reported as repaired (8 Nov, production: the run's summary said
  // repaired while the latest repair of the plan had failed).
  const lastRepair = new Map<string, AgentStep>();
  for (const s of steps) {
    if (s.action_key !== 'recheck_stage' || s.params?.measured || s.params?.cut) continue;
    if (s.status !== 'succeeded' && s.status !== 'failed') continue;
    const id = String(s.params?.stage_id ?? s.stage_id ?? '');
    if (id) lastRepair.set(id, s);
  }
  const repairsThat = (came: (s: AgentStep) => boolean) => [...lastRepair].filter(([, s]) => came(s)).map(([id]) => id);
  const repaired = repairsThat((s) => s.status === 'succeeded' && closedItsStage(s));
  const repairedOpen = repairsThat((s) => s.status === 'succeeded' && !closedItsStage(s));
  const repairFailed = repairsThat((s) => s.status === 'failed');
  // 11 Oct: shortening a brief to its limit is not "a repair after a change".
  const fitted = new Set(ok.filter((s) => s.action_key === 'recheck_stage' && s.params?.measured).map((s) => String(s.params?.stage_id ?? s.stage_id ?? '')));
  const written = new Set(
    ok.filter((s) => ['draft_stage', 'revise_stage', 'apply_findings', 'draft_sections', 'revise_sections'].includes(s.action_key) && s.stage_id).map((s) => s.stage_id!)
  );
  const returns = ok.filter((s) => s.action_key === 'return_to_stage');
  const parts = [
    executed ? t('acct.computations', { count: executed }) : '',
    derived ? t('acct.derived', { count: derived }) : '',
    lookups ? t('acct.lookups', { count: lookups }) : '',
    written.size ? t('acct.wrote', { stages: [...written].map(stageLabel).join(', ') }) : '',
    repaired.length ? t('acct.repaired', { stages: repaired.map(stageLabel).join(', ') }) : '',
    repairedOpen.length ? t('acct.repairOpen', { stages: repairedOpen.map(stageLabel).join(', ') }) : '',
    repairFailed.length ? t('acct.repairFailed', { stages: repairFailed.map(stageLabel).join(', ') }) : '',
    fitted.size ? t('acct.fitted', { stages: [...fitted].filter(Boolean).map(stageLabel).join(', ') }) : '',
    returns.length
      ? t('acct.returns', { count: returns.length, stages: returns.map((s) => stageLabel(String(s.params?.stage_id ?? ''))).join(', ') })
      : '',
  ].filter(Boolean);
  const did = parts.length ? `${parts.join('; ')}.`.replace(/^./, (c) => c.toUpperCase()) : '';

  // Each said once: a question Go set aside at three steps running was listed three times (12 Nov).
  const setAside = [...new Set([
    ...steps
      .filter((s, i) => typeof s.params?.set_aside_question === 'string' && !answeredSince(steps, i, String(s.params!.set_aside_question)))
      .map((s) => t('acct.questionKept', { question: String(s.params!.set_aside_question).slice(0, 300) })),
    ...steps.filter((s) => typeof s.changes?.set_aside === 'string').map((s) => t('acct.couldNot', { what: String(s.changes!.set_aside) })),
    ...steps.filter((s) => s.action_key === ROUTINE_DEFAULT_STEP && s.status === 'succeeded').map((s) => firstSentence(s.output).replace(/^Routine default taken by Go under your routine-decision policy \(yours to change\): /, t('acct.routine'))),
  ])];

  // Read as recorded (English); said as shown.
  const reason = run.stop_reason?.trim() ?? '';
  const shown = shownStopReason(locale, reason, stageByEnglish);
  const current = steps.at(-1);
  switch (run.status) {
    case 'running':
      return {
        did, kind: 'working', setAside,
        now: current?.status === 'running'
          ? current.stage_id
            ? t('acct.doingNowOn', { action: (locale === 'en' ? actionLabel(current.action_key) : shownActionLabel(current.action_key, locale)), stage: stageLabel(current.stage_id) })
            : t('acct.doingNow', { action: (locale === 'en' ? actionLabel(current.action_key) : shownActionLabel(current.action_key, locale)) })
          : t('acct.choosing'),
      };
    case 'budget_exhausted':
      return { did, kind: 'window', now: t('acct.window'), setAside };
    case 'blocked':
      // A loop stop is not a missing tool or missing data (Sean, 10 Oct, email 7.6:
      // "distinguish a step-budget pause from a technical block and from project completion").
      if (/^Going round in circles: /.test(reason)) {
        const why = locale === 'en' ? reason.replace(/^Going round in circles: /, '') : shown.replace(/^[^:]+: /, '');
        return { did, kind: 'blocker', now: t('acct.circles', { why: firstSentence(why) }), setAside };
      }
      return { did, kind: 'blocker', now: t('acct.cantContinue', { why: firstSentence(shown) || t('acct.missing') }), setAside };
    case 'awaiting_decision':
      // The decision itself, not the stop's statement (11 Oct: "Your decision
      // is needed" over a sentence that asked nothing).
      // A cleared request asks nothing (15 Oct screenshot: "Your decision is
      // needed: That is done. Press Resume and I will carry on.").
      if (!run.needs && isClearedNote(reason)) return { did, kind: 'decision', now: shown, setAside };
      return { did, kind: 'decision', now: t('acct.decision', { what: decisionAsked(run.needs ?? null, shown, stageLabel, locale) }), setAside };
    case 'completed':
      // What was deferred is said with the finish, not counted as resolved (10 Oct, 6.6).
      return {
        did, kind: 'complete', setAside,
        now: /objective (?:is )?met/i.test(reason)
          ? `${t('acct.met')}${reason.match(/ Deferred, not blocking[\s\S]*$/)?.[0] ?? ''}`
          : t('acct.finished', { why: firstSentence(shown) || t('acct.nothingLeft') }),
      };
    case 'failed':
      return { did, kind: 'blocker', now: t('acct.error', { why: firstSentence(shown) || t('acct.seeRecord') }), setAside };
    default:
      return { did, kind: 'stopped', now: t('acct.stopped'), setAside };
  }
}

/** What the user is asked to decide, in one line: the request's own buttons when it has them. */
function decisionAsked(need: NeedsUser | null, reason: string, stageLabel: (id: string) => string, locale: Locale): string {
  if (need && need.kind !== 'answer_question') {
    const d = describeNeed(need, stageLabel, {}, locale);
    const choices = d.options?.map((o) => o.label) ?? (d.action ? [d.action] : []);
    if (choices.length) return `${choices.map((c) => `“${c}”`).join(translate(locale, 'acct.or'))}. ${firstSentence(d.message)}`;
  }
  return firstSentence(reason) || translate(locale, 'acct.seeBelow');
}
