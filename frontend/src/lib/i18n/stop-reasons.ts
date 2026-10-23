import { AGENT_ACTIONS, actionLabel, AWAIT_SECTIONS_STEP, INTERPRET_STEP, ROUTINE_DEFAULT_STEP, USER_ANSWER_STEP } from '@/lib/agent/actions';
import type { Locale } from './locales';
import { en as stopEn } from './messages/areas/stop';
import { DICTIONARIES, translate } from './translate';

/**
 * A Go run's stop reason in the interface's language (client, 21 Oct: "pick
 * your language"). The run records the English — `account.ts`, `objective.ts`
 * and the planner read it back — so this recognises each reason Go writes in
 * code by its shape, from the very sentences in `messages/areas/stop.ts`, and
 * shows that sentence translated. Anything else (a question the model asked,
 * a step's own first line) comes back as written: it follows the project's
 * Writes in language, not the screen's.
 */

type StopKey = keyof typeof stopEn;

const ESCAPE = /[.*+?^${}()|[\]\\]/g;

/** "Waiting for your approval: {action}." → a regex with a named group per placeholder. */
function pattern(english: string): RegExp {
  const source = english
    .split(/(\{\w+\})/)
    .map((part) => {
      const m = /^\{(\w+)\}$/.exec(part);
      return m ? `(?<${m[1]}>.+?)` : part.replace(ESCAPE, '\\$&');
    })
    .join('');
  return new RegExp(`^${source}$`);
}

// The fixed ones first, then the longer shapes before the shorter: "Going
// round in circles" has four.
const SHAPES: { key: StopKey; re: RegExp }[] = (Object.keys(stopEn) as StopKey[])
  .filter((k) => k !== 'stop.aDecision' && k !== 'stop.resumeCheck')
  .sort((a, b) => stopEn[b].length - stopEn[a].length)
  .map((key) => ({ key, re: pattern(stopEn[key]) }));

/** An action's English name, back to the name the screen gives it. */
function shownAction(locale: Locale, english: string): string {
  const dict = DICTIONARIES[locale] as Record<string, string>;
  const special: Record<string, string> = {
    [INTERPRET_STEP]: 'goAction.interpret',
    [USER_ANSWER_STEP]: 'goAction.userAnswer',
    [AWAIT_SECTIONS_STEP]: 'goAction.awaitSections',
    [ROUTINE_DEFAULT_STEP]: 'goAction.routineDefault',
  };
  for (const key of [...AGENT_ACTIONS.map((a) => a.key), ...Object.keys(special)]) {
    if (actionLabel(key) !== english) continue;
    const k = special[key] ?? `goAction.${key}`;
    return k in dict ? translate(locale, k) : english;
  }
  return english;
}

export function shownStopReason(locale: Locale, reason: string, stageLabel?: (english: string) => string): string;
export function shownStopReason(locale: Locale, reason: string | null | undefined, stageLabel?: (english: string) => string): string | null | undefined;
export function shownStopReason(
  locale: Locale,
  reason: string | null | undefined,
  stageLabel: (english: string) => string = (s) => s
): string | null | undefined {
  if (!reason || locale === 'en') return reason;
  for (const { key, re } of SHAPES) {
    const m = re.exec(reason);
    if (!m) continue;
    const vars: Record<string, string> = { ...(m.groups ?? {}) };
    for (const name of ['action', 'a', 'b'] as const) if (vars[name]) vars[name] = shownAction(locale, vars[name]);
    for (const name of ['stage', 'was', 'now'] as const) if (vars[name]) vars[name] = stageLabel(vars[name]);
    return translate(locale, key, vars);
  }
  return reason;
}

/**
 * What Go is waiting for, as the outstanding list says it (`goWaitingLine`):
 * its stop reason, "a decision from you", or "resume Go to check the
 * objective again" — each in the interface's language.
 */
export function shownGoWaiting(locale: Locale, line: string | null, stageLabel?: (english: string) => string): string | null {
  if (!line || locale === 'en') return line;
  if (line === stopEn['stop.aDecision']) return translate(locale, 'stop.aDecision');
  if (line === stopEn['stop.resumeCheck']) return translate(locale, 'stop.resumeCheck');
  return shownStopReason(locale, line, stageLabel);
}
