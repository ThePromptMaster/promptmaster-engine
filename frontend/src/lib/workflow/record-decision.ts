/**
 * Writing a decision the user chose, with one checked retry (L-271).
 *
 * 21 Nov, Sean, scanner replacement: "Approve Option B at $60,000" got a 522
 * from the database gateway on the fact insert, nothing was written, and the
 * card said only "That did not work." Typing the same decision a few minutes
 * later went through. A write that fails in a way a second try may pass is
 * tried once more — after checking it did not land, so a decision is never
 * recorded twice — and a write that still fails says why and is logged.
 */

import { writeOnceMore } from '@/lib/supabase/errors';
import { tr } from '@/lib/i18n/store';
import type { ProjectFact } from '@/types/project';

type FactRow = Pick<ProjectFact, 'source_ref' | 'retired_at' | 'created_at'>;
type EventRow = { type: string; stage_id?: string | null; reason?: string | null; created_at: string };

/** A minute's slack for a browser clock behind the database's. */
const CLOCK_SLACK_MS = 60_000;

export interface DecisionWrites {
  /** The fact insert (a new decision, or one superseding the earlier). */
  writeFact: () => Promise<unknown>;
  /** The project's facts as the database has them now. */
  readFacts: () => Promise<readonly FactRow[]>;
  /** The event that reopens the stage so the decision is written in; none on a table stage. */
  writeEvent?: () => Promise<unknown>;
  readEvents?: () => Promise<readonly EventRow[]>;
  /** Called before each step that remains, in order: the tick goes between the fact and the event. */
  afterFact?: () => Promise<unknown>;
  report: (code: string, error: unknown) => void;
  pauseMs?: number;
}

/** The decision's fact and event, each tried once more when that may help. */
export async function writeDecision(
  decision: { criterionId: string; stageId: string; choice: string; eventReason: string; since: number },
  w: DecisionWrites
): Promise<void> {
  const after = decision.since - CLOCK_SLACK_MS;
  const why = (e: unknown) => (e instanceof Error && e.message ? e.message : String(e)).replace(/\.$/, '');
  try {
    await writeOnceMore(
      w.writeFact,
      async () =>
        (await w.readFacts()).some((f) => {
          const ref = (f.source_ref ?? {}) as { criterion_id?: unknown; choice?: unknown };
          return !f.retired_at && ref.criterion_id === decision.criterionId && ref.choice === decision.choice && Date.parse(f.created_at) >= after;
        }),
      w.pauseMs
    );
  } catch (e) {
    w.report('decision_not_recorded', e);
    throw new Error(tr('wserr.decisionNotSaved', { why: why(e) }));
  }
  await w.afterFact?.();
  if (!w.writeEvent) return;
  const readEvents = w.readEvents ?? (async () => []);
  try {
    await writeOnceMore(
      w.writeEvent,
      async () =>
        (await readEvents()).some(
          (ev) => ev.type === 'brief_changed' && ev.stage_id === decision.stageId && ev.reason === decision.eventReason && Date.parse(ev.created_at) >= after
        ),
      w.pauseMs
    );
  } catch (e) {
    // Written, only the page could not re-read the log: the decision is in.
    if (e instanceof Error && e.name === 'EventRecordedError') return;
    w.report('decision_not_written_in', e);
    throw new Error(tr('wserr.decisionNotWrittenIn', { why: why(e) }));
  }
}

