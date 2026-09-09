# Operator runbook

Short, procedural. Background is in [`architecture.md`](architecture.md),
[`jobs.md`](jobs.md) and [`data-model.md`](data-model.md).

---

## Deploy

Both Vercel projects deploy from `main`. **Never deploy from `master`** — that is the
legacy Streamlit app, and `frontend/vercel.json` disables it explicitly.

Before pushing:

```
cd backend  && pytest -q                  # expect 281 passed
cd frontend && npx vitest run             # expect 400 passed in 28 files
cd frontend && npm run build              # must pass — there is no CI
```

Order, when a change spans both:

1. **Migrations first.** `supabase db push`, then confirm with
   `supabase migration list --linked` that the new migration is actually listed as
   applied. `supabase db diff --linked --schema public` proves a migration *applies*;
   it does **not** prove it *has been applied*, and pg-delta does not diff functions or
   grants at all. Two migrations once reached `main` unapplied for exactly this reason.
2. **Backend second.** The frontend is the caller; the callee moves first.
3. **Frontend last.**

## Roll back

- **Frontend or backend code:** promote the previous deployment in the Vercel dashboard
  for that project. They are independent, so roll back only the one that broke.
- **A migration:** there is no down-migration convention here. Write a new forward
  migration that reverses the change. The one exception is the M1 import, which has a
  documented reversal:
  `delete from public.projects where migration_batch = '<uuid from the migration log>';`
- **The whole product:** `master` holds the legacy Streamlit app. It is a reference of
  last resort, not a deploy target.

## Is the cron healthy?

The single check:

```
curl -i -H "Authorization: Bearer $CRON_SECRET" https://<frontend>/api/jobs/drain
```

**A healthy system returns 200 on the minute**, with a JSON body like:

```json
{"reaped":0,"claimed":0,"completed":0,"released":0,"failed":0,"errors":[]}
```

All zeros is healthy — it means there was nothing queued. A drain that returns with
jobs still queued is also healthy; the next minute picks them up.

Read the numbers as:

| Field | Meaning |
|---|---|
| `reaped` | Leases that expired and went back on the queue. **A small non-zero number is normal** — that is how a job survives a function timeout. A large or growing number means jobs are consistently outrunning the 120-second lease. |
| `claimed` / `completed` | Throughput. `claimed` much greater than `completed` over time means steps are failing or timing out. |
| `released` | Voluntary hand-backs. These return the attempt, so they do not burn retries. |
| `failed` | Steps that reported an error. |

Other checks:

- **401** — `CRON_SECRET` is wrong, unset, or empty in the frontend project.
- **500 immediately** — `WORKER_SHARED_SECRET` is unset in the frontend project; the
  route refuses to start work without it.
- **Vercel dashboard → the frontend project → Cron Jobs** shows the invocation history.
  Gaps there are a platform or configuration problem, not an application one.

## Read a failed job

Jobs are rows. Query them as the owning user, or with the service role:

```sql
select id, kind, status, attempts, max_attempts, error_code, error_message,
       lease_owner, leased_until, run_after, checkpoint, created_at, finished_at
from public.jobs
where project_id = '<uuid>'
order by created_at desc;
```

| Status | What it means | What to do |
|---|---|---|
| `queued` with a future `run_after` | Backing off after a failure or a reap. | Wait. Backoff is `least(300, 2^attempts * 5)` seconds. |
| `leased` with `leased_until` in the past | The worker died. | Nothing — the next drain reaps it. If it never gets reaped, the cron is not running. |
| `failed` | Reported a non-retryable error. | Read `error_code` / `error_message` / `error_detail`. |
| `dead` | Exhausted `max_attempts` (3). | Same, plus `checkpoint` tells you *which step* it kept failing on. There is no dead-letter table; the row is the record. |
| `cancelled` | The user cancelled. | Nothing. |

`lease_owner` is prefixed `cron-` or `user-`, which tells you whether the cron or a
user-triggered drain last held it. `checkpoint.step` is `prose` or `record` — a job
stuck on `record` has already produced and saved its prose, and retrying is cheap.

To retry a dead job, do **not** edit the row. Have the user regenerate the section: the
idempotency key includes a `revision`, so a regenerate produces a genuinely new job.

