/**
 * Written, checked, approved, and done in the world: one line on a stage when they differ (L-321).
 *
 * Sean, 27 Nov: "I'm also wondering what Complete means at the stage level. Is the draft finished,
 * has the current version passed its checks, has the user approved it, or has the actual work
 * happened? The museum test made that distinction pretty clear. The revised records could be
 * finished while the replacement shipment was still open. I'd like the UI to make that easy to see
 * whenever those statuses differ." Pure.
 */

import type { ProjectTask } from '@/lib/supabase/tasks';
import type { StageDefinition, WorkflowEvent } from './types';

export interface StageStatusSummary {
  written: number;
  /** The newest version a check covered: the stage check, or Go's re-confirmation after a change. */
  checked: number | null;
  /** The version the user's own approval is on; null when none is given. */
  approved: number | null;
  /** Real-world actions this stage still asks for (open tasks), the first few. */
  openInWorld: string[];
  openMore: number;
}

export function stageStatusSummary(input: {
  stage: Pick<StageDefinition, 'id' | 'exit_criteria'>;
  versions: readonly { id: string; version_number: number }[];
  /** Completed stage checks by version id (failed ones left out by the caller). */
  checkedVersionIds: ReadonlySet<string>;
  events: readonly Pick<WorkflowEvent, 'type' | 'stage_id' | 'payload'>[];
  manualChecks: Readonly<Record<string, boolean>> | null | undefined;
  manualCheckVersions: Readonly<Record<string, string>> | null | undefined;
  /** Open tasks to act on now (`currentTasks(...).actionable`). */
  actionable: readonly ProjectTask[];
}): StageStatusSummary | null {
  const head = input.versions.at(-1);
  if (!head) return null;
  const numberOf = (id: unknown) => input.versions.find((v) => v.id === id)?.version_number;
  const checkedNumbers = [
    ...input.versions.filter((v) => input.checkedVersionIds.has(v.id)).map((v) => v.version_number),
    ...input.events
      .filter((e) => e.type === 'criterion_committed' && e.stage_id === input.stage.id && e.payload?.reconfirmed === true)
      .map((e) => numberOf(e.payload?.evidence_version_id))
      .filter((n): n is number => typeof n === 'number'),
  ];
  const checked = checkedNumbers.length ? Math.max(...checkedNumbers) : null;
  const reserved = input.stage.exit_criteria.filter((c) => c.check === 'manual' && c.authority !== 'delegable' && input.manualChecks?.[c.id]);
  const approvedNumbers = reserved.map((c) => numberOf(input.manualCheckVersions?.[c.id])).filter((n): n is number => typeof n === 'number');
  const approved = approvedNumbers.length ? Math.min(...approvedNumbers) : null;
  const open = input.actionable.filter((t) => t.origin === 'system' && t.stage === input.stage.id).map((t) => t.title);
  const line: StageStatusSummary = { written: head.version_number, checked, approved, openInWorld: open.slice(0, 2), openMore: Math.max(0, open.length - 2) };
  const differs = (checked !== null && checked !== line.written) || (approved !== null && approved !== line.written) || open.length > 0;
  return differs ? line : null;
}
