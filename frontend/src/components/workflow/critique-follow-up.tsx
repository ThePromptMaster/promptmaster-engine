'use client';

import { useEffect, useRef, useState } from 'react';

import type { CritiquePoint } from '@/lib/workflow/critique-points';
import type { RowChange } from '@/lib/workflow/row-actions';
import type { ReplyAction } from '@/types';
import { CritiqueActions } from './critique-actions';
import { ReplyActions } from './reply-actions';

/**
 * What to do about a Challenge, a Reframe or a Self-audit: a few actions.
 *
 * The side chat stopped turning every bullet of an answer into an Apply
 * button on 1 Oct; these three kept doing it, up to twenty at a time
 * ("around 20 recommended fixes" — 2 Oct, item 6). A critique's points are
 * explanation as much as instruction. It now ends the way a chat answer does:
 * at most four actions, each one decision, and "Do nothing". The points are
 * still there to take one by one, for anyone who wants that, behind a
 * disclosure that starts closed.
 */
export function CritiqueFollowUp({
  commentary,
  points,
  busy,
  suggest,
  previewRows,
  onRun,
  onApplyPoints,
}: {
  commentary: { title: string; text: string };
  points: CritiquePoint[];
  busy: boolean;
  /** The same call the side chat makes for an answer. */
  suggest: (question: string, reply: string, signal: AbortSignal) => Promise<ReplyAction[]>;
  previewRows?: (action: ReplyAction) => RowChange[];
  onRun: (action: ReplyAction) => Promise<void> | void;
  onApplyPoints: (ids: string[], showFirst: boolean) => void;
}) {
  const [state, setState] = useState<{ list: ReplyAction[] | null; loading: boolean; error: string | null }>({ list: null, loading: true, error: null });
  const [dismissed, setDismissed] = useState(false);
  const suggestRef = useRef(suggest);
  useEffect(() => {
    suggestRef.current = suggest;
  });

  // Asked once per critique: its text is what identifies it.
  useEffect(() => {
    const controller = new AbortController();
    setState({ list: null, loading: true, error: null });
    setDismissed(false);
    suggestRef.current(`${commentary.title}: what should be done about the current draft?`, commentary.text, controller.signal).then(
      (list) => !controller.signal.aborted && setState({ list, loading: false, error: null }),
      () =>
        !controller.signal.aborted &&
        // Not being able to compress the critique is not a failed critique: the points are below.
        setState({ list: [], loading: false, error: 'Could not work out actions for this. The points are below.' })
    );
    return () => controller.abort();
  }, [commentary.title, commentary.text]);

  return (
    <div className="space-y-3">
      {!dismissed && (
        <ReplyActions
          label="Act on this critique"
          actions={state.list}
          loading={state.loading}
          error={state.error}
          busy={busy}
          previewRows={previewRows}
          onRun={onRun}
          onDismiss={() => setDismissed(true)}
        />
      )}
      {points.length > 0 && (
        <details>
          <summary className="cursor-pointer select-none text-label text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]">
            Review the {points.length === 1 ? 'point' : `${points.length} points`} one by one
          </summary>
          <div className="mt-3">
            <CritiqueActions title="Each point of this critique" points={points} busy={busy} onApply={onApplyPoints} />
          </div>
        </details>
      )}
    </div>
  );
}
