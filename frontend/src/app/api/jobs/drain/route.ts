/**
 * The drain endpoint: a Next.js route handler, deliberately not FastAPI.
 *
 * This is where the service-role key lives. The drain reads the outline and the
 * continuity records from Supabase, calls FastAPI for generation only, and
 * writes the results back itself — which is what lets the backend stay
 * stateless-but-authenticated with no Supabase data client in it. That is a
 * settled architectural decision, not an accident of where the code landed.
 *
 * Two callers, two credentials:
 *
 *   Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. It has no user and
 *   no project, so it drains whatever is ready across all projects. This is the
 *   path that finishes a book after the tab is closed, and it is why FR-05 works
 *   without anything running in the browser.
 *
 *   A browser sends the user's Supabase JWT and must name a `project_id` it
 *   owns. This exists purely for latency: cron ticks once a minute, and a user
 *   watching a draft appear should not wait that long between sections. It can
 *   never reach another user's work, because ownership is re-checked here
 *   against the token rather than trusted from the body.
 *
 * The time budget is the other half of surviving a function timeout. The loop
 * runs one checkpointable step at a time and stops while it still has enough
 * left to hand the lease back cleanly, so the common case is a clean release
 * rather than a reaped lease.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

import { runDrain } from '@/lib/jobs/drain';
import { HttpSectionGenerator } from '@/lib/jobs/generator';
import { SupabaseJobStore, createServiceClient } from '@/lib/jobs/supabase-store';

// Never prerender, never cache: this mutates on every call.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Under the platform's default 60s ceiling. The drain stops early on its own
 * budget, so this is the backstop rather than the mechanism — a job killed here
 * is recovered by `reap_expired_leases` on the next tick regardless.
 */
export const maxDuration = 60;

/** Wall clock the loop may spend, leaving headroom under maxDuration. */
const BUDGET_MS = 45_000;
/** Long enough to outlive a slow provider, short enough to recover promptly. */
const LEASE_SECONDS = 120;

type Caller =
  | { kind: 'cron' }
  | { kind: 'user'; userId: string; projectId: string };

async function authorize(request: NextRequest): Promise<Caller | NextResponse> {
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) {
    return NextResponse.json({ error: 'Missing bearer token.' }, { status: 401 });
  }

  const cronSecret = (process.env.CRON_SECRET ?? '').trim();
  // An unset CRON_SECRET must not match an empty token — otherwise a missing
  // env var silently turns this into an open endpoint.
  if (cronSecret && timingSafeEqual(token, cronSecret)) {
    return { kind: 'cron' };
  }

  // Otherwise it must be a user's Supabase JWT, and it is verified by asking
  // Supabase rather than by decoding it here.
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const { data, error } = await anon.auth.getUser(token);
  if (error || !data.user) {
    return NextResponse.json({ error: 'Invalid token.' }, { status: 401 });
  }

  let body: { project_id?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    // Treated as a missing project_id below.
  }
  const projectId = typeof body.project_id === 'string' ? body.project_id : '';
  if (!projectId) {
    return NextResponse.json(
      { error: 'project_id is required when draining as a user.' },
      { status: 400 }
    );
  }

  // Ownership is checked against the token's user, never taken from the body.
  const service = createServiceClient();
  const { data: project, error: projectError } = await service
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', data.user.id)
    .maybeSingle();

  if (projectError) {
    return NextResponse.json({ error: 'Could not verify project.' }, { status: 500 });
  }
  if (!project) {
    // 404 rather than 403: a project the caller does not own should not be
    // distinguishable from one that does not exist.
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }

  return { kind: 'user', userId: data.user.id, projectId };
}

export async function POST(request: NextRequest) {
  const caller = await authorize(request);
  if (caller instanceof NextResponse) return caller;

  const workerSecret = (process.env.WORKER_SHARED_SECRET ?? '').trim();
  if (!workerSecret) {
    return NextResponse.json(
      { error: 'WORKER_SHARED_SECRET is not configured; the drain cannot call the API.' },
      { status: 500 }
    );
  }

  let store: SupabaseJobStore;
  try {
    store = new SupabaseJobStore(createServiceClient());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Service client unavailable.' },
      { status: 500 }
    );
  }

  // Unique per run. Two drains sharing a worker id could write to each other's
  // leases, which is the one thing the lease-owner checks cannot catch.
  const worker = `${caller.kind}-${crypto.randomUUID()}`;

  try {
    const report = await runDrain({
      store,
      generator: new HttpSectionGenerator(workerSecret),
      worker,
      budgetMs: BUDGET_MS,
      leaseSeconds: LEASE_SECONDS,
      projectId: caller.kind === 'user' ? caller.projectId : null,
    });
    return NextResponse.json(report);
  } catch (error) {
    // A drain that throws has already left its job leased; the reaper recovers
    // it, so this is reported rather than retried here.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Drain failed.' },
      { status: 500 }
    );
  }
}

/** Vercel Cron issues GET. Same work, same credential. */
export async function GET(request: NextRequest) {
  return POST(request);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
