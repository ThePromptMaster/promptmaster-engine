/**
 * Whether Go has anything to do while an approval on one stage waits (4 Nov).
 * Pure.
 *
 * Sean: "I also tried 'Carry on with other work first' and ended up back at
 * the same approval." The button resumed the run, but the approval stop is
 * raised only when nothing else on the stage is left, so it came straight
 * back. It is offered now only when another stage holds work Go can do itself:
 * a stage awaiting a recheck after a change, or a draft whose latest check
 * Go would revise. Otherwise the card says nothing else can go ahead.
 */
import type { OutstandingItem } from '@/lib/workflow/engine';

const GO_CAN_DO: ReadonlySet<OutstandingItem['kind']> = new Set(['stale_stage', 'check_says']);

export function otherWorkFor(outstanding: readonly OutstandingItem[], stageId: string): boolean {
  return outstanding.some((i) => 'stageId' in i && i.stageId !== stageId && GO_CAN_DO.has(i.kind));
}
