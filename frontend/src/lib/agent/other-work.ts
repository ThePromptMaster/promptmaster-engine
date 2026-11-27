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

export const GO_CAN_DO: ReadonlySet<OutstandingItem['kind']> = new Set(['stale_stage', 'check_says']);

/**
 * What Go goes on to by itself under "handle them for me" before calling the objective met: the
 * work above, and deciding open findings (27 Nov, production passes: payroll i9 "Treat i1 to i3 …
 * as superseded" and museum i8, whose change the records already carried out, each stopped the run
 * as "the work is not finished" although triage decides the first and the decision question records
 * the second). Triage puts to the user only what is theirs, with what each answer changes.
 */
export const GO_DOES_UNDER_HANDLE: ReadonlySet<OutstandingItem['kind']> = new Set([...GO_CAN_DO, 'open_findings']);

/** Whether everything still open is work Go does itself: no item waits on the user (26 Nov). */
export function onlyGoWorkLeft(open: readonly OutstandingItem[], kinds: ReadonlySet<OutstandingItem['kind']> = GO_CAN_DO): boolean {
  return open.length > 0 && open.every((i) => kinds.has(i.kind) && !('optional' in i && i.optional));
}

export function otherWorkFor(outstanding: readonly OutstandingItem[], stageId: string): boolean {
  return outstanding.some((i) => 'stageId' in i && i.stageId !== stageId && GO_CAN_DO.has(i.kind));
}
