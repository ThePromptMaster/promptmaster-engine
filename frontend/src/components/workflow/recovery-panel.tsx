'use client';

/**
 * FR-16, rendered.
 *
 * What stood here was a single line — `<p role="alert">{error}</p>` — printing
 * whatever string the API returned, and the only affordance a user had was to
 * press Draft again and hope. That is fine for "the draft came back empty" and
 * useless for "the account is out of credit", which no amount of pressing
 * Draft will fix.
 *
 * Three things this has to get right.
 *
 * **The preservation sentence is part of the message, not a footnote.** It is
 * the first question a failure raises, so it is answered in the paragraph the
 * user is already reading. `stageFailure` guarantees it is there.
 *
 * **Only the actions that apply.** Offering "Shorten" on a rate limit teaches
 * people that the buttons are decoration. The set comes from the code.
 *
 * **Advice is not disguised as a button.** Shortening the objective and
 * splitting the work are things only the user can do to their own inputs; they
 * appear as a line of guidance, and the actions that *are* buttons all do
 * something the moment they are pressed.
 */

import { useEffect, useState } from 'react';

import { api } from '@/lib/api/client';
import { CustomSelect } from '@/components/shared/custom-select';
import { ACTION_ICON, ACTION_LABEL, type StageFailure } from '@/lib/errors/recovery';

interface Props {
  failure: StageFailure;
  /** Re-run whatever failed. Doubles as "resume" — the verb differs, the call does not. */
  onRetry: () => void;
  /** Clear the failure and leave the stage alone. */
  onDismiss?: () => void;
  /** Change the project's configured model. Absent on surfaces with no store. */
  onSwitchModel?: (model: string) => void;
  currentModel?: string;
}

export function RecoveryPanel({
  failure,
  onRetry,
  onDismiss,
  onSwitchModel,
  currentModel = '',
}: Props) {
  const [showDetails, setShowDetails] = useState(false);
  const [switching, setSwitching] = useState(false);

  const actions = failure.actions.filter((a) => {
    if (a === 'switch_model') return Boolean(onSwitchModel);
    if (a === 'pause') return Boolean(onDismiss);
    // Shorten and split are guidance, not controls; they are rendered as the
    // guidance line rather than as buttons that cannot keep their promise.
    return a !== 'shorten' && a !== 'split';
  });

  return (
    <div
      role="alert"
      className="mb-4 w-full rounded-xl bg-[var(--surface-container-high)] px-5 py-4"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="material-symbols-outlined mt-0.5 shrink-0 text-[20px] text-[var(--pm-tertiary)]"
        >
          {failure.code === 'function_timeout' ? 'pause_circle' : 'error'}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-title text-[var(--on-surface)]">{failure.title}</p>
          <p className="mt-1 max-w-[68ch] text-body text-[var(--on-surface-variant)]">
            {failure.message}
          </p>
          {failure.guidance && (
            <p className="mt-2 max-w-[68ch] text-label text-[var(--on-surface-variant)]">
              {failure.guidance}
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {actions.map((action) => {
          const label = ACTION_LABEL[action];
          const icon = ACTION_ICON[action];

          if (action === 'details') {
            return (
              <button
                key={action}
                onClick={() => setShowDetails((v) => !v)}
                aria-expanded={showDetails}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-label text-[var(--on-surface-variant)] transition-colors hover:bg-[var(--surface-container-highest)] hover:text-[var(--on-surface)]"
              >
                <span aria-hidden className="material-symbols-outlined text-[16px]">
                  {icon}
                </span>
                {label}
              </button>
            );
          }

          if (action === 'switch_model') {
            return (
              <button
                key={action}
                onClick={() => setSwitching((v) => !v)}
                aria-expanded={switching}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-container-low)] px-3 py-1.5 text-label text-[var(--on-surface)] transition-colors hover:bg-[var(--surface-container-lowest)]"
              >
                <span aria-hidden className="material-symbols-outlined text-[16px]">
                  {icon}
                </span>
                {label}
              </button>
            );
          }

          const isPrimary = action === 'retry' || action === 'resume';
          return (
            <button
              key={action}
              onClick={action === 'pause' ? onDismiss : onRetry}
              className={
                isPrimary
                  ? 'inline-flex items-center gap-1.5 rounded-lg bg-[var(--pm-primary)] px-4 py-1.5 text-label text-[var(--on-primary)] transition-opacity hover:opacity-90'
                  : 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-label text-[var(--on-surface-variant)] transition-colors hover:bg-[var(--surface-container-highest)] hover:text-[var(--on-surface)]'
              }
            >
              <span aria-hidden className="material-symbols-outlined text-[16px]">
                {icon}
              </span>
              {label}
              {action === 'retry' && failure.retryAfter ? (
                <span className="opacity-70"> · in ~{Math.round(failure.retryAfter)}s</span>
              ) : null}
            </button>
          );
        })}
      </div>

      {switching && onSwitchModel && (
        <ModelSwitcher
          current={currentModel}
          onPick={(model) => {
            onSwitchModel(model);
            setSwitching(false);
          }}
        />
      )}

      {showDetails && (
        <pre className="mt-3 overflow-x-auto rounded-lg bg-[var(--surface-container-lowest)] px-4 py-3 text-label text-[var(--on-surface-variant)]">
          {[`code: ${failure.code}`, failure.technical ?? 'No further detail was returned.'].join(
            '\n'
          )}
        </pre>
      )}
    </div>
  );
}

/**
 * The model list, fetched only when someone asks for it.
 *
 * `/api/models` is a catalogue call, so it still answers when the account has
 * no credit — which is precisely the failure that sends people here. If it
 * does not answer, the fallback is a text box holding the current model id:
 * worse, but not a dead end, and a dead end is what an error panel must never
 * be.
 */
function ModelSwitcher({
  current,
  onPick,
}: {
  current: string;
  onPick: (model: string) => void;
}) {
  const [models, setModels] = useState<Array<{ id: string; name: string }> | null>(null);
  const [failed, setFailed] = useState(false);
  const [typed, setTyped] = useState(current);

  useEffect(() => {
    let live = true;
    api
      .getModels()
      .then((r) => live && setModels(r.models))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  if (failed) {
    return (
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="min-w-[240px] flex-1">
          <span className="mb-1 block text-label uppercase tracking-wider text-[var(--on-surface-variant)]">
            Model
          </span>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="provider/model-id"
            className="w-full rounded-lg bg-[var(--surface-container-lowest)] px-4 py-2 text-body text-[var(--on-surface)] outline-none"
          />
        </label>
        <button
          onClick={() => typed.trim() && onPick(typed.trim())}
          className="rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-label text-[var(--on-primary)]"
        >
          Use this model
        </button>
      </div>
    );
  }

  if (!models) {
    return (
      <p className="mt-3 text-label text-[var(--on-surface-variant)]">Loading models…</p>
    );
  }

  return (
    <div className="mt-3 max-w-[420px]">
      <CustomSelect
        value={current}
        ariaLabel="Model"
        placeholder="Choose a model"
        options={models.map((m) => ({ value: m.id, label: m.name || m.id }))}
        onChange={onPick}
      />
    </div>
  );
}
