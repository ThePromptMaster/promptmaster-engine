'use client';

import { BRIEF_FIELD_LABEL, type BriefField } from '@/lib/workflow/brief-change';
import type { WorkflowEvent } from '@/lib/workflow/types';

/**
 * "Changing this reopened Recommendations for a recheck — it relied on
 * 'funding secured'. [Keep them as they are]" (Sean, 5 Oct). Only while a
 * stage it reopened is still waiting.
 */
export function BriefChangeNotice({
  change,
  stageLabel,
  onKeep,
}: {
  change: { event: WorkflowEvent; stageIds: string[] } | null;
  stageLabel: (id: string) => string;
  onKeep: (changeAt: string) => void;
}) {
  if (!change) return null;
  const { event, stageIds } = change;
  const field = BRIEF_FIELD_LABEL[(event.payload?.field as BriefField) ?? 'objective'] ?? 'brief';
  const affected = (event.payload?.affected as { stage_id: string; reason: string }[] | undefined) ?? [];
  const names = stageIds.map(stageLabel);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  const holds = event.payload?.calculations_hold !== false && event.payload?.kind === 'intent';
  return (
    <div role="status" aria-label="Brief change" className="mb-6 rounded-xl bg-[var(--surface-container-low)] px-5 py-3 text-body text-[var(--on-surface-variant)]">
      <p>
        <span aria-hidden className="material-symbols-outlined mr-1 align-[-4px] text-[18px] text-[var(--pm-tertiary)]">history</span>
        Changing the {field} reopened {list} for a recheck.{' '}
        {holds ? 'Calculations still hold; what was judged against the old priority is reopened. ' : ''}
        Everything else stands.
      </p>
      <ul className="mt-1 list-disc pl-6 text-label">
        {affected.filter((a) => stageIds.includes(a.stage_id)).map((a) => (
          <li key={a.stage_id}>
            {stageLabel(a.stage_id)}: {a.reason}
          </li>
        ))}
      </ul>
      <button
        onClick={() => onKeep(event.created_at)}
        className="mt-2 rounded-lg bg-[var(--surface-container-high)] px-3 py-1.5 text-label text-[var(--on-surface)] hover:opacity-90"
      >
        Keep them as they are
      </button>
    </div>
  );
}
