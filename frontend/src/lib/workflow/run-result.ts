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

function rowNumberOf(rowNumber: unknown): number | null {
  const n = typeof rowNumber === 'number' ? rowNumber : typeof rowNumber === 'string' && /^\d+$/.test(rowNumber.trim()) ? Number(rowNumber) : NaN;
  return Number.isInteger(n) && n >= 1 ? n : null;
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
  const n = rowNumberOf(rowNumber);
  if (!execution || n === null || n > items.length) return null;
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

/**
 * A run that could not be made for want of data, onto the row it was for.
 *
 * The step's own text already says why; without this the row went on reading
 * "Not looked at", and the user was asked to type a reason PromptMaster had
 * just given. The row takes the table's "not run" status with that reason.
 * Never over the user's own decision, and never over a run that did execute.
 */
export function applyRunBlocked(
  items: readonly StageItem[],
  rowNumber: unknown,
  schema: StageItemSchema,
  blocked: { runId: string | null; reason: string }
): RunResult | null {
  const execution = schema.execution;
  const n = rowNumberOf(rowNumber);
  const reason = blocked.reason.trim();
  if (!execution?.blocked || !reason || n === null || n > items.length) return null;
  const was = items[n - 1];
  if (was.status && was.status_source !== 'model') return null;
  const row: StageItem = {
    ...was,
    status: execution.blocked,
    status_source: 'sandbox',
    reason: `Could not be run: ${reason}`.slice(0, 400),
  };
  if (blocked.runId) row.sandbox_run_id = blocked.runId;
  return { items: items.map((item, i) => (i === n - 1 ? row : item)), row };
}

/** The first of the row's own fields that already says why, for a status that needs a reason. */
export function reasonFromRow(item: StageItem, schema: StageItemSchema): string {
  for (const key of schema.reasonFrom ?? []) {
    const text = typeof item[key] === 'string' ? (item[key] as string).trim() : '';
    if (text) return text;
  }
  return '';
}
