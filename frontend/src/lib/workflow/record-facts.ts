import { currentFacts } from './facts';
import type { ProjectFact } from '@/types/project';
import type { ReplyAction } from '@/types';

/**
 * Recording facts from the side chat, once (Sean, 14 Oct, SUMMIT: "I clicked
 * 'Record these 8 facts' several times because it kept appearing and I
 * couldn't tell whether it had worked"). The same eight statements were stored
 * three times in 83 seconds.
 *
 * What is already recorded is never inserted again, and an action whose facts
 * are all on record reads as done. That is derived from the facts themselves,
 * so it holds after a reload and for a re-suggested button as well.
 */

type ActionFact = NonNullable<ReplyAction['facts']>[number];

/** Same words and figures, whatever the punctuation, case or spacing. */
export function normStatement(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}$%]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

export interface FactRecordingPlan {
  /** New facts. */
  insert: ActionFact[];
  /** New values for facts on record: recorded as superseding them, so history keeps was and now. */
  supersede: { old: ProjectFact; fact: ActionFact }[];
  /** How many were already on record and are left alone. */
  already: number;
}

export function planFactRecording(facts: readonly ActionFact[], recorded: readonly ProjectFact[] | undefined): FactRecordingPlan {
  const current = currentFacts(recorded);
  const known = new Set(current.map((f) => normStatement(f.statement)));
  const byStatement = new Map(current.map((f) => [normStatement(f.statement), f]));
  const plan: FactRecordingPlan = { insert: [], supersede: [], already: 0 };
  const taken = new Set<string>();
  for (const fact of facts) {
    const key = normStatement(fact.statement);
    if (!key) continue;
    if (known.has(key)) {
      plan.already += 1;
      continue;
    }
    known.add(key);
    const old = fact.replaces ? byStatement.get(normStatement(fact.replaces)) : undefined;
    // One new value per old fact: a second would supersede a retired row.
    if (old && !taken.has(old.id)) {
      taken.add(old.id);
      plan.supersede.push({ old, fact });
    } else {
      plan.insert.push(fact);
    }
  }
  return plan;
}

/** Every fact this action offers is on record: its button has done its job. */
export function factsAlreadyRecorded(action: ReplyAction, recorded: readonly ProjectFact[] | undefined): boolean {
  if (action.kind !== 'record_facts' || !action.facts?.length) return false;
  const known = new Set(currentFacts(recorded).map((f) => normStatement(f.statement)));
  return action.facts.every((f) => known.has(normStatement(f.statement)));
}
