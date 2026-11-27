'use client';

import { tr } from '@/lib/i18n/store';
import { useLocale, useT } from '@/lib/i18n/i18n-provider';
import type { MessageKey } from '@/lib/i18n/messages/en';
import { BRIEF_FIELD_LABEL, type OpenChange, type WatchedField } from '@/lib/workflow/brief-change';
import type { WorkflowEvent } from '@/lib/workflow/types';
import type { ChangeOutcome } from '@/lib/workflow/change-outcomes';
import type { ChangeSummary, NeedsYouItem } from '@/lib/workflow/change-summary';

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
  outcomes = [],
  onDismissSettled,
  summary = null,
  onOpenStage,
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
  /** For each stage it reopened: the version that finished it, by whom, and what its check found (4 Nov). */
  outcomes?: ChangeOutcome[];
  onDismissSettled?: () => void;
  /**
   * What still stands, what is being redone and what needs the user (L-277; 22 Nov, Sean:
   * "which parts of the plan they can still use, which need to be redone, and what
   * genuinely needs their judgment"). Shown in place of the bare list of reasons.
   */
  summary?: ChangeSummary | null;
  /** Takes the user to a stage: where a decision is made again or an approval given. */
  onOpenStage?: (stageId: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const groups = summary ? <ChangeGroups summary={summary} stageLabel={stageLabel} onOpenStage={onOpenStage} settled={!change} /> : null;
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
          <button onClick={onDismissSettled} className="ms-auto text-label text-[var(--pm-primary)] hover:underline">
            {t('bcn.dismiss')}
          </button>
        )}
        {groups ? <div className="basis-full">{groups}</div> : outcomes.length > 0 && (
          // 4 Nov (Sean): which stages were updated, which rechecked, which still have findings open.
          <ul data-change-outcomes className="basis-full list-disc ps-6 text-label">
            {outcomes.map((o) => (
              <li key={o.stageId}>
                {o.check === 'none'
                  ? t('bcn.outcomeLineShort', {
                      stage: stageLabel(o.stageId),
                      what: o.version === null ? t('bcn.kept') : t('bcn.updatedBy', { version: o.version, who: o.by === 'go' ? t('bcn.byGo') : t('bcn.byYou') }),
                    })
                  : t('bcn.outcomeLine', {
                  stage: stageLabel(o.stageId),
                  what: o.version === null ? t('bcn.kept') : t('bcn.updatedBy', { version: o.version, who: o.by === 'go' ? t('bcn.byGo') : t('bcn.byYou') }),
                  check:
                    o.check === 'table'
                      ? o.count ? t('bcn.rows', { count: o.count }) : t('bcn.rowsDecided')
                      : o.check === 'not_checked'
                      ? t('bcn.notChecked')
                      : o.check === 'clean'
                      ? t('bcn.clean')
                      : t('bcn.findings', { count: o.count }),
                })}
              </li>
            ))}
          </ul>
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
          <span aria-hidden className="material-symbols-outlined me-1 align-[-4px] text-[18px] text-[var(--pm-tertiary)]">history</span>
          {t('bcn.needsRecheck', { count: stageIds.length, names: listOf(names) })}
        </p>
        {groups ?? (
          <ul className="mt-1 list-disc ps-6 text-label">
            {stageIds.map((id) => (
              <li key={id}>
                {stageLabel(id)}: {change.reasons![id]}
              </li>
            ))}
          </ul>
        )}
        <Actions onUpdate={onUpdate} updating={updating} onKeep={() => onKeep(event.created_at)} />
      </div>
    );
  }
  if (event.type === 'stage_version_saved') {
    const names = stageIds.map(stageLabel);
    const list = listOf(names);
    const n = event.payload?.version_number;
    return (
      <div role="status" aria-label={t('bcn.label')} className="mb-6 rounded-xl bg-[var(--surface-container-low)] px-5 py-3 text-body text-[var(--on-surface-variant)]">
        {waiting}
        <p className="mt-2">
          <span aria-hidden className="material-symbols-outlined me-1 align-[-4px] text-[18px] text-[var(--pm-tertiary)]">history</span>
          {typeof n === 'number' ? t('bcn.stageChangedV', { count: stageIds.length, stage: stageLabel(event.stage_id), version: n, names: list }) : t('bcn.stageChanged', { count: stageIds.length, stage: stageLabel(event.stage_id), names: list })}
        </p>
        {groups}
        <Actions onUpdate={onUpdate} updating={updating} onKeep={() => onKeep(event.created_at)} />
      </div>
    );
  }
  // 13 Oct (Sean, email 1): a stage the user reopened, changed and handed to Go.
  if (event.payload?.kind === 'reopened') {
    return (
      <div role="status" aria-label={t('bcn.label')} className="mb-6 rounded-xl bg-[var(--surface-container-low)] px-5 py-3 text-body text-[var(--on-surface-variant)]">
        {waiting}
        <p className="mt-2">
          <span aria-hidden className="material-symbols-outlined me-1 align-[-4px] text-[18px] text-[var(--pm-tertiary)]">history</span>
          {t('bcn.reopened', { stage: stageLabel(event.stage_id) })}
        </p>
        {groups}
        <Actions onUpdate={onUpdate} updating={updating} onKeep={() => onKeep(event.created_at)} />
      </div>
    );
  }
  const fieldKey = (event.payload?.field as WatchedField) ?? 'objective';
  // A linked project updated from its original is named as itself (L-326).
  const reference = event.payload?.origin === 'reference' ? (event.payload?.reference as { name?: unknown } | undefined)?.name : undefined;
  const field = typeof reference === 'string' && reference
    ? reference
    : !BRIEF_FIELD_LABEL[fieldKey] ? t('bcn.brief') : locale === 'en' ? BRIEF_FIELD_LABEL[fieldKey] : t(FIELD_KEY[fieldKey]).toLowerCase();
  const affected = (event.payload?.affected as { stage_id: string; reason: string }[] | undefined) ?? [];
  const names = stageIds.map(stageLabel);
  const list = listOf(names);
  const toCheck = summary?.redoing.filter((r) => r.state === 'to_check') ?? [];
  // Only where something was computed: on a project with no calculations the
  // sentence would describe nothing (production, 6 Oct).
  const holds = event.payload?.calculations_hold !== false && event.payload?.kind === 'intent' && event.payload?.had_computed === true;
  return (
    <div role="status" aria-label={t('bcn.label')} className="mb-6 rounded-xl bg-[var(--surface-container-low)] px-5 py-3 text-body text-[var(--on-surface-variant)]">
      {waiting}
      <p className="mt-2">
        <span aria-hidden className="material-symbols-outlined me-1 align-[-4px] text-[18px] text-[var(--pm-tertiary)]">history</span>
        {t('bcn.fieldChange', { count: stageIds.length, field, names: list })}{' '}
        {holds ? `${t('bcn.holds')} ` : ''}
        {/* 26 Nov (L-292): work after a stage still waiting is checked once it is updated, so not "everything else stands". */}
        {toCheck.length ? t('bcn.restToCheck', { names: listOf(toCheck.map((r) => stageLabel(r.stageId))), after: stageLabel(toCheck[0].after ?? '') }) : t('bcn.rest')}
      </p>
      {partialUpdate(affected.map((a) => a.stage_id), stageIds, stageLabel) && (
        <p className="mt-1 text-label text-[var(--on-surface)]">{partialUpdate(affected.map((a) => a.stage_id), stageIds, stageLabel)}</p>
      )}
      {groups ?? (
        <ul className="mt-1 list-disc ps-6 text-label">
          {affected.filter((a) => stageIds.includes(a.stage_id)).map((a) => (
            <li key={a.stage_id}>
              {stageLabel(a.stage_id)}: {a.reason}
            </li>
          ))}
        </ul>
      )}
      <Actions onUpdate={onUpdate} updating={updating} onKeep={() => onKeep(event.created_at)} />
    </div>
  );
}

