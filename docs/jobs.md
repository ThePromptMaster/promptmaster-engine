# The job system

Long-form drafting does not run inside a browser request. It runs as persisted jobs,
so that closing the tab, a network drop, or a serverless function timing out costs at
most one section — not the document. This is what FR-05 asks for.

The whole system is: one table, ten database functions, one route handler, and a cron
entry.

---

## Why it is built this way

A serverless function has a hard wall-clock limit. Any design where "the job is
running" means "an HTTP request is open" loses the job when that wall is hit, and
loses it *silently* — nothing is left behind that says work was in flight.

So the running state lives in the database instead. A worker **leases** a job: it
stamps its own id and an expiry on the row and starts work. If the worker dies for any
reason — timeout, deploy, crash, instance recycled — it simply stops renewing. The
lease expires, the next drain reaps it, and the job goes back on the queue with its
checkpoint intact.

**A lease expiring is not an error path. It is how a job survives a function timeout.**
Seeing reaped jobs in the logs is normal.

---

## The `jobs` table

Defined in `supabase/migrations/20260903000000_projects_governance.sql`.

| Column | Purpose |
|---|---|
| `kind` | Which handler. Today only `draft_section`. |
| `status` | `queued`, `leased`, `succeeded`, `failed`, `cancelled`, `dead` (a CHECK, not a Postgres enum). |
| `priority`, `run_after` | Scheduling. `run_after` is also the backoff mechanism. |
| `payload` | Immutable input to the job. |
| `checkpoint` | Mutable progress. **This is what makes a retry cheap.** |
| `result` | Output on success. |
| `attempts`, `max_attempts` | Retry counting. `max_attempts` defaults to 3. |
| `lease_owner`, `leased_until` | The lease. |
| `cancel_requested` | Cooperative cancellation. |
| `idempotency_key` | `unique (project_id, idempotency_key)`. |
| `parent_job_id` | Self-reference, for future fan-out. |
| `error_code`, `error_message`, `error_detail` | Failure record. |

Two indexes carry the semantics:

- `jobs_ready_idx on (priority desc, run_after) where status = 'queued'` — the claim query.
- `jobs_one_active_per_project` — `unique (project_id) where status = 'leased'`. **At
  most one leased job per project, enforced by Postgres.** Two drains racing cannot
  both work the same project.

RLS gives clients `select` only. Every write goes through a `SECURITY DEFINER`
function.

## The database functions

All are `language plpgsql`, `security definer`, `set search_path = public, pg_temp`,
`revoke all ... from public`, then granted narrowly.

| Function | Granted to | What it does |
|---|---|---|
| `enqueue_job(project, kind, idempotency_key, payload, priority, max_attempts, parent)` | `authenticated`, `service_role` | Verifies `projects.user_id = auth.uid()` (raises `42501` otherwise), inserts `on conflict (project_id, idempotency_key) do nothing`. **Returns NULL on a duplicate key** — that is a successful no-op, not a failure. |
| `claim_next_job(worker, lease_seconds, project)` | `service_role` | Lease acquisition. See below. |
| `checkpoint_job(job, worker, checkpoint, extend_seconds)` | `service_role` | Saves progress and optionally extends the lease. Guarded on `status = 'leased' and lease_owner = worker`. |
| `complete_job(job, worker, result)` | `service_role` | `status = 'succeeded'`, clears the lease, sets `finished_at`. |
| `fail_job(job, worker, code, message, detail, retryable)` | `service_role` | `'failed'` if not retryable; `'dead'` if `attempts >= max_attempts`; otherwise back to `'queued'` with backoff. |
| `release_job(job, worker, run_after_seconds)` | `service_role` | Voluntary hand-back. Returns the attempt: `attempts = greatest(attempts - 1, 0)`. |
| `reap_expired_leases()` | `service_role` | Reclaims expired leases. See below. |
| `request_project_cancel(project)` | `authenticated`, `service_role` | Sets `cancel_requested` on queued and leased jobs; cancels the queued ones immediately. |
| `write_long_form_section(...)` | `service_role` | Writes a section into `artifacts.long_form` and appends a `workflow_events` row, allocating `seq` in the same statement. |
| `write_section_record(...)` | `service_role` | Upserts the continuity record on `(project_id, section_id)`. |

Every lease-holding function is guarded on `lease_owner = p_worker`, so a worker whose
lease was reaped **cannot** write results afterwards. It gets `false` back and stops.
That is what makes the reap safe rather than a double-write hazard.

### Lease acquisition

`claim_next_job` selects a job where `status = 'queued' and run_after <= now() and not
cancel_requested`, excluding projects that already have a leased job, ordered
`priority desc, run_after, created_at`, with `for update skip locked limit 1`. It then
sets `status = 'leased'`, the lease owner and expiry, and **increments `attempts`**.

Two things follow:

- **`attempts` increments on claim, not on failure.** A worker that dies without
  reporting anything still burns an attempt. That is deliberate — otherwise a job that
  reliably kills its worker would retry forever.
