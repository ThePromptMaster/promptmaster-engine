/**
 * FR-19: the one route that reads across every user's data.
 *
 * A Next.js route handler, for the same reason the job drain is one: this is
 * where the service-role key lives, and it never reaches the browser. It is
 * read from a non-`NEXT_PUBLIC_` variable inside a handler, so Next has no way
 * to inline it into a client bundle.
 *
 * **The order of operations is the security property.** `requireAdmin` runs
 * first, verifies the bearer token with Supabase, and checks the resolved user
 * id against the `ADMIN_USER_IDS` allowlist. Only after that returns a caller
 * is `createAdminClient()` called at all. Nothing in this file reads a row
 * before that check has passed, and `admin-access.test.ts` asserts a non-admin
 * is refused — which is the test that should fail loudly if anyone ever moves
 * the check below the query.
 *
 * The alternative that was not built: a client-side `if (isAdmin)` over an
 * RLS-scoped query. It returns nothing, because RLS scopes to `auth.uid()`. The
 * variant that *would* return something — a client check over a service-role
 * query — is a data breach, since the only guard would be a boolean in
 * JavaScript the user can edit. See `lib/admin/access.ts`.
 *
 * **Readable without knowing the schema.** The audience is the product owner.
 * So ids are resolved to emails and project titles here, on the server, where
 * the joins are cheap and the service role can actually see `auth.users` —
 * rather than shipping uuids to a page that would have no way to resolve them.
 */

import { NextResponse, type NextRequest } from 'next/server';

import { createAdminClient, requireAdmin } from '@/lib/admin/access';
import type {
  AdminErrorRow,
  AdminErrorTally,
  AdminFailedJob,
  AdminOverview,
  AdminUsageRow,
} from '@/lib/admin/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Default reporting window. Long enough to show a trend, short enough to load. */
const DEFAULT_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 365;
/** Lists are for reading, not for exporting. Roll-ups cover the whole window. */
const LIST_LIMIT = 50;
/**
 * Ceiling on rows pulled for the roll-up. A controlled beta will not approach
 * it; if it ever does, the page says so rather than quietly reporting a
 * fraction of the spend as if it were all of it.
 */
const ROLLUP_LIMIT = 10_000;

export async function GET(request: NextRequest) {
  // Authorise BEFORE touching the service-role key. See the module docstring.
  const caller = await requireAdmin(request);
  if (caller instanceof NextResponse) return caller;

  let supabase: ReturnType<typeof createAdminClient>;
  try {
    supabase = createAdminClient();
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Admin client unavailable.' },
      { status: 500 }
    );
  }

  const windowDays = clampWindow(request.nextUrl.searchParams.get('days'));
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  const warnings: string[] = [];

  const [usageRows, jobRows, errorRows] = await Promise.all([
    fetchUsage(supabase, since, warnings),
    fetchFailedJobs(supabase, warnings),
    fetchErrors(supabase, since, warnings),
  ]);

  // Resolve every id we are about to show, in two queries rather than N.
  const userIds = unique([
    ...usageRows.map((r) => r.user_id),
    ...jobRows.map((r) => r.user_id),
    ...errorRows.map((r) => r.user_id),
  ]);
  const projectIds = unique([
    ...jobRows.map((r) => r.project_id),
    ...errorRows.map((r) => r.project_id),
  ]);

  const [emails, projectTitles] = await Promise.all([
    resolveEmails(supabase, userIds, warnings),
    resolveProjectTitles(supabase, projectIds, warnings),
  ]);

  const usageByUser = rollUpUsage(usageRows, emails);
  const errorTally = tallyErrors(errorRows);

  const overview: AdminOverview = {
    windowDays,
    generatedAt: new Date().toISOString(),
    totals: {
      calls: usageRows.length,
      tokensIn: sum(usageByUser.map((u) => u.tokensIn)),
      tokensOut: sum(usageByUser.map((u) => u.tokensOut)),
      costUsd: sumNullable(usageByUser.map((u) => u.costUsd)),
      unpricedCalls: sum(usageByUser.map((u) => u.unpricedCalls)),
      activeUsers: usageByUser.length,
      failedJobs: jobRows.length,
      errors: errorRows.length,
    },
    usageByUser,
    failedJobs: jobRows.slice(0, LIST_LIMIT).map((row) => ({
      id: row.id,
      kind: row.kind,
      status: row.status,
      projectId: row.project_id,
      projectTitle: row.project_id ? (projectTitles.get(row.project_id) ?? null) : null,
      userEmail: emails.get(row.user_id) ?? null,
      attempts: row.attempts ?? 0,
      maxAttempts: row.max_attempts ?? 0,
      errorCode: row.error_code,
      errorMessage: row.error_message,
      createdAt: row.created_at,
    })) satisfies AdminFailedJob[],
    recentErrors: errorRows.slice(0, LIST_LIMIT).map((row) => ({
      id: row.id,
      code: row.code,
      title: row.title,
      message: row.message,
      route: row.route,
      requestId: row.request_id,
      httpStatus: row.http_status,
      userEmail: emails.get(row.user_id) ?? null,
      projectTitle: row.project_id ? (projectTitles.get(row.project_id) ?? null) : null,
      source: row.source,
      createdAt: row.created_at,
    })) satisfies AdminErrorRow[],
    errorTally,
    warnings,
  };

  return NextResponse.json(overview);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

type Client = ReturnType<typeof createAdminClient>;

interface UsageRow {
  user_id: string;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_usd: string | number | null;
  created_at: string;
}

