/**
 * Open tasks an objective check recorded that the work has since moved past
 * (27 Nov, production pass, ops plan). Each check adds the real-world actions it
 * finds (`recordOpenActions`), and nothing took one back. After three delivery
 * date changes "Carried forward" held "confirm a receiving contact before
 * Tuesday, March 30" beside "…before Tuesday, April 6", and a placeholder address
 * the user had already ruled out. Sean, 25 Nov: the user should not have to find
 * stale recommendations themselves.
 *
 * A task is stale when the stage it was drawn from has a version newer than the
 * task, and either that version no longer states a date the task names, or no
 * stage holds a [placeholder] the task names. A task with neither ("tell Harbor
 * at least 7 days before its booking starts") is kept: nothing here can tell it
 * has passed. Pure.
 */

import type { ProjectTask } from '@/lib/supabase/tasks';
import { factValues } from '@/lib/workflow/fact-values';

/** Each stage's current text and when it was saved; a stage left out is never judged. */
export type StageTexts = Readonly<Record<string, { text: string; at: string } | undefined>>;

const PLACEHOLDER = /\[[^\]\n]{3,80}\]/g;

export function staleTasks(tasks: readonly ProjectTask[], stages: StageTexts): ProjectTask[] {
  const everything = Object.values(stages).map((s) => s?.text ?? '').join('\n');
  return tasks.filter((t) => {
    if (t.status !== 'open' || t.origin !== 'system' || !t.stage) return false;
    const now = stages[t.stage];
    if (!now?.text.trim() || !(Date.parse(now.at) > Date.parse(t.created_at))) return false;
    const stated = new Set(factValues(now.text).dates);
    if (factValues(t.title).dates.some((d) => !stated.has(d))) return true;
    return (t.title.match(PLACEHOLDER) ?? []).some((p) => !everything.includes(p));
  });
}
