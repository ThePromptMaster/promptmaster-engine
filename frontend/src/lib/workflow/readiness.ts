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

  const ready: ReadinessRow = written.state === 'done' && approved.state !== 'open' && input.blocking.length === 0
    ? { key: 'ready', state: 'done', version: head?.version_number }
    : { key: 'ready', state: 'open', ...(input.blocking[0] ? { detail: input.blocking[0] } : {}) };

  return [written, checked, approved, ready];
}
