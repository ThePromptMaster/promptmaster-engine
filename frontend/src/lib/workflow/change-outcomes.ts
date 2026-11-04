/**
 * What became of each stage a change reopened (4 Nov, Sean: "After a change,
 * show which stages were affected, which were updated, which were rechecked,
 * and which still have open findings"). Pure.
 *
 * The settled notice said "{stages} updated → Checked again", which only meant
 * each stage was finished again after the change. This reads, for each, the
 * version that finished it, who made it, and what the check on that version
 * found — or, for a table, how many of its findings are still undecided.
 */
import { isFailedEvaluation } from './evaluation-failure';
import type { StageDefinition } from './types';

export interface ChangeOutcome {
  stageId: string;
  /** The version made after the change; null when the stage was finished again as it was. */
  version: number | null;
  by: 'go' | 'you' | null;
  /** clean / findings: a check ran on that version; not_checked: none did; table: a findings table; none: a plain table, with nothing to decide. */
  check: 'clean' | 'findings' | 'not_checked' | 'table' | 'none';
  /** Findings the check noted, or a table's undecided rows. */
  count: number;
}

type VersionLike = { id: string; version_number: number; created_at: string; source_operation?: string | null };
type EvaluationLike = { failed?: boolean | null; findings?: readonly unknown[] | null; alignment_explanation?: string | null; drift_explanation?: string | null; clarity_explanation?: string | null };

export function changeOutcomes(
  stageIds: readonly string[],
  since: string,
  stages: readonly Pick<StageDefinition, 'id' | 'renderer'>[],
  versionsOf: (stageId: string) => readonly VersionLike[],
  evaluations: Readonly<Record<string, EvaluationLike>> | undefined,
  undecidedRows: (stageId: string) => number
): ChangeOutcome[] {
  return stageIds.map((stageId) => {
    const stage = stages.find((s) => s.id === stageId);
    const after = versionsOf(stageId).filter((v) => v.created_at > since);
    const last = after.at(-1) ?? null;
    const version = last?.version_number ?? null;
    const by = last ? ((last.source_operation ?? '').startsWith('agent_') ? 'go' : 'you') : null;
    // A findings table says how many are undecided; a plain table (facts, figures) has nothing to decide (4 Nov, prod pass).
    if (stage && stage.renderer === 'review') return { stageId, version, by, check: 'table', count: undecidedRows(stageId) };
    if (stage && stage.renderer !== 'prose' && stage.renderer !== 'long_form') return { stageId, version, by, check: 'none', count: 0 };
    const latest = versionsOf(stageId).at(-1);
    const ev = latest ? evaluations?.[latest.id] : undefined;
    if (!ev || isFailedEvaluation(ev)) return { stageId, version, by, check: 'not_checked', count: 0 };
    const n = ev.findings?.length ?? 0;
    return { stageId, version, by, check: n ? 'findings' : 'clean', count: n };
  });
}
