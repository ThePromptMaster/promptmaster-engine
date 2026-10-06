'use client';

import type { WorkflowEvent } from '@/lib/workflow/types';
import type { ArtifactVersion } from '@/types/project';

/**
 * Revisions the commit check refused since the current version was saved
 * (G1; Sean, 5 Oct: "the failed attempt should remain visible in history").
 * Each says what tried to save and why it did not; the current version is
 * named so nobody wonders whether it changed.
 */
export function refusedSince(events: readonly WorkflowEvent[], stageId: string, head: ArtifactVersion | null): WorkflowEvent[] {
  const since = head ? Date.parse(head.created_at) : 0;
  return events.filter(
    (e) => e.type === 'revision_refused' && e.stage_id === stageId && Date.parse(e.created_at) >= since
  );
}

export function RefusedRevisions({ refused, head }: { refused: readonly WorkflowEvent[]; head: ArtifactVersion | null }) {
  if (!refused.length) return null;
  const latest = refused.at(-1)!;
  const byGo = latest.actor === 'system';
  return (
    <div role="status" aria-label="Refused revision" className="mb-4 flex items-start gap-2 rounded-lg bg-[var(--surface-container-low)] px-4 py-2.5 text-body text-[var(--on-surface-variant)]">
      <span aria-hidden className="material-symbols-outlined text-[18px] text-[var(--pm-tertiary)]">block</span>
      <span>
        {byGo ? 'Go mode’s revision was refused' : 'A revision was refused'}: {latest.reason ?? 'it did not pass the check'}.
        {head ? ` v${head.version_number} stays current.` : ''}
        {refused.length > 1 ? ` (${refused.length} refused since it was saved.)` : ''}
      </span>
    </div>
  );
}