- The `unique (project_id) where status = 'leased'` index can raise a
  `unique_violation` under a race. The function catches it and retries the whole
  selection up to three times.

Lease duration is **120 seconds**, floored at 15 (`greatest(p_lease_seconds, 15)`),
passed as `LEASE_SECONDS = 120` by the route and extended by another 120 at the
checkpoint between the two steps.

### Reaping

`reap_expired_leases()` takes rows where `status = 'leased' and leased_until < now()`
and:

- if `cancel_requested` → `'cancelled'`;
- if `attempts >= max_attempts` → `'dead'`, `error_code = 'job_dead'`, message
  `'This step was retried N times without completing.'`, `finished_at = now()`;
- otherwise → back to `'queued'`, lease cleared, with exponential backoff:
  `run_after = now() + least(300, power(2, attempts) * 5) seconds` — capped at five
  minutes.

**There is no dead-letter table.** `status = 'dead'` on the row *is* the dead-letter
state, and the row keeps its payload, checkpoint and error, which is what you want
when diagnosing one.

## Idempotency

The key is built by `sectionJobKey` in `frontend/src/lib/supabase/jobs.ts`:

```
draft:${outlineVersionId ?? 'none'}:${sectionId}:${revision}
```

scoped per project by `unique (project_id, idempotency_key)`.

Consequences to understand before touching it: enqueuing the same section twice is a
harmless no-op, so the UI can be careless about double-submits; and a user-requested
regenerate works by **bumping `revision`**, which produces a different key and
therefore a genuinely new job. If regenerate ever stops producing new work, that is
where to look.

## The drain

`frontend/src/app/api/jobs/drain/route.ts` — `POST`, with `GET` delegating to it.
`runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, `maxDuration = 60`.

**This route holds `SUPABASE_SERVICE_ROLE_KEY`.** It is the only place in the system
that does. Keep it that way.

One invocation:

1. `reap_expired_leases()`.
2. Loop: `claim_next_job` → run one step → checkpoint or complete.
3. Return a `DrainReport`: `{ reaped, claimed, completed, released, failed, errors[] }`.

The loop stops at `maxJobs` (25) or when the remaining time budget falls below
`BUDGET_RESERVE_MS (8s) + MIN_STEP_MS (12s)` against a `BUDGET_MS` of 45 seconds. In
practice the clock stops it long before the count does. **A drain that returns with
jobs still queued is working correctly** — the next minute's cron picks them up.

The worker id is `${caller.kind}-${randomUUID()}`, so `cron-…` or `user-…`. That is
what appears in `lease_owner`, and it tells you whether a stuck job was claimed by the
cron or by a user-triggered drain.

### Authorisation

Either credential is accepted:

- `Authorization: Bearer <CRON_SECRET>`, compared in constant time. An unset or empty
  `CRON_SECRET` **cannot match** — the cron path fails closed rather than opening up.
- `Authorization: Bearer <user JWT>`. This path requires `project_id` in the body
  (400 without it) and re-checks ownership with the service client, returning **404**
  rather than 403 when the project is not the caller's, so as not to confirm that it
  exists.

`WORKER_SHARED_SECRET` is required separately (the route 500s if it is unset) and is
the credential the route presents to FastAPI, alongside `X-PromptMaster-User`.

### Cron

`frontend/vercel.json`:

```json
"crons": [ { "path": "/api/jobs/drain", "schedule": "* * * * *" } ]
```

Every minute. There is no cron in `backend/vercel.json`.

## The `draft_section` handler

The only job kind. `runJob` fails an unknown kind immediately and **non-retryably**
with `invalid_request`, which is right: an unknown kind will not become known on a
retry.

It is a two-step state machine keyed on `checkpoint.step`:

| Step | Does | Then |
|---|---|---|
| `prose` | `POST /api/generate-section-prose` → `write_long_form_section` | `checkpoint_job({step:'record'}, extend 120s)` |
| `record` | `POST /api/extract-section-record` → `write_section_record` | `complete_job` |

The checkpoint between them is the point: a failure in the record step never
re-generates the prose, which is the expensive half.

If the section id is no longer in the outline when the job runs — the user edited the
outline after enqueuing — the job completes with
`{ skipped: 'section_no_longer_in_outline' }` rather than failing. A stale job is not
an error.

## Tests

`frontend/src/lib/jobs/drain.test.ts` (565 lines) drives the whole thing against an
in-memory fake store. It covers FR-05's ten-section resumable drafting scenario and,
under `concurrent drains`, asserts that only one drain holds a project at a time.
`derived-outline.test.ts` covers idempotency-key dedupe. On the backend,
`test_auth_worker.py` covers the shared-secret credential and
`test_long_form_records.py` / `test_long_form_router.py` the two generation endpoints.

There is no test that exercises the real Postgres functions — see
[`known-limitations.md`](known-limitations.md).
