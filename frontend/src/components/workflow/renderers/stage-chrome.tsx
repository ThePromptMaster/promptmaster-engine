'use client';

/**
 * The furniture every stage renderer shares: the version pill row and the
 * generation bar.
 *
 * Split out rather than duplicated three times, because "which version am I
 * looking at" and "is a draft running" must look and behave identically
 * whether the stage holds prose, a list or a table. A user who learns the
 * version pills on the Objective stage should not have to relearn them on the
 * claim table.
 */

import { useEffect, useRef, useState } from 'react';

import { EvaluationScores } from '../evaluation-scores';
import { RecoveryPanel } from '../recovery-panel';
import type { StageFailure } from '@/lib/errors/recovery';
import type { ArtifactVersion, Evaluation } from '@/types/project';
import { isSaved, versionTitle } from '@/lib/workflow/labels';
import { useT } from '@/lib/i18n/i18n-provider';
import { tr } from '@/lib/i18n/store';
import { shownOperationLabel } from '@/lib/i18n/stage';
import { colourOfVersion, VERSION_SWATCHES } from '@/lib/appearance/colours';
import { useProjectStore } from '@/stores/project-store';

interface VersionBarProps {
  versions: ArtifactVersion[];
  activeVersionId: string | null;
  headVersionId: string | null;
  onSelect: (versionId: string | null) => void;
  onRestore: (versionId: string) => Promise<void>;
  readOnly: boolean;
  /** Scores for the version being viewed, when one was ever stored. */
  evaluation?: Evaluation;
}

export function VersionBar({
  versions,
  activeVersionId,
  headVersionId,
  onSelect,
  onRestore,
  readOnly,
  evaluation,
}: VersionBarProps) {
  // C6 (Sean, 28 Sep, item 19): the current version, the ones the user
  // chose to keep, and the full history behind a toggle — not eleven pills.
  const [showAll, setShowAll] = useState(false);
  const t = useT();
  if (versions.length === 0) return null;

  const headId = headVersionId ?? versions.at(-1)!.id;
  const active = versions.find((v) => v.id === activeVersionId) ?? versions.at(-1)!;
  const isHead = active.id === headId;
  const shown = (v: ArtifactVersion) => v.id === headId || isSaved(v.source_operation) || v.id === active.id;
  const hidden = versions.filter((v) => !shown(v)).length;
  const visible = showAll || hidden === 0 ? versions : versions.filter(shown);

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('stage.versionHistory')}>
        {visible.map((v) => {
          // Each version is shown in its own colour, kept from when it was
          // made — not the accent, which painted every version alike (Sean,
          // 22 Oct: "when i change it, it changes for all versions").
          const colour = colourOfVersion(v.version_number, v.colour_scheme, v.colour);
          const selected = v.id === active.id;
          return (
          <button
            key={v.id}
            onClick={() => onSelect(v.id)}
            aria-pressed={selected}
            title={v.change_summary ?? versionTitle(v.version_number, v.source_operation)}
            data-version-pill
            className={`rounded-lg px-3 py-1.5 text-label transition-colors ${
              selected
                ? 'font-semibold text-[var(--on-surface)] ring-2'
                : 'bg-[var(--surface-container-low)] text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)]'
            }`}
            style={selected ? { background: `color-mix(in srgb, ${colour} 16%, var(--surface-container-lowest))`, ['--tw-ring-color' as string]: colour } : undefined}
          >
            <span
              aria-hidden
              data-version-colour
              className="me-1.5 inline-block h-2.5 w-2.5 rounded-full align-middle"
              style={{ background: colour }}
            />
            {versionPillLabel(v, v.id === headId)}
            {v.restored_from_version_id && (
              <span aria-label={` (${t('stage.restored')})`} title={t('stage.restored')}> ↩</span>
            )}
          </button>
          );
        })}
        <VersionColourPicker version={active} />
        {hidden > 0 && (
          <button
            onClick={() => setShowAll((s) => !s)}
            aria-expanded={showAll}
            className="rounded-lg px-2 py-1.5 text-label text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-low)]"
          >
            {showAll ? t('stage.hideHistory') : t('stage.fullHistory', { count: versions.length })}
          </button>
        )}
      </div>

      {/* PM-07: say what the pill is, rather than leaving "v1" to be decoded. */}
      <span className="text-label text-[var(--on-surface-variant)]">
        {shownOperationLabel(active.source_operation)}
      </span>

      {/* Scores belong beside the version they describe: selecting an older
          pill and seeing the newest version's alignment would be a lie. */}
      <EvaluationScores evaluation={evaluation} />

      {/* Restoring appends a new version rather than rewinding — reachable
          only while looking at an older one, so browsing stays free. */}
      {!isHead && !readOnly && (
        <button
          onClick={() => void onRestore(active.id)}
          className="ms-auto rounded-lg bg-[var(--surface-container-high)] px-3 py-1.5 text-label text-[var(--on-surface)] hover:bg-[var(--surface-container-highest)]"
        >
          {t('stage.restoreV', { n: active.version_number })}
        </button>
      )}
    </div>
  );
}