/** At most this many things needing the user are listed; the rest are counted. */
const NEEDS_SHOWN = 3;

/**
 * The three answers after a change (L-277): still usable, being redone (or redone),
 * and what needs the user. Each group names its stages; the first two fold their
 * detail away, the last is always open, and says so when nothing needs the user.
 */
export function ChangeGroups({
  summary,
  stageLabel,
  onOpenStage,
  settled,
}: {
  summary: ChangeSummary;
  stageLabel: (id: string) => string;
  onOpenStage?: (stageId: string) => void;
  settled: boolean;
}) {
  const t = useT();
  const names = (ids: readonly string[]) => listOf(ids.map(stageLabel));
  const { usable, redoing, needsYou } = summary;
  const shown = needsYou.slice(0, NEEDS_SHOWN);
  const kept = (k: (typeof usable)[number]['kept']) => (k === 'checked' ? t('chs.keptChecked') : k === 'by_you' ? t('chs.keptByYou') : k === 'as_was' ? t('bcn.kept') : '');
  const redoLine = (r: (typeof redoing)[number]) =>
    r.state === 'to_check'
      ? t('chs.toCheck', { stage: stageLabel(r.after ?? '') })
      : r.state === 'waiting'
      ? r.reason || t('chs.waiting')
      : r.state === 'open'
        ? t('chs.openNow')
        : r.version != null
          ? t('bcn.updatedBy', { version: r.version, who: r.by === 'go' ? t('bcn.byGo') : t('bcn.byYou') })
          : t('chs.waiting');
  return (
    <div data-change-summary className="mt-2 space-y-1.5 text-label">
      <details data-group="usable" className="rounded-lg px-1">
        <summary className="flex cursor-pointer list-none items-start gap-1.5 py-0.5">
          <span aria-hidden className="material-symbols-outlined text-[18px] text-[var(--pm-success)]">{'check_circle'}</span>
          <span className="min-w-0">
            <span className="font-semibold text-[var(--on-surface)]">{t('chs.usable')}</span>
            <span className="ms-1">{usable.length ? `(${usable.length}) ${names(usable.map((u) => u.stageId))}` : t('chs.usableNone')}</span>
          </span>
        </summary>
        {usable.some((u) => u.kept) && (
          <ul className="mb-1 list-disc ps-10">
            {usable.filter((u) => u.kept).map((u) => (
              <li key={u.stageId}>{t('chs.line', { stage: stageLabel(u.stageId), what: kept(u.kept) })}</li>
            ))}
          </ul>
        )}
      </details>
      {redoing.length > 0 && (
        <details data-group="redo" className="rounded-lg px-1">
          <summary className="flex cursor-pointer list-none items-start gap-1.5 py-0.5">
            <span aria-hidden className="material-symbols-outlined text-[18px] text-[var(--pm-tertiary)]">{'autorenew'}</span>
            <span className="min-w-0">
              <span className="font-semibold text-[var(--on-surface)]">{settled || redoing.every((r) => r.state === 'updated') ? t('chs.redone') : t('chs.redoing')}</span>
              <span className="ms-1">{`(${redoing.length}) ${names(redoing.map((r) => r.stageId))}`}</span>
            </span>
          </summary>
          <ul className="mb-1 list-disc ps-10">
            {redoing.map((r) => (
              <li key={r.stageId}>{t('chs.line', { stage: stageLabel(r.stageId), what: redoLine(r) })}</li>
            ))}
          </ul>
        </details>
      )}
      <div data-group="you" className="rounded-lg bg-[var(--surface-container)] px-2 py-1.5">
        <p className="flex items-start gap-1.5">
          <span aria-hidden className="material-symbols-outlined text-[18px] text-[var(--pm-primary)]">{'front_hand'}</span>
          <span className="font-semibold text-[var(--on-surface)]">{t('chs.needsYou')}</span>
          {!needsYou.length && <span>{t('chs.needsNothing')}</span>}
        </p>
        {shown.length > 0 && (
          <ul className="mt-1 space-y-1 ps-7">
            {shown.map((item, i) => (
              <li key={`${item.kind}:${item.stageId}:${i}`} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-[var(--on-surface)]">{needLine(item, stageLabel, t)}</span>
                {onOpenStage && !(item.kind === 'decision' && item.waitingOn.length) && (
                  <button type="button" onClick={() => onOpenStage(item.stageId)} className="rounded-lg bg-[var(--pm-primary)] px-2.5 py-1 text-label text-[var(--on-primary)] hover:opacity-90">
                    {item.kind === 'decision' ? t('chs.chooseAgain') : t('chs.open')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {needsYou.length > NEEDS_SHOWN && <p className="mt-1 ps-7">{t('chs.more', { count: needsYou.length - NEEDS_SHOWN })}</p>}
      </div>
    </div>
  );
}

function needLine(item: NeedsYouItem, stageLabel: (id: string) => string, t: ReturnType<typeof useT>): string {
  const stage = stageLabel(item.stageId);
  if (item.kind === 'decision') {
    const head = t('chs.decision', { stage, option: item.choice, because: item.because });
    return item.waitingOn.length ? `${head} ${t('chs.decisionAfter', { count: item.waitingOn.length, names: listOf(item.waitingOn.map(stageLabel)) })}` : head;
  }
  if (item.kind === 'reapprove') {
    const line = t('chs.reapprove', { stage, version: item.version, current: item.current });
    return item.sent ? `${line} ${t('chs.sentHas', { to: item.sent.to, version: item.sent.version })}` : line;
  }
  if (item.kind === 'resend') return t('chs.resend', { stage, to: item.to, version: item.version, current: item.current });
  return t('chs.item', { stage, text: item.text });
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
            {i > 0 && <span aria-hidden className="material-symbols-outlined rtl:-scale-x-100 text-[16px] text-[var(--outline)]">chevron_right</span>}
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
