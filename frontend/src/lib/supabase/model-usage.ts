/**
 * FR-18/FR-19: writing usage and error rows.
 *
 * This supersedes `usage.ts`, which is left in place untouched. `recordUsage()`
 * there writes `(user_id, action)` into `usage_tracking` — no model, no tokens,
 * no cost — and has had zero call sites since the /session retirement. It
 * counted how many iterations someone ran; this records what they spent. See
 * the migration for why the legacy table was superseded rather than widened.
 *
 * **Everything here is best-effort and silent on failure.** Telemetry runs
 * after a generation the user has already received. If the insert fails —
 * offline, RLS surprise, a transient 500 — the correct outcome is a missing
 * row, not a thrown error in the middle of the workspace. That is the same
 * decision the old `recordUsage` made, and it is the right one; what was wrong
 * with the old module was what it stored, not how it failed.
 *
 * **The project context.** A usage row is far more useful attributed to a
 * project than floating free, but `apiFetch` is a generic transport and has no
 * idea which project a call belongs to. Rather than thread a project id through
 * all ~25 API methods, the workspace sets it once when it mounts —
 * `setUsageProject(id)` — mirroring how the store already scopes itself. A call
 * made outside a project simply records `project_id: null`, which is a real and
 * expected state (smart setup, the long-form detector).
 */

import { createClient } from './client';
import type { UsageEvent } from '@/lib/observability/usage';

/**
 * The project the app is currently working in, for attribution only.
 *
 * Module-level rather than React state because the writer is called from
 * `apiFetch`, which is not a component and has no context. It is never read for
 * anything security-sensitive: RLS attributes the row to `auth.uid()`, and a
 * wrong value here mislabels a row rather than exposing one.
 */
let currentProjectId: string | null = null;

export function setUsageProject(projectId: string | null): void {
  currentProjectId = projectId;
}

export function currentUsageProject(): string | null {
  return currentProjectId;
}

/**
 * What the calls being made now are for, beyond their route (E1, 6 Oct): a Go
 * move ("go:revise_stage") and the step that made it. Set by the Go loop around
 * each move and cleared after; a call made while it is unset is attributed to
 * its route alone. Attribution only, like the project above.
 */
let currentOperation: { operation: string; agentStepId: string | null } | null = null;
const stepCosts = new Map<string, { cost: number; priced: boolean }>();

export function setUsageOperation(op: { operation: string; agentStepId?: string | null } | null): void {
  currentOperation = op ? { operation: op.operation, agentStepId: op.agentStepId ?? null } : null;
}

/**
 * What a Go step's calls cost, as far as prices were known — null when none of
 * them were priced (never 0 for "unknown"). Taken once, when the step finishes.
 */
export function takeStepCost(stepId: string): number | null {
  const entry = stepCosts.get(stepId);
  stepCosts.delete(stepId);
  return entry?.priced ? entry.cost : null;
}

export interface UsageWriteContext {
  route: string;
  requestId: string | null;
  projectId?: string | null;
  source?: 'app' | 'drain';
}

/**
 * Usage rows are written in batches (6 Oct). One insert per response, each
 * after a network round trip for the user, held the auth lock that every other
 * request waits on; under a Go run that was a stall the browser tests caught.
 * The user is read from the local session, and rows go out together.
 */
const USAGE_FLUSH_MS = 1_500;
let pendingRows: Record<string, unknown>[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
// Rows still waiting when the tab goes away are sent then, not dropped.
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => void flushUsage());

export async function flushUsage(): Promise<void> {
  flushTimer = null;
  const rows = pendingRows;
  pendingRows = [];
  if (!rows.length) return;
  try {
    const supabase = createClient();
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user.id;
    if (!userId) return;
    await supabase.from('model_usage').insert(rows.map((r) => ({ ...r, user_id: userId })));
  } catch {
    // Deliberately silent. See the module docstring.
  }
}

/**
 * Persist one row per provider call.
 *
 * Batched into a single insert: a stage generation fans out to four calls plus
 * a possible repair pass, and five round-trips of telemetry behind one
 * generation is telemetry that costs more than it measures.
 */
export async function recordModelUsage(
  events: UsageEvent[],
  context: UsageWriteContext
): Promise<void> {
  if (events.length === 0) return;

  // Before the first await: the response that carried these events reaches its
  // caller right after this, and a Go step totals its cost when it finishes.
  const op = currentOperation;
  if (op?.agentStepId) {
    const entry = stepCosts.get(op.agentStepId) ?? { cost: 0, priced: false };
    for (const e of events) if (e.costUsd !== null) Object.assign(entry, { cost: entry.cost + e.costUsd, priced: true });
    stepCosts.set(op.agentStepId, entry);
  }

  const projectId =
    context.projectId === undefined ? currentProjectId : context.projectId;
  pendingRows.push(
    ...events.map((event) => ({
      project_id: projectId,
      request_id: context.requestId ?? '',
      route: context.route,
      model: event.model,
      tokens_in: event.tokensIn,
      tokens_out: event.tokensOut,
      // Nulls are meaningful: "we did not know the price", not "it was free".
      cost_usd: event.costUsd,
      prompt_price_usd: event.promptPriceUsd,
      completion_price_usd: event.completionPriceUsd,
      source: context.source ?? 'app',
      elapsed_ms: Math.round(event.elapsedMs),
      attempt: event.attempt ?? 'first',
      operation: op?.operation ?? context.route,
      agent_step_id: op?.agentStepId ?? null,
    }))
  );
  if (!flushTimer) flushTimer = setTimeout(() => void flushUsage(), USAGE_FLUSH_MS);
}

export interface ErrorReport {
  code: string;
  title: string;
  message: string;
  technical?: string;
  route: string;
  requestId?: string | null;
  httpStatus?: number | null;
  projectId?: string | null;
  source?: 'client' | 'drain';
}

/**
 * FR-19: record a failure a user actually saw.
 *
 * `jobs.error_code` already records background-job failures and stays the
 * record for those. What had nowhere to land was everything else — a stage
 * generation that 502'd, a rate limit someone hit, a request refused for size.
 * Those appeared in one panel, for one person, once, and were gone the moment
 * it was dismissed, which is why "how often is anyone hitting this" was not a
 * question anybody could answer.
 */
export async function recordErrorEvent(report: ErrorReport): Promise<void> {
  try {
    const supabase = createClient();
    // The local session, not a network round trip (see the batching note above).
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    if (!user) return;

    await supabase.from('error_events').insert({
      user_id: user.id,
      project_id: report.projectId === undefined ? currentProjectId : report.projectId,
      code: report.code || 'unknown',
      title: report.title ?? '',
      message: report.message ?? '',
      // Bounded: a stack trace or a provider's HTML error page can be enormous,
      // and this column exists for the technical-details disclosure, not for
      // archiving whatever the upstream felt like returning.
      technical: (report.technical ?? '').slice(0, 4000),
      route: report.route,
      request_id: report.requestId ?? '',
      http_status: report.httpStatus ?? null,
      source: report.source ?? 'client',
    });
  } catch {
    // Silent, for the same reason as above — and doubly so here: this runs on
    // the error path, and an error reporter that throws is a broken app.
  }
}
