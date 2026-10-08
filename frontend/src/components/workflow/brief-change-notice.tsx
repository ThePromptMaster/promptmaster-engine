'use client';

import { BRIEF_FIELD_LABEL, type WatchedField } from '@/lib/workflow/brief-change';
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
  onUpdate,
  updating = false,
}: {
  change: { event: WorkflowEvent; stageIds: string[] } | null;
  stageLabel: (id: string) => string;
  onKeep: (changeAt: string) => void;
  /**
   * "Update affected work and resume" (Sean, 7 Oct, TeamNotes): Go repairs
   * every reopened stage in order, re-checks each, then carries on. Absent
   * where Go cannot run.
   */
  onUpdate?: () => void;
  updating?: boolean;
}) {
  if (!change) return null;
  const { event, stageIds } = change;
  if (event.type === 'stage_version_saved') {
    const names = stageIds.map(stageLabel);
    const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
    const n = event.payload?.version_number;
    return (
      <div role="status" aria-label="Brief change" className="mb-6 rounded-xl bg-[var(--surface-container-low)] px-5 py-3 text-body text-[var(--on-surface-variant)]">
        <p>
          <span aria-hidden className="material-symbols-outlined mr-1 align-[-4px] text-[18px] text-[var(--pm-tertiary)]">history</span>
          {stageLabel(event.stage_id)} was revised{typeof n === 'number' ? ` (now v${n})` : ''}, so {list} {stageIds.length === 1 ? 'was' : 'were'} reopened
          for a recheck: {stageIds.length === 1 ? 'it was' : 'they were'} built on the earlier version. Earlier versions stay in each stage&apos;s history.
        </p>
        <Actions onUpdate={onUpdate} updating={updating} onKeep={() => onKeep(event.created_at)} />
      </div>
    );
  }
  const field = BRIEF_FIELD_LABEL[(event.payload?.field as WatchedField) ?? 'objective'] ?? 'brief';
  const affected = (event.payload?.affected as { stage_id: string; reason: string }[] | undefined) ?? [];
  const names = stageIds.map(stageLabel);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  // Only where something was computed: on a project with no calculations the
  // sentence would describe nothing (production, 6 Oct).
  const holds = event.payload?.calculations_hold !== false && event.payload?.kind === 'intent' && event.payload?.had_computed === true;
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
      <Actions onUpdate={onUpdate} updating={updating} onKeep={() => onKeep(event.created_at)} />
    </div>
  );
}

function Actions({ onUpdate, updating, onKeep }: { onUpdate?: () => void; updating: boolean; onKeep: () => void }) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {onUpdate && (
        <button
          onClick={onUpdate}
          disabled={updating}
          className="rounded-lg bg-[var(--pm-primary)] px-3 py-1.5 text-label text-[var(--on-primary)] hover:opacity-90 disabled:opacity-50"
        >
          {updating ? 'Updating affected work…' : 'Update affected work and resume'}
        </button>
      )}
      <button
        onClick={onKeep}
        className="rounded-lg bg-[var(--surface-container-high)] px-3 py-1.5 text-label text-[var(--on-surface)] hover:opacity-90"
      >
        Keep them as they are
      </button>
    </div>
  );
}