/**
 * Choose the colour of the version on show (Sean, 25 Oct: "you should be able
 * to change each versions colors"). Saved on the version, so it is the same on
 * every device; the stage area takes it as its background.
 */
function VersionColourPicker({ version }: { version: ArtifactVersion }) {
  const t = useT();
  const setVersionColour = useProjectStore((s) => s.setVersionColour);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  const choose = (colour: string | null) => {
    setOpen(false);
    setError(null);
    setVersionColour(version.id, colour).catch((e: unknown) =>
      setError(t('stage.colourFailed', { message: e instanceof Error ? e.message : String(e) }))
    );
  };
  const label = t('stage.colourOf');
  const current = colourOfVersion(version.version_number, version.colour_scheme, version.colour);
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={label}
        title={label}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)]"
      >
        <span aria-hidden className="material-symbols-outlined text-[18px]" style={{ color: current }}>palette</span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={label}
          className="absolute start-0 top-full z-30 mt-1 w-[min(15rem,calc(100vw-2rem))] rounded-xl bg-[var(--surface-container-lowest)] p-3 shadow-[0_8px_24px_rgba(0,0,0,0.15)]"
        >
          <p className="mb-2 text-label text-[var(--on-surface-variant)]">{t('stage.colourHint')}</p>
          <div className="grid grid-cols-7 gap-1.5">
            {VERSION_SWATCHES.map((sw) => (
              <button
                key={sw.id}
                type="button"
                onClick={() => choose(sw.id)}
                aria-label={sw.label}
                aria-pressed={version.colour === sw.id}
                title={sw.label}
                className={`h-7 w-7 rounded-full ${version.colour === sw.id ? 'ring-2 ring-[var(--on-surface)] ring-offset-2' : ''}`}
                style={{ background: sw.colour }}
              />
            ))}
          </div>
          {version.colour && (
            <button
              type="button"
              onClick={() => choose(null)}
              className="mt-2 text-label text-[var(--pm-primary)] hover:underline"
            >
              {t('stage.colourAsMade')}
            </button>
          )}
        </div>
      )}
      {error && <p role="alert" className="absolute start-0 top-full z-30 mt-1 w-60 rounded-lg bg-[var(--error-container)] px-3 py-2 text-label text-[var(--on-error-container)]">{error}</p>}
    </div>
  );
}

interface GenerationBarProps {
  /** Singular noun for what is being drafted, e.g. "positioning statement". */
  label: string;
  generating: boolean;
  error: string | null;
  hasContent: boolean;
  onGenerate: (options?: { force?: boolean }) => void;
  onCancel: () => void;
  readOnly: boolean;
  /** FR-11. Absent when the stage cannot be evaluated (browsing, no store). */
  onEvaluate?: () => void;
  evaluating?: boolean;
  evaluationError?: string | null;

  /**
   * FR-16. The classified failure, when there is one.
   *
   * Kept alongside the plain `error` string rather than replacing it: every
   * surface that renders a stage — the preview page, four renderer test files —
   * passes a string today, and a classified failure is strictly more than a
   * string, so the string stays as the floor. When both are present the
   * classified one wins, because it is the one that says what survived.
   */
  failure?: StageFailure | null;
  evaluationFailure?: StageFailure | null;
  onDismissFailure?: () => void;
  onSwitchModel?: (model: string) => void;
  currentModel?: string;
  /** The workspace's action bar owns Draft / Regenerate / Evaluate (PM-06). */
  compact?: boolean;
}

/**
 * Drafting state, always visible.
 *
 * Regenerating over existing work asks first. The artifact is versioned so
 * nothing is truly lost, but "your edits were replaced, check the history" is
 * a bad thing to learn after the fact.
 */
