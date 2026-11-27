/**
 * One word on where the project stands, and the deliverable's four separate
 * states (8 Nov: "document generation, validation, approval and final
 * readiness need distinct statuses"). Pure, and read from `outstandingWork`,
 * which stays the authority on what is open (L-163).
 */

import { blocksCompletion, type OutstandingItem } from './engine';

export type OverallStatus = 'in_progress' | 'repair_failed' | 'stale_dependency' | 'needs_decision' | 'complete' | 'finished_actions_open';

export function overallStatus(input: {
  outstanding: readonly OutstandingItem[];
  finalized: boolean;
  /** Go's repairs of a stage failed and it is waiting on the user. */
  repairFailed: boolean;
  /** Go has stopped and is waiting on the user. */
  waitingOnUser: boolean;
  /** Real-world actions the document left open (`project_tasks`, origin system). */
  openActions: number;
  allStagesDone: boolean;
}): OverallStatus {
  const finished = () => (input.openActions > 0 ? 'finished_actions_open' : 'complete');
  if (input.finalized) return finished();
  if (input.repairFailed) return 'repair_failed';
  if (input.outstanding.some((i) => i.kind === 'stale_stage')) return 'stale_dependency';
  if (input.waitingOnUser) return 'needs_decision';
  if (input.allStagesDone && !input.outstanding.some(blocksCompletion)) return finished();
  return 'in_progress';
}

export interface ReadinessRow {
  key: 'written' | 'checked' | 'approved' | 'ready';
  /** `none`: this deliverable has nothing of the kind to give. */
  state: 'done' | 'open' | 'none';
  /** The version this holds for. */
  version?: number;
  /** The earlier version it holds for, when the stage has moved on. */
  earlier?: number;
  /** Why it isn't ready, in the words of the outstanding list. */
  detail?: string;
  /** Ready waits for a check of the current version: the check of `earlier` found problems. */
  recheck?: boolean;
}

/**
 * What holds the deliverable's "Ready" (28 Nov, Sean, Harborlight; L-326):
 * what holds finishing, and what the latest check of its current version says
 * against it. "I ran Check this stage. It correctly found 36 seats and a
 * four-seat shortfall, but the readiness panel still showed Ready." A check's
 * verdict does not hold up "Finish project" (`blocksCompletion`), but a version
 * its own check faults is not ready — the transition bar and Go's move-on gate
 * already read it so.
 */
export function readinessBlocking(
  outstanding: readonly OutstandingItem[],
  checkSays: { stageId: string; label: string; says: string } | null
): OutstandingItem[] {
  const own: OutstandingItem[] = checkSays ? [{ kind: 'check_says', ...checkSays }] : [];
  return [...own, ...outstanding.filter(blocksCompletion)];
}

export function deliverableReadiness(input: {
  versions: readonly { id: string; version_number: number }[];
  /** The latest objective check: what it said and which version it read. */
  assessment?: { outcome: string; versionId?: string | null } | null;
  /** Versions with a stored check of their own. */
  evaluatedVersionIds: ReadonlySet<string>;
  /** The user's own approvals on this stage. */
  approvals: readonly { id: string; satisfied: boolean }[];
  /** Which version each approval was given on. */
  approvalVersions: Readonly<Record<string, string>>;
  /** What still holds finishing up, already in words. */
  blocking: readonly string[];
  /**
   * The version whose check found problems, when it is the latest one checked
   * and the current version is newer (L-326): Ready waits for the current one
   * to be checked.
   */
  faultedEarlier?: number;
}): ReadinessRow[] {
  const head = input.versions.at(-1);
  const numberOf = (id?: string | null) => input.versions.find((v) => v.id === id)?.version_number;
  const written: ReadinessRow = head ? { key: 'written', state: 'done', version: head.version_number } : { key: 'written', state: 'open' };

  const checkedOn = input.assessment?.outcome === 'met' ? numberOf(input.assessment.versionId) : undefined;
  const evaluated = [...input.versions].reverse().find((v) => input.evaluatedVersionIds.has(v.id))?.version_number;
  const latestCheck = Math.max(checkedOn ?? 0, evaluated ?? 0);
  const checked: ReadinessRow = !head || latestCheck === 0
    ? { key: 'checked', state: 'open' }
    : latestCheck === head.version_number
      ? { key: 'checked', state: 'done', version: latestCheck }
      : { key: 'checked', state: 'open', earlier: latestCheck, version: head.version_number };

  let approved: ReadinessRow;
  if (!input.approvals.length) approved = { key: 'approved', state: 'none' };
  else if (!input.approvals.every((a) => a.satisfied)) approved = { key: 'approved', state: 'open' };
  else {
    const given = input.approvals.map((a) => numberOf(input.approvalVersions[a.id]));
    const oldest = Math.min(...given.map((n) => n ?? 0));
    approved = head && oldest === head.version_number
      ? { key: 'approved', state: 'done', version: oldest }
      : { key: 'approved', state: 'open', ...(oldest > 0 ? { earlier: oldest } : {}), version: head?.version_number };
  }

  // 28 Nov (Sean, Harborlight): "stay out of Ready once the check finds a
  // contradiction, until the corrected version is saved and checked". A fix
  // saved after a failed check is not ready until it is checked itself.
  const awaitsCheck = checked.state === 'open' && checked.earlier !== undefined && input.faultedEarlier === checked.earlier;
  const ready: ReadinessRow = written.state === 'done' && approved.state !== 'open' && input.blocking.length === 0 && !awaitsCheck
    ? { key: 'ready', state: 'done', version: head?.version_number }
    : input.blocking[0]
      ? { key: 'ready', state: 'open', detail: input.blocking[0] }
      : awaitsCheck
        ? { key: 'ready', state: 'open', recheck: true, earlier: checked.earlier, version: head?.version_number }
        : { key: 'ready', state: 'open' };

  return [written, checked, approved, ready];
}