async function fetchUsage(supabase: Client, since: string, warnings: string[]) {
  const { data, error } = await supabase
    .from('model_usage')
    .select('user_id, tokens_in, tokens_out, cost_usd, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(ROLLUP_LIMIT);

  if (error) {
    warnings.push(`Usage could not be read: ${error.message}`);
    return [];
  }
  const rows = (data ?? []) as UsageRow[];
  if (rows.length >= ROLLUP_LIMIT) {
    warnings.push(
      `Only the most recent ${ROLLUP_LIMIT.toLocaleString()} calls were counted, so the totals below understate the period.`
    );
  }
  return rows;
}

interface JobRow {
  id: string;
  kind: string;
  status: string;
  user_id: string;
  project_id: string | null;
  attempts: number | null;
  max_attempts: number | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
}

async function fetchFailedJobs(supabase: Client, warnings: string[]) {
  // Not windowed. A job that died three weeks ago and was never retried is
  // still broken today, and dropping it out of view once it aged past the
  // reporting window is how a stuck queue becomes invisible.
  const { data, error } = await supabase
    .from('jobs')
    .select(
      'id, kind, status, user_id, project_id, attempts, max_attempts, error_code, error_message, created_at'
    )
    .in('status', ['failed', 'dead'])
    .order('created_at', { ascending: false })
    .limit(LIST_LIMIT * 4);

  if (error) {
    warnings.push(`Failed jobs could not be read: ${error.message}`);
    return [];
  }
  return (data ?? []) as JobRow[];
}

interface ErrorRow {
  id: string;
  user_id: string;
  project_id: string | null;
  code: string;
  title: string;
  message: string;
  route: string;
  request_id: string;
  http_status: number | null;
  source: string;
  created_at: string;
}

async function fetchErrors(supabase: Client, since: string, warnings: string[]) {
  const { data, error } = await supabase
    .from('error_events')
    .select(
      'id, user_id, project_id, code, title, message, route, request_id, http_status, source, created_at'
    )
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(ROLLUP_LIMIT);

  if (error) {
    warnings.push(`Errors could not be read: ${error.message}`);
    return [];
  }
  return (data ?? []) as ErrorRow[];
}

// ---------------------------------------------------------------------------
// Resolving ids into things a person recognises
// ---------------------------------------------------------------------------

async function resolveEmails(
  supabase: Client,
  userIds: string[],
  warnings: string[]
): Promise<Map<string, string>> {
  const emails = new Map<string, string>();
  if (userIds.length === 0) return emails;

  // `auth.users` is not exposed through PostgREST, so this goes through the
  // admin API. It pages, and a controlled beta fits comfortably in one page.
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) {
    warnings.push(
      'User email addresses could not be resolved, so rows are labelled by id.'
    );
    return emails;
  }
  for (const user of data?.users ?? []) {
    if (user.email) emails.set(user.id, user.email);
  }
  return emails;
}

async function resolveProjectTitles(
  supabase: Client,
  projectIds: (string | null)[],
  warnings: string[]
): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  const ids = projectIds.filter((id): id is string => Boolean(id));
  if (ids.length === 0) return titles;

  const { data, error } = await supabase.from('projects').select('id, title').in('id', ids);
  if (error) {
    warnings.push('Project titles could not be resolved, so rows are labelled by id.');
    return titles;
  }
  for (const row of (data ?? []) as { id: string; title: string | null }[]) {
    if (row.title) titles.set(row.id, row.title);
  }
  return titles;
}

// ---------------------------------------------------------------------------
// Roll-ups
// ---------------------------------------------------------------------------

/**
 * `cost_usd` is `numeric` in Postgres, which PostgREST returns as a *string* to
 * avoid the precision loss of a float round-trip. Reading it as a number
 * without this would produce NaN and a page of dashes.
 */
function toNumber(value: string | number | null): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rollUpUsage(rows: UsageRow[], emails: Map<string, string>): AdminUsageRow[] {
  const byUser = new Map<string, AdminUsageRow>();

  for (const row of rows) {
    let entry = byUser.get(row.user_id);
    if (!entry) {
      entry = {
        userId: row.user_id,
        email: emails.get(row.user_id) ?? null,
        calls: 0,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: null,
        unpricedCalls: 0,
        lastCallAt: null,
      };
      byUser.set(row.user_id, entry);
    }

    entry.calls += 1;
    entry.tokensIn += row.tokens_in ?? 0;
    entry.tokensOut += row.tokens_out ?? 0;

    const cost = toNumber(row.cost_usd);
    if (cost === null) {
      // Counted, not silently folded in as zero — the page reports it so a
      // total that understates is visibly understating.
      entry.unpricedCalls += 1;
    } else {
      entry.costUsd = (entry.costUsd ?? 0) + cost;
    }

    if (!entry.lastCallAt || row.created_at > entry.lastCallAt) {
      entry.lastCallAt = row.created_at;
    }
  }

  // Biggest spender first — the ordering the page is read for. Users with no
  // priced calls sort by token count instead, so they do not vanish to the end.
  return [...byUser.values()].sort(
    (a, b) => (b.costUsd ?? 0) - (a.costUsd ?? 0) || b.tokensOut - a.tokensOut
  );
}

function tallyErrors(rows: ErrorRow[]): AdminErrorTally[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.code, (counts.get(row.code) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count);
}

// ---------------------------------------------------------------------------

function clampWindow(raw: string | null): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_WINDOW_DAYS;
  return Math.min(Math.floor(parsed), MAX_WINDOW_DAYS);
}

function unique(values: (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))];
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

/** null only when *every* input was null — see `types.ts` on why that matters. */
function sumNullable(values: (number | null)[]): number | null {
  const known = values.filter((v): v is number => v !== null);
  return known.length === 0 ? null : known.reduce((a, b) => a + b, 0);
}
