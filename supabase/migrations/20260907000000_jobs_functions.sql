-- Job queue operations for resumable generation (FR-05).
--
-- The `jobs` table already exists (20260903000000_projects_governance.sql) with
-- its lease, checkpoint and idempotency columns. What it has never had is a way
-- to claim work safely. These three functions are that, and they are
-- SECURITY DEFINER for a specific reason: `jobs` deliberately grants the client
-- SELECT only, because a client that could set `status` or `leased_until` could
-- starve or duplicate another tab's work. Claiming therefore cannot be client
-- SQL. It has to be a function that decides for itself what a caller may do.
--
-- Every function pins search_path. A SECURITY DEFINER function without it can
-- be redirected to an attacker-controlled schema by a caller who sets their own
-- search_path, which for a definer-rights function means running as the owner.

-- ---------------------------------------------------------------------------
-- enqueue_job
-- ---------------------------------------------------------------------------

-- Queue a unit of work, returning the job id — or NULL when the idempotency key
-- already exists for this project.
--
-- That NULL is the mechanism behind "completed sections are not regenerated
-- unless the user requests it". Re-enqueueing section 3 of the same outline
-- version is a no-op; a user-requested regenerate passes a key carrying a new
-- revision, so it is a different row and does run.
create or replace function public.enqueue_job(
  p_project_id      uuid,
  p_kind            text,
  p_idempotency_key text,
  p_payload         jsonb default '{}'::jsonb,
  p_priority        integer default 0,
  p_max_attempts    integer default 3,
  p_parent_job_id   uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_job_id  uuid;
begin
  -- Ownership is checked here rather than trusted from the caller: this
  -- function runs as its owner, so it must not accept a project_id on faith.
  select p.user_id into v_user_id
  from public.projects p
  where p.id = p_project_id and p.user_id = auth.uid();

  if v_user_id is null then
    raise exception 'project not found or not owned by caller'
      using errcode = '42501';
  end if;

  insert into public.jobs (
    user_id, project_id, kind, payload, idempotency_key,
    priority, max_attempts, parent_job_id
  )
  values (
    v_user_id, p_project_id, p_kind, coalesce(p_payload, '{}'::jsonb),
    p_idempotency_key, coalesce(p_priority, 0), coalesce(p_max_attempts, 3),
    p_parent_job_id
  )
  on conflict (project_id, idempotency_key) do nothing
  returning id into v_job_id;

  return v_job_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- claim_next_job
-- ---------------------------------------------------------------------------

-- Lease the next ready job, or return no rows.
--
-- Three properties this has to have, none of which the caller can be trusted to
-- provide:
--
--   Ordering. Section N+1's prompt depends on N's continuity record, so two
--   sections of one project must never run at once. The partial unique index
--   jobs_one_active_per_project makes that true by construction; the NOT EXISTS
--   below merely avoids provoking it in the common case. When two workers race
--   past that check the index rejects one, and we treat the rejection as "no
--   work for me" rather than an error — which is exactly right, since another
--   worker did take it.
--
--   Liveness. FOR UPDATE SKIP LOCKED means a worker never waits on a row
--   another worker is already claiming.
--
--   Recovery. attempts increments on claim, not on failure. A serverless
--   function that is killed mid-run never writes anything, so a failure-time
--   increment would let a job that kills the worker every time retry forever.
create or replace function public.claim_next_job(
  p_worker        text,
  p_lease_seconds integer default 120,
  p_project_id    uuid default null
) returns setof public.jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt integer := 0;
  v_job     public.jobs;
begin
  -- Bounded retry: each iteration loses only to a genuine concurrent claim, and
  -- a busy queue must not spin here.
  while v_attempt < 3 loop
    v_attempt := v_attempt + 1;

    begin
      with candidate as (
        select j.id
        from public.jobs j
        where j.status = 'queued'
          and j.run_after <= now()
          and not j.cancel_requested
          and (p_project_id is null or j.project_id = p_project_id)
          and not exists (
            select 1 from public.jobs active
            where active.project_id = j.project_id
              and active.status = 'leased'
          )
        order by j.priority desc, j.run_after, j.created_at
        for update skip locked
        limit 1
      )
      update public.jobs j
      set status       = 'leased',
          lease_owner  = p_worker,
          leased_until = now() + make_interval(secs => greatest(p_lease_seconds, 15)),
          attempts     = j.attempts + 1,
          started_at   = coalesce(j.started_at, now())
      from candidate c
      where j.id = c.id
      returning j.* into v_job;

    exception when unique_violation then
      -- Another worker leased a job for this project between our NOT EXISTS and
      -- our UPDATE. Not an error: try for a different project's work.
      v_job := null;
      continue;
    end;

    if v_job.id is not null then
      return next v_job;
    end if;

    return;  -- nothing ready
  end loop;

  return;
end;
$$;

-- ---------------------------------------------------------------------------
-- reap_expired_leases
-- ---------------------------------------------------------------------------

-- Return jobs whose lease ran out to the queue, or bury them.
--
-- This is the answer to "how does a job survive a function timeout". Vercel
-- kills the function; nobody writes a failure; the row simply sits in `leased`
-- with a `leased_until` in the past until a later drain calls this. Because
-- work is checkpointed before the expensive follow-up step, the re-claim
-- resumes rather than restarting, and prose the user has already paid for is
-- not regenerated.
--
-- Backoff is exponential and capped at five minutes: long enough that a failing
-- provider is not hammered, short enough that a user watching a draft does not
-- conclude it has died.
create or replace function public.reap_expired_leases()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  with reaped as (
    update public.jobs j
    set status = case
                   when j.cancel_requested        then 'cancelled'
                   when j.attempts >= j.max_attempts then 'dead'
                   else 'queued'
                 end,
        lease_owner  = null,
        leased_until = null,
        run_after    = now() + make_interval(
                         secs => least(300, power(2, j.attempts)::integer * 5)
                       ),
        error_code = case
                       when j.attempts >= j.max_attempts and not j.cancel_requested
                         then 'job_dead'
                       else j.error_code
                     end,
        error_message = case
                          when j.attempts >= j.max_attempts and not j.cancel_requested
                            then 'This step was retried ' || j.max_attempts ||
                                 ' times without completing.'
                          else j.error_message
                        end,
        finished_at = case
                        when j.cancel_requested or j.attempts >= j.max_attempts
                          then now()
                        else null
                      end
    where j.status = 'leased'
      and j.leased_until < now()
    returning 1
  )
  select count(*) into v_count from reaped;

  return coalesce(v_count, 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

-- Default EXECUTE for a new function is PUBLIC, which on a SECURITY DEFINER
-- function is how these turn into a privilege escalation. Revoke first, then
-- grant deliberately.
revoke all on function public.enqueue_job(uuid, text, text, jsonb, integer, integer, uuid) from public;
revoke all on function public.claim_next_job(text, integer, uuid) from public;
revoke all on function public.reap_expired_leases() from public;

-- Enqueueing is a user action ("draft this book"), and the function checks
-- ownership itself, so the signed-in role may call it.
grant execute on function public.enqueue_job(uuid, text, text, jsonb, integer, integer, uuid)
  to authenticated, service_role;

-- Claiming and reaping belong to the drain worker alone. A client able to claim
-- could lease a job and never return it, stalling the project's queue behind
-- jobs_one_active_per_project.
grant execute on function public.claim_next_job(text, integer, uuid) to service_role;
grant execute on function public.reap_expired_leases() to service_role;