export function GenerationBar({
  label,
  generating,
  error,
  hasContent,
  onGenerate,
  onCancel,
  readOnly,
  onEvaluate,
  evaluating = false,
  evaluationError = null,
  failure = null,
  evaluationFailure = null,
  onDismissFailure,
  onSwitchModel,
  currentModel,
  compact = false,
}: GenerationBarProps) {
  const t = useT();
  if (readOnly) return null;

  if (generating) {
    return (
      <div
        role="status"
        className="mb-4 flex items-center gap-3 rounded-xl bg-[var(--surface-container-low)] px-5 py-3"
      >
        <span
          aria-hidden
          className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--pm-primary)] border-t-transparent"
        />
        <span className="text-body text-[var(--on-surface-variant)]">{t('stage.drafting', { label })}</span>
        <button
          onClick={onCancel}
          className="ms-auto rounded-lg px-3 py-1.5 text-label text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)] hover:text-[var(--on-surface)]"
        >
          {t('stage.stop')}
        </button>
      </div>
    );
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      {/* FR-16. The classified panel replaces the bare line entirely when one
          is available — showing both would state the same failure twice, once
          usefully and once not. */}
      {failure ? (
        <RecoveryPanel
          failure={failure}
          onRetry={() => onGenerate({ force: hasContent })}
          onDismiss={onDismissFailure}
          onSwitchModel={onSwitchModel}
          currentModel={currentModel}
        />
      ) : (
        error && (
          // --pm-tertiary is the warning tone in this dialect; a failed draft is
          // recoverable by pressing the button again, not an error state.
          <p className="text-label text-[var(--pm-tertiary)]" role="alert">
            {error}
          </p>
        )
      )}

      {evaluationFailure ? (
        <RecoveryPanel
          failure={evaluationFailure}
          onRetry={() => onEvaluate?.()}
          onDismiss={onDismissFailure}
          onSwitchModel={onSwitchModel}
          currentModel={currentModel}
        />
      ) : (
        evaluationError && (
          <p className="text-label text-[var(--pm-tertiary)]" role="alert">
            {evaluationError}
          </p>
        )
      )}

      {/* Evaluation is never automatic — it is a model call the user chooses
          to spend, so the button says what it costs. Placed before Draft and
          without the accent fill, because drafting is the primary action on a
          stage and scoring is the considered second one. */}
      {!compact && onEvaluate && hasContent && (
        <button
          onClick={onEvaluate}
          disabled={evaluating}
          className="ms-auto inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-container-low)] px-3 py-1.5 text-label text-[var(--on-surface-variant)] transition-colors hover:bg-[var(--surface-container-high)] hover:text-[var(--on-surface)] disabled:opacity-50"
        >
          {evaluating ? (
            <span
              aria-hidden
              className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--pm-primary)] border-t-transparent"
            />
          ) : (
            <span aria-hidden className="material-symbols-outlined text-[16px]">
              rule
            </span>
          )}
          {evaluating ? t('stage.evaluating') : t('stage.evaluate')}
          <span className="text-[var(--on-surface-variant)] opacity-70">{t('stage.oneCheck')}</span>
        </button>
      )}

      {!compact && (
        <button
          onClick={() => onGenerate()}
          className="ms-auto inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-container-low)] px-3 py-1.5 text-label text-[var(--on-surface-variant)] transition-colors hover:bg-[var(--surface-container-high)] hover:text-[var(--on-surface)]"
        >
          <span aria-hidden className="material-symbols-outlined text-[16px]">
            {hasContent ? 'refresh' : 'auto_awesome'}
          </span>
          {hasContent ? t('stage.regenerate') : t('stage.draftThe', { label })}
        </button>
      )}
    </div>
  );
}

/** Shown while a stage has nothing and nothing is running. */
export function EmptyStage({ label, onWrite }: { label: string; onWrite?: () => void }) {
  const t = useT();
  return (
    <div className="rounded-xl bg-[var(--surface-container-low)] px-8 py-12 text-center">
      <p className="text-body text-[var(--on-surface-variant)]">
        {t('stage.empty', { label })}
      </p>
      {onWrite && (
        <button
          onClick={onWrite}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-container-high)] px-4 py-2 text-label text-[var(--on-surface)] hover:opacity-90"
        >
          <span aria-hidden className="material-symbols-outlined text-[16px]">edit</span>
          {t('stage.writeYourself')}
        </button>
      )}
    </div>
  );
}

interface ConfirmOverwriteProps {
  label: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmOverwrite({ label, onConfirm, onCancel }: ConfirmOverwriteProps) {
  const t = useT();
  return (
    <div className="mb-4 rounded-xl bg-[var(--surface-container-high)] px-5 py-4">
      <p className="text-body text-[var(--on-surface)]">
        {t('stage.replaces', { label })}
      </p>
      <div className="mt-3 flex gap-2">
        <button
          onClick={onConfirm}
          className="rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-label text-[var(--on-primary)]"
        >
          {t('stage.regenerate')}
        </button>
        <button
          onClick={onCancel}
          className="rounded-lg px-4 py-2 text-label text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]"
        >
          {t('stage.keepWhatIHave')}
        </button>
      </div>
    </div>
  );
}

/**
 * One word per state (12 Oct; Sean: "clearly distinguish proposed changes,
 * saved current versions, historical versions, and work awaiting recheck"):
 * the version in use is "current", one Go saved says so, and every other is
 * "earlier" — a version kept by choice is marked as kept, not as "saved",
 * because every version is saved.
 */
export function versionPillLabel(v: Pick<ArtifactVersion, 'version_number' | 'source_operation'>, isHead: boolean): string {
  const n = v.version_number;
  if (isHead) return GO_MADE.has(v.source_operation) ? tr('stage.pillCurrentGo', { n }) : tr('stage.pillCurrent', { n });
  return isSaved(v.source_operation) ? tr('stage.pillEarlierKept', { n }) : tr('stage.pillEarlier', { n });
}

const GO_MADE: ReadonlySet<string> = new Set(['agent_draft', 'agent_revise', 'agent_apply', 'agent_triage', 'agent_outline']);