To stop everything for one project:

```sql
select public.request_project_cancel('<project uuid>');
```

## Where the logs are

- **Frontend, including the drain:** Vercel logs for the frontend project.
- **Backend:** Vercel logs for the backend project. `logging.basicConfig(level=INFO)`
  in `main.py`. Useful lines to search for:
  - `UNAUTHENTICATED_REQUEST` — a request got through with `AUTH_ENFORCED=false`. In
    production this should never appear.
  - `LLM response: N in / N out` — per-call token usage.
  - `JSON parse failed, attempting repair pass` — the model returned unparseable JSON
    and a second repair call was made. Occasional is normal; frequent means a prompt or
    a model change regressed.
  - `Response truncated (finish_reason='length')` — the output hit the token ceiling.
    The pipeline force-sets `completeness = incomplete` when this happens.
- **Database:** the Supabase dashboard's logs and query performance views.
- The migrations emit `raise notice` reconciliation output. That appears in the
  `supabase db push` output — **read it, do not scroll past it**; the M1 import prints
  the `migration_batch` uuid that is its only reversal key.

## Rotate the secrets

### `OPENROUTER_API_KEY`

Issue a new key at OpenRouter, set it in the **backend** Vercel project, redeploy the
backend, then revoke the old one. Nothing else references it. Brief 5xx on generation
during the redeploy; saving is unaffected because the save path never touches the
backend.

### `WORKER_SHARED_SECRET`

**Set in both Vercel projects and they must match.** Rotating it naively breaks
drafting. Safe order:

1. Set the new value in the **backend** project and redeploy it. Old workers now fail
   with 401 — long-form drafting is degraded from here.
2. Set the same value in the **frontend** project and redeploy.
3. Confirm with a drain call returning 200 and a section completing.

Failed jobs during the window are retried automatically, so a short gap costs latency
rather than work. Keep the window short.

### `CRON_SECRET`

Update it in the frontend Vercel project. Vercel supplies this header itself for
`crons` entries, so confirm the dashboard's cron invocations still return 200
afterwards. During the gap jobs queue and are not drained — nothing is lost, drafting
just stalls.

### `SUPABASE_SERVICE_ROLE_KEY`

Rotate in the Supabase dashboard, then update it in the **frontend** Vercel project
(the only consumer) and redeploy. While it is stale, `/api/jobs/drain` fails and
drafting stalls; user-facing reads and writes are unaffected because they use the anon
key under RLS.

### Supabase JWT signing

If the JWT secret or signing keys are rotated, `SUPABASE_JWT_SECRET` in the **backend**
project must be updated to match. The asymmetric path re-fetches JWKS automatically
(cached with a 600-second lifespan), so an asymmetric-signing project needs no action
beyond waiting out the cache.

**Never put a secret in a `NEXT_PUBLIC_`-prefixed variable.** That prefix ships the
value to every browser.

## Backup and recovery

The application-level guarantee, which is in the code: `purge_deleted_projects(interval)`
hard-deletes soft-deleted projects **30 days** after deletion, scheduled by pg_cron at
`'17 3 * * *'` — *if* pg_cron is enabled. The migration schedules it conditionally and
only raises a notice when the extension is absent, so verify pg_cron is actually
enabled on the production project; otherwise soft-deleted rows accumulate silently.

Everything else is Supabase's own backup facility, configured in the Supabase
dashboard, not in this repository:

- Daily backups, with the retention window and point-in-time recovery availability
  determined by the project's plan tier.
- Restores are performed from the dashboard, and restore a whole project to a point in
  time — there is no per-table or per-user restore.

**The production project's plan tier and its actual backup/PITR configuration could not
be determined from the repository, and this document does not assert them.** Section 9
of the Amendment requires a *defined* backup and recovery responsibility, so this must
be confirmed in the Supabase dashboard and written down here. It is recorded as an open
item in [`known-limitations.md`](known-limitations.md).

Two things worth deciding at the same time:

- Who holds the Supabase organisation owner account (see the access-transfer item in
  the limitations register).
- Whether a periodic `pg_dump` to storage outside Supabase is wanted. There is none
  today.
