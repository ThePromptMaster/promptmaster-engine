'use client';

import { tr } from '@/lib/i18n/store';
import { useLocale, useT } from '@/lib/i18n/i18n-provider';
import type { MessageKey } from '@/lib/i18n/messages/en';
import { BRIEF_FIELD_LABEL, type OpenChange, type WatchedField } from '@/lib/workflow/brief-change';
import type { WorkflowEvent } from '@/lib/workflow/types';

/**
 * "Changing this reopened Recommendations for a recheck — it relied on
 * 'funding secured'. [Keep them as they are]" (Sean, 5 Oct). Only while a
 * stage it reopened is still waiting.
 */
/** A changed brief field's name in the interface's language (English keeps BRIEF_FIELD_LABEL). */
const FIELD_KEY: Record<WatchedField, MessageKey> = {
  objective: 'brief.field.objective',
  audience: 'brief.field.audience',
  constraints: 'brief.field.constraints',
  output_format: 'brief.field.output_format',
  context: 'setup.context',
  facts: 'facts.title',
};

export function BriefChangeNotice({
  change,
  stageLabel,
  onKeep,
  onUpdate,
  updating = false,
  judging = false,
  settled = null,
  onDismissSettled,
}: {
  change: OpenChange | null;
  stageLabel: (id: string) => string;
  onKeep: (changeAt: string) => void;
  /**
   * "Update affected work and resume" (Sean, 7 Oct, TeamNotes): Go repairs
   * every reopened stage in order, re-checks each, then carries on. Absent
   * where Go cannot run.
   */
  onUpdate?: () => void;
  updating?: boolean;
  /** A change is saved and what it affects is still being worked out. */
  judging?: boolean;
  /** The last change, once everything it reopened is finished again. */
  settled?: { event: WorkflowEvent; stageIds: string[] } | null;
  onDismissSettled?: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  if (!change) {
    if (judging) {
      return (
        <div role="status" aria-label={t('bcn.label')} className="mb-6 rounded-xl bg-[var(--surface-container-low)] px-5 py-3 text-body text-[var(--on-surface-variant)]">
          <Steps first={t('bcn.saved')} second={t('bcn.checking')} third={t('bcn.updatedChecked')} at={1} />
        </div>
      );
    }
    if (!settled) return null;
    const names = settled.stageIds.map(stageLabel);
    return (
      <div role="status" aria-label={t('bcn.label')} className="mb-6 flex flex-wrap items-center gap-3 rounded-xl bg-[var(--surface-container-low)] px-5 py-3 text-body text-[var(--on-surface-variant)]">
        <Steps first={firstStep(settled.event)} second={t('bcn.namesUpdated', { names: listOf(names) })} third={t('bcn.checkedAgain')} at={3} />
        {onDismissSettled && (
          <button onClick={onDismissSettled} className="ml-auto text-label text-[var(--pm-primary)] hover:underline">
            {t('bcn.dismiss')}
          </button>
        )}
      </div>
    );
  }
  const { event, stageIds } = change;
  const waiting = (
    <>
      <Steps first={firstStep(event)} second={updating ? t('bcn.updating') : t('bcn.awaiting', { count: stageIds.length + (change.alsoWaiting?.length ?? 0) })} third={t('bcn.updatedChecked')} at={2} />
      {change.alsoWaiting?.length ? (
        <p className="mt-1 text-label">{t('bcn.alsoWaiting', { names: listOf(change.alsoWaiting.map(stageLabel)) })}</p>
      ) : null}
    </>
  );
  if (change.reasons) {
    const names = stageIds.map(stageLabel);
    return (
      <div role="status" aria-label={t('bcn.label')} className="mb-6 rounded-xl bg-[var(--surface-container-low)] px-5 py-3 text-body text-[var(--on-surface-variant)]">
        {waiting}
        <p className="mt-2">
          <span aria-hidden className="material-symbols-outlined mr-1 align-[-4px] text-[18px] text-[var(--pm-tertiary)]">history</span>
          {t('bcn.needsRecheck', { count: stageIds.length, names: listOf(names) })}
        </p>
        <ul className="mt-1 list-disc pl-6 text-label">
          {stageIds.map((id) => (
            <li key={id}>
              {stageLabel(id)}: {change.reasons![id]}
            </li>
          ))}
        </ul>
        <Actions onUpdate={onUpdate} updating={updating} onKeep={() => onKeep(event.created_at)} />
      </div>
    );
  }
  if (event.type === 'stage_version_saved') {
    const names = stageIds.map(stageLabel);
    const list = listOf(names);
    const n = event.payload?.version_number;
    return (
      <div role="status" aria-label="Brief change" className="mb-6 rounded-xl bg-[var(--surface-container-low)] px-5 py-3 text-body text-[var(--on-surface-variant)]">
        {waiting}
        <p className="mt-2">
          <span aria-hidden className="material-symbols-outlined mr-1 align-[-4px] text-[18px] text-[var(--pm-tertiary)]">history</span>
          {typeof n === 'number' ? t('bcn.stageChangedV', { count: stageIds.length, stage: stageLabel(event.stage_id), version: n, names: list }) : t('bcn.stageChanged', { count: stageIds.length, stage: stageLabel(event.stage_id), names: list })}
        </p>
        <Actions onUpdate={onUpdate} updating={updating} onKeep={() => onKeep(event.created_at)} />
      </div>
    );
  }
  // 13 Oct (Sean, email 1): a stage the user reopened, changed and handed to Go.
  if (event.payload?.kind === 'reopened') {
    return (
      <div role="status" aria-label="Brief change" className="mb-6 rounded-xl bg-[var(--surface-container-low)] px-5 py-3 text-body text-[var(--on-surface-variant)]">
        {waiting}
        <p className="mt-2">
          <span aria-hidden className="material-symbols-outlined mr-1 align-[-4px] text-[18px] text-[var(--pm-tertiary)]">history</span>
          {t('bcn.reopened', { stage: stageLabel(event.stage_id) })}
        </p>
        <Actions onUpdate={onUpdate} updating={updating} onKeep={() => onKeep(event.created_at)} />
      </div>
    );
  }
  const fieldKey = (event.payload?.field as WatchedField) ?? 'objective';
  const field = !BRIEF_FIELD_LABEL[fieldKey] ? t('bcn.brief') : locale === 'en' ? BRIEF_FIELD_LABEL[fieldKey] : t(FIELD_KEY[fieldKey]).toLowerCase();
  const affected = (event.payload?.affected as { stage_id: string; reason: string }[] | undefined) ?? [];
  const names = stageIds.map(stageLabel);
  const list = listOf(names);
  // Only where something was computed: on a project with no calculations the
  // sentence would describe nothing (production, 6 Oct).
  const holds = event.payload?.calculations_hold !== false && event.payload?.kind === 'intent' && event.payload?.had_computed === true;
  return (
    <div role="status" aria-label="Brief change" className="mb-6 rounded-xl bg-[var(--surface-container-low)] px-5 py-3 text-body text-[var(--on-surface-variant)]">
      {waiting}
      <p className="mt-2">
        <span aria-hidden className="material-symbols-outlined mr-1 align-[-4px] text-[18px] text-[var(--pm-tertiary)]">history</span>
        {t('bcn.fieldChange', { count: stageIds.length, field, names: list })}{' '}
        {holds ? `${t('bcn.holds')} ` : ''}
        {t('bcn.rest')}
      </p>
      {partialUpdate(affected.map((a) => a.stage_id), stageIds, stageLabel) && (
        <p className="mt-1 text-label text-[var(--on-surface)]">{partialUpdate(affected.map((a) => a.stage_id), stageIds, stageLabel)}</p>
      )}
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
  const t = useT();
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {onUpdate && (
        <button
          onClick={onUpdate}
          disabled={updating}
          className="rounded-lg bg-[var(--pm-primary)] px-3 py-1.5 text-label text-[var(--on-primary)] hover:opacity-90 disabled:opacity-50"
        >
          {updating ? t('bcn.updating') : t('bcn.update')}
        </button>
      )}
      <button
        onClick={onKeep}
        className="rounded-lg bg-[var(--surface-container-high)] px-3 py-1.5 text-label text-[var(--on-surface)] hover:opacity-90"
      >
        {t('bcn.keep')}
      </button>
    </div>
  );
}

/**
 * When some of the reopened stages are updated and some are not: which, so
 * the notice never reads as all or nothing (12 Oct; Sean: "If only some
 * document updates succeed, identify what remains unfinished").
 */
export function partialUpdate(affected: readonly string[], waiting: readonly string[], stageLabel: (id: string) => string): string | null {
  const all = [...new Set(affected)];
  const done = all.filter((id) => !waiting.includes(id));
  if (!done.length || !waiting.length) return null;
  const names = (ids: readonly string[]) => ids.map(stageLabel).join(', ');
  return tr('bcn.partial', { done: done.length, all: all.length, doneNames: names(done), waitingNames: names(waiting) });
}

function listOf(names: readonly string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')}${tr('bcn.and')}${names.at(-1)}`;
}

/** What the user did that started it, in their words. */
function firstStep(event: WorkflowEvent): string {
  if (event.type === 'stage_version_saved') return tr('bcn.first.revision');
  if (event.type === 'brief_changed') {
    // An answer to Go, or "Have Go fix …", reopens the deliverable as a facts
    // change; no fact was recorded by it (15 Oct, production pass).
    if (event.payload?.kind === 'answer') return /^fix/i.test(event.reason ?? '') ? tr('bcn.first.fix') : tr('bcn.first.answer');
    return event.payload?.field === 'facts' ? tr('bcn.first.facts') : event.payload?.kind === 'reopened' ? tr('bcn.first.reopened') : tr('bcn.first.brief');
  }
  if (event.type === 'stage_returned') return tr('bcn.first.back');
  return tr('bcn.first.again');
}

/**
 * "✓ Facts recorded → ● 2 awaiting update → ○ Updated and checked" (Sean, 14
 * Oct, SUMMIT: "Could we make the sequence clearer: facts recorded, affected
 * work awaiting update, then updated and checked?"). `at` is the step under
 * way; the steps before it are done.
 */
function Steps({ first, second, third, at }: { first: string; second: string; third: string; at: 1 | 2 | 3 }) {
  const steps = [first, second, third];
  return (
    <ol aria-label={tr('bcn.progress')} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-label">
      {steps.map((text, i) => {
        const n = i + 1;
        const done = n < at || (at === 3 && n === 3);
        const current = n === at && !done;
        return (
          <li key={text} className={`flex items-center gap-1 ${done || current ? 'text-[var(--on-surface)]' : ''}`} aria-current={current ? 'step' : undefined}>
            {i > 0 && <span aria-hidden className="material-symbols-outlined text-[16px] text-[var(--outline)]">chevron_right</span>}
            <span aria-hidden className={`material-symbols-outlined text-[16px] ${done ? 'text-[var(--pm-success)]' : current ? 'text-[var(--pm-tertiary)]' : 'text-[var(--outline)]'}`}>
              {done ? 'check_circle' : current ? 'pending' : 'radio_button_unchecked'}
            </span>
            <span className={current ? 'font-semibold' : ''}>{text}</span>
          </li>
        );
      })}
    </ol>
  );
}
