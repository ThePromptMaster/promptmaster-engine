/**
 * Run model-written code in a sandbox and record what really happened (B3,
 * PM-12, PM-19 "run a computation").
 *
 * A Next.js route rather than FastAPI for the reason the drain is: it writes a
 * trusted row with the service role, and the backend owns no data. The row is
 * the point. `sandbox_runs` is select-only for its owner, so a browser cannot
 * forge an execution, and `agent_steps_label_honest` refuses `code_executed` on
 * any step without one. Everything the Go loop later says about a computation
 * traces back to a row only this route can write.
 *
 * The caller is the signed-in user (Supabase JWT), and every id in the body is
 * re-checked against that user: the project, a *running* agent run on it, and
 * a *running* run_computation step of that run.
 *
 * Guards, all read per call:
 *   SANDBOX_ENABLED         must be "true" (mock mode: anything but "false").
 *                           Off is recorded as unavailable → blocked/tool_missing,
 *                           never as a silent failure.
 *   SANDBOX_MAX_PER_RUN     runs per agent run (10)
 *   SANDBOX_DAILY_SECONDS   execution seconds per user per UTC day (600)
 *   SANDBOX_USD_PER_VCPU_SECOND  if unset, cost is recorded as null (unknown),
 *                           never as $0.
 */

import { createHash, randomUUID } from 'node:crypto';

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

import { createServiceClient } from '@/lib/jobs/supabase-store';
import { classifyRun, truncate, type RunOutcome } from '@/lib/sandbox/outcome';
import { MAX_ARTIFACTS, STDERR_MAX, STDOUT_MAX, makeRunner, sandboxMode, type RunResult } from '@/lib/sandbox/runner';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
/** VM boot + package install (no snapshot) + a 30s command, with headroom. */
export const maxDuration = 120;

const COMMAND_TIMEOUT_MS = 30_000;
const MAX_CODE_CHARS = 40_000;
const VCPUS = 2;
const BUCKET = 'sandbox-artifacts';

function num(name: string, fallback: number): number {
  const v = Number((process.env[name] ?? '').trim());
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function enabled(): boolean {
  const flag = (process.env.SANDBOX_ENABLED ?? '').trim().toLowerCase();
  return sandboxMode() === 'mock' ? flag !== 'false' : flag === 'true';
}

function err(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

export async function POST(request: NextRequest) {
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return err(401, 'Missing bearer token.');

  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: auth, error: authError } = await anon.auth.getUser(token);
  if (authError || !auth.user) return err(401, 'Invalid token.');
  const userId = auth.user.id;

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return err(400, 'Body must be JSON.');
  }
  const projectId = typeof body.project_id === 'string' ? body.project_id : '';
  const runId = typeof body.run_id === 'string' ? body.run_id : '';
  const stepId = typeof body.step_id === 'string' ? body.step_id : '';
  const code = typeof body.code === 'string' ? body.code : '';
  const kind = body.kind === 'simulation' ? 'simulation' : 'computation';
  if (!projectId || !runId || !stepId) return err(400, 'project_id, run_id and step_id are required.');
  if (!code.trim()) return err(400, 'There is no code to run.');
  if (code.length > MAX_CODE_CHARS) return err(413, `Code is limited to ${MAX_CODE_CHARS} characters.`);

  const service = createServiceClient();

  // Ownership and state, re-checked against the token's user — never trusted from the body.
  const [{ data: run }, { data: step }] = await Promise.all([
    service.from('agent_runs').select('id, status, project_id').eq('id', runId).eq('user_id', userId).maybeSingle(),
    service.from('agent_steps').select('id, run_id, status, action_key').eq('id', stepId).eq('user_id', userId).maybeSingle(),
  ]);
  if (!run || run.project_id !== projectId || !step || step.run_id !== runId) return err(404, 'Run or step not found.');
  if (run.status !== 'running') return err(409, `This Go run is ${run.status}; start a new one to run code.`);
  if (step.status !== 'running' || step.action_key !== 'run_computation') {
    return err(409, 'Code can only be run for an in-progress "run a computation" step.');
  }

  const { count: perRun } = await service
    .from('sandbox_runs').select('id', { count: 'exact', head: true }).eq('run_id', runId);
  const maxPerRun = num('SANDBOX_MAX_PER_RUN', 10);
  if ((perRun ?? 0) >= maxPerRun) return err(429, `This Go run has used its ${maxPerRun} code runs.`);

  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const { data: today } = await service
    .from('sandbox_runs').select('duration_ms').eq('user_id', userId).gte('created_at', dayStart.toISOString());
  const usedMs = (today ?? []).reduce((sum, r) => sum + (r.duration_ms ?? 0), 0);
  const dailySeconds = num('SANDBOX_DAILY_SECONDS', 600);
  if (usedMs >= dailySeconds * 1000) {
    return err(429, `Today's code execution allowance (${dailySeconds}s) is used up. It resets at midnight UTC.`);
  }

  const result: RunResult = enabled()
    ? await makeRunner().run(code, { timeoutMs: COMMAND_TIMEOUT_MS })
    : {
        status: 'unavailable', stdout: '', stderr: '', exitCode: null, timedOut: false, durationMs: 0,
        detail: 'code execution is not enabled for this deployment', artifacts: [],
      };

  const id = randomUUID();
  const artifacts: { name: string; path: string; content_type: string; bytes: number }[] = [];
  for (const a of result.artifacts.slice(0, MAX_ARTIFACTS)) {
    const path = `${userId}/${runId}/${id}/${a.name}`;
    const { error: upErr } = await service.storage.from(BUCKET).upload(path, a.bytes, { contentType: a.contentType });
    if (!upErr) artifacts.push({ name: a.name, path, content_type: a.contentType, bytes: a.bytes.byteLength });
  }

  const out = truncate(result.stdout, STDOUT_MAX);
  const errText = truncate(result.stderr, STDERR_MAX);
  const rate = Number((process.env.SANDBOX_USD_PER_VCPU_SECOND ?? '').trim());
  const cost = Number.isFinite(rate) && rate > 0 && result.status !== 'unavailable'
    ? Number(((result.durationMs / 1000) * VCPUS * rate).toFixed(4))
    : null;

  const row = {
    id,
    step_id: stepId,
    run_id: runId,
    user_id: userId,
    project_id: projectId,
    language: 'python',
    code,
    code_sha256: createHash('sha256').update(code).digest('hex'),
    stdout: out.text,
    stderr: errText.text,
    truncated: out.truncated || errText.truncated,
    exit_code: result.exitCode,
    timed_out: result.timedOut,
    duration_ms: result.durationMs,
    artifacts,
    status: result.status,
    cost_usd: cost,
  };
  const { error: insertError } = await service.from('sandbox_runs').insert(row);
  if (insertError) return err(500, 'The run finished but could not be recorded, so it does not count as executed.');

  const outcome: RunOutcome = result;
  return NextResponse.json({ sandbox_run: row, classification: classifyRun(outcome, kind), detail: result.detail ?? null });
}
