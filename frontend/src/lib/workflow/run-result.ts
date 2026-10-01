/**
 * Putting a sandbox run onto the row it carried out. Pure.
 *
 * "Completed" on a run table is execution truth, so the model may never
 * claim it (L-C7). A run that actually executed is a different thing: the
 * sandbox wrote a row only the server can write, and the code exited
 * cleanly. That settles the row the planner said the computation was for —
 * its status becomes the table's "carried out" status, what the run printed
 * goes into the row, and the row says where that came from. The user can
 * still change it, and a row the user decided themselves is left alone.
 */

import type { StageItem, StageItemSchema } from './stage-artifact';

export interface ExecutedRun {
  id: string;
  stdout: string;
}

export interface RunResult {
  items: StageItem[];
  row: StageItem;
}

const OUTPUT_MAX = 300;

/** What the run printed, as one line that fits a table cell. */
export function runObservation(run: ExecutedRun, max = 400): string {
  const printed = run.stdout.replace(/\s+/g, ' ').trim();
  const lead = `Ran in the sandbox (run ${run.id.slice(0, 8)}).`;
  const text = printed ? `${lead} Output: ${printed.length > OUTPUT_MAX ? `${printed.slice(0, OUTPUT_MAX - 1)}…` : printed}` : `${lead} It printed nothing.`;
  return text.slice(0, max);
}

/**
 * `rowNumber` is the row's position as the planner was shown it (1-based).
 * Returns null — nothing to save — when the table has no status a run can
 * set, the number names no row, or the row's status is the user's own.
 */
export function applyRunResult(
  items: readonly StageItem[],
  rowNumber: unknown,
  schema: StageItemSchema,
  run: ExecutedRun
): RunResult | null {
  const execution = schema.execution;
  const n = typeof rowNumber === 'number' ? rowNumber : typeof rowNumber === 'string' && /^\d+$/.test(rowNumber.trim()) ? Number(rowNumber) : NaN;
  if (!execution || !Number.isInteger(n) || n < 1 || n > items.length) return null;
  const was = items[n - 1];
  // The user's own decision outranks a run; so does a status with no recorded source (written before sources existed).
  if (was.status && was.status_source !== 'model' && was.status_source !== 'sandbox') return null;
  const max = schema.fields.find((f) => f.key === execution.field)?.max;
  const row: StageItem = {
    ...was,
    status: execution.status,
    status_source: 'sandbox',
    sandbox_run_id: run.id,
    [execution.field]: runObservation(run, max),
  };
  // The reason belonged to the status the run replaced ("not run: no data"),
  // and so did what the draft wrote about a run it could not make: on
  // production a completed row still read "the calculation outcome is not
  // available" beside its own output.
  delete row.reason;
  if (was.status_source === 'model') for (const key of execution.clears ?? []) delete row[key];
  return { items: items.map((item, i) => (i === n - 1 ? row : item)), row };
}
