-- Approving and sending outreach email (Sean, 26 Nov: "Let me approve one email or a selected
-- batch. Record the exact version I approved … Give me send now, schedule, and pause … Show what's
-- a draft, approved, scheduled, submitted to the mailbox, confirmed sent, bounced, or failed … If a
-- send times out, check the mailbox before retrying so the person doesn't get two copies").
--
--   outreach_approvals    the user's approval of one exact email: the rendered snapshot, its
--                         hash, and the ticket the backend minted for it. Append-only; the only
--                         change allowed is revoking it.
--   outreach_sends        one email's way out, one row per approval. Users read it and never
--                         write it: every status is moved by the functions below, the server's
--                         ones only by the drain holding the job's lease. A browser cannot mark an
--                         email sent.
--   outreach_send_events  what happened to each send, in order. Written by the functions only.
--
-- Every send goes through the jobs table, so "send now" and a scheduled send are the same path,
-- and the server, not the browser, writes the record.
--
-- Also: request_project_cancel (Go's stop, the chapters' Pause) cancels only section jobs, so
-- stopping Go never cancels approved email.
--
-- Idempotent: safe to re-run.

create table if not exists public.outreach_approvals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null,
  stage_id text not null,
  message_stage_id text not null default '',
  draft_id text not null,
  purpose text not null default 'send',
  snapshot jsonb not null,
  message_hash text not null,
  ticket text not null,
  batch_id uuid,
  approved_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_reason text,
  constraint outreach_approvals_project_fk foreign key (project_id, user_id) references public.projects (id, user_id) on delete cascade,
  constraint outreach_approvals_id_user_key unique (id, user_id)
);
alter table public.outreach_approvals drop constraint if exists outreach_approvals_fields_chk;
alter table public.outreach_approvals add constraint outreach_approvals_fields_chk check (
  purpose in ('send', 'test', 'followup')
  and message_hash ~ '^[0-9a-f]{64}$'
  and ticket ~ '^[0-9a-f]{64}$'
  and pg_column_size(snapshot) < 262144
  and char_length(draft_id) between 1 and 80
  and (revoked_reason is null or char_length(revoked_reason) <= 500)
);
create index if not exists outreach_approvals_project_idx on public.outreach_approvals (project_id, draft_id);

create table if not exists public.outreach_sends (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null,
  approval_id uuid not null unique,
  job_id uuid,
  purpose text not null default 'send',
  status text not null default 'scheduled',
  status_reason text not null default '',
  scheduled_for timestamptz not null default now(),
  provider text not null default 'gmail',
  from_address text not null default '',
  to_address text not null default '',
  provider_draft_id text not null default '',
  provider_message_id text not null default '',
  provider_thread_id text not null default '',
  thread_url text not null default '',
  sent_copy_matches boolean,
  submitted_at timestamptz,
  confirmed_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outreach_sends_project_fk foreign key (project_id, user_id) references public.projects (id, user_id) on delete cascade,
  constraint outreach_sends_approval_fk foreign key (approval_id, user_id) references public.outreach_approvals (id, user_id) on delete cascade
);
alter table public.outreach_sends drop constraint if exists outreach_sends_status_chk;
alter table public.outreach_sends add constraint outreach_sends_status_chk check (
  status in ('scheduled', 'paused', 'held', 'submitting', 'submitted', 'confirmed', 'bounced', 'failed', 'cancelled')
  and purpose in ('send', 'test', 'followup')
);
create index if not exists outreach_sends_project_idx on public.outreach_sends (project_id, created_at desc);
create index if not exists outreach_sends_user_submitted_idx on public.outreach_sends (user_id, submitted_at desc);

create table if not exists public.outreach_send_events (
  id bigint generated always as identity primary key,
  send_id uuid not null references public.outreach_sends (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null,
  kind text not null,
  detail jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
create index if not exists outreach_send_events_send_idx on public.outreach_send_events (send_id, at);

alter table public.outreach_approvals enable row level security;
alter table public.outreach_sends enable row level security;
alter table public.outreach_send_events enable row level security;

drop policy if exists outreach_approvals_select on public.outreach_approvals;
create policy outreach_approvals_select on public.outreach_approvals for select using (auth.uid() = user_id);
drop policy if exists outreach_approvals_insert on public.outreach_approvals;
create policy outreach_approvals_insert on public.outreach_approvals for insert
  with check (auth.uid() = user_id and revoked_at is null);
drop policy if exists outreach_approvals_update on public.outreach_approvals;
create policy outreach_approvals_update on public.outreach_approvals for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists outreach_sends_select on public.outreach_sends;
create policy outreach_sends_select on public.outreach_sends for select using (auth.uid() = user_id);
drop policy if exists outreach_send_events_select on public.outreach_send_events;
create policy outreach_send_events_select on public.outreach_send_events for select using (auth.uid() = user_id);

-- An approval is never edited: what was approved is what the record says. It can only be revoked.
create or replace function public.outreach_approvals_revoke_only()
returns trigger
language plpgsql
as $$
begin
  if old.revoked_at is not null then
    raise exception 'that approval is already revoked' using errcode = 'check_violation';
  end if;
  if new.revoked_at is null
     or (new.id, new.user_id, new.project_id, new.stage_id, new.message_stage_id, new.draft_id, new.purpose,
         new.snapshot, new.message_hash, new.ticket, new.batch_id, new.approved_at)
        is distinct from
        (old.id, old.user_id, old.project_id, old.stage_id, old.message_stage_id, old.draft_id, old.purpose,
         old.snapshot, old.message_hash, old.ticket, old.batch_id, old.approved_at) then
    raise exception 'an approval is never edited; it can only be revoked' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
drop trigger if exists outreach_approvals_revoke_only on public.outreach_approvals;
create trigger outreach_approvals_revoke_only
  before update on public.outreach_approvals
  for each row execute function public.outreach_approvals_revoke_only();

-- ---------------------------------------------------------------------------
-- The user's moves: schedule, pause, resume, hold, cancel. Each checks the caller owns the send.
-- ---------------------------------------------------------------------------

create or replace function public.schedule_outreach_sends(
  p_project uuid,
  p_approvals uuid[],
  p_first timestamptz default now(),
  p_spacing_seconds integer default 45
) returns setof public.outreach_sends
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
  v_approval public.outreach_approvals;
  v_send public.outreach_sends;
  v_job uuid;
  v_at timestamptz := greatest(coalesce(p_first, now()), now());
  v_i integer := 0;
  v_spacing integer := greatest(coalesce(p_spacing_seconds, 45), 0);
begin
  if v_user is null or not exists (select 1 from public.projects p where p.id = p_project and p.user_id = v_user) then
    raise exception 'project not found or not owned by caller' using errcode = '42501';
  end if;
  foreach v_id in array coalesce(p_approvals, '{}') loop
    select * into v_approval from public.outreach_approvals a
      where a.id = v_id and a.user_id = v_user and a.project_id = p_project;
    if not found then
      raise exception 'approval not found' using errcode = '42501';
    end if;
    if v_approval.revoked_at is not null then
      raise exception 'that approval was withdrawn' using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.outreach_sends s where s.approval_id = v_approval.id) then
      continue;
    end if;
    insert into public.outreach_sends (user_id, project_id, approval_id, purpose, status, scheduled_for, provider, from_address, to_address)
    values (
      v_user, p_project, v_approval.id, v_approval.purpose, 'scheduled',
      v_at + make_interval(secs => v_i * v_spacing),
      coalesce(v_approval.snapshot->>'provider', 'gmail'),
      lower(coalesce(v_approval.snapshot->'from'->>'address', '')),
      lower(coalesce(v_approval.snapshot->'to'->>0, ''))
    )
    returning * into v_send;
    insert into public.jobs (user_id, project_id, kind, payload, idempotency_key, max_attempts, run_after)
    values (
      v_user, p_project,
      case when v_approval.purpose = 'test' then 'send_test' else 'send_email' end,
      jsonb_build_object('send_id', v_send.id),
      'send:' || v_approval.id::text,
      6,
      v_send.scheduled_for
    )
    on conflict (project_id, idempotency_key) do nothing
    returning id into v_job;
    update public.outreach_sends set job_id = v_job where id = v_send.id returning * into v_send;
    insert into public.outreach_send_events (send_id, user_id, project_id, kind, detail)
    values (v_send.id, v_user, p_project, 'scheduled', jsonb_build_object('for', v_send.scheduled_for));
    v_i := v_i + 1;
    return next v_send;
  end loop;
end;
$$;

-- The user's own status moves. From `scheduled` or `paused` only: once a send is in the mailbox's
-- hands the record is the server's.
create or replace function public.move_outreach_sends(
  p_sends uuid[],
  p_to text,
  p_reason text default '',
  p_revoke boolean default false
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_send public.outreach_sends;
  v_count integer := 0;
  v_job uuid;
  v_n integer;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_to not in ('paused', 'scheduled', 'held', 'cancelled') then
    raise exception 'not a move a user makes' using errcode = 'check_violation';
  end if;
  for v_send in select * from public.outreach_sends s where s.id = any (coalesce(p_sends, '{}')) and s.user_id = v_user for update loop
    if v_send.status not in ('scheduled', 'paused', 'held') or (p_to = 'scheduled' and v_send.status = 'scheduled') then
      continue;
    end if;
    -- The job that would send it stops; a resumed send gets a new one.
    update public.jobs set status = 'cancelled', cancel_requested = true, finished_at = now()
      where id = v_send.job_id and status = 'queued';
    if p_to = 'scheduled' then
      if exists (select 1 from public.outreach_approvals a where a.id = v_send.approval_id and a.revoked_at is not null) then
        continue;
      end if;
      select count(*) into v_n from public.outreach_send_events e where e.send_id = v_send.id and e.kind = 'resumed';
      insert into public.jobs (user_id, project_id, kind, payload, idempotency_key, max_attempts, run_after)
      values (v_user, v_send.project_id, case when v_send.purpose = 'test' then 'send_test' else 'send_email' end,
              jsonb_build_object('send_id', v_send.id), 'send:' || v_send.approval_id::text || ':r' || (v_n + 1), 6,
              greatest(v_send.scheduled_for, now()))
      returning id into v_job;
      update public.outreach_sends set status = 'scheduled', status_reason = '', job_id = v_job, updated_at = now() where id = v_send.id;
      insert into public.outreach_send_events (send_id, user_id, project_id, kind, detail) values (v_send.id, v_user, v_send.project_id, 'resumed', '{}');
    else
      update public.outreach_sends set status = p_to, status_reason = left(coalesce(p_reason, ''), 500), updated_at = now() where id = v_send.id;
      insert into public.outreach_send_events (send_id, user_id, project_id, kind, detail)
      values (v_send.id, v_user, v_send.project_id, p_to, jsonb_build_object('reason', left(coalesce(p_reason, ''), 500)));
      if p_revoke then
        update public.outreach_approvals set revoked_at = now(), revoked_reason = left(coalesce(p_reason, 'Changed after approval.'), 500)
          where id = v_send.approval_id and revoked_at is null;
      end if;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- The server's moves, by the drain holding the job's lease. Nobody else can write a send.
-- ---------------------------------------------------------------------------

create or replace function public.record_outreach_send(
  p_job uuid,
  p_worker text,
  p_send uuid,
  p_patch jsonb,
  p_event text,
  p_detail jsonb default '{}'::jsonb
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_send public.outreach_sends;
  v_to text := p_patch->>'status';
begin
  if not exists (select 1 from public.jobs j where j.id = p_job and j.status = 'leased' and j.lease_owner = p_worker) then
    return false;
  end if;
  select * into v_send from public.outreach_sends s where s.id = p_send and s.job_id = p_job for update;
  if not found then
    return false;
  end if;
  if v_to is not null and not (
    (v_send.status = 'scheduled' and v_to in ('submitting', 'held', 'failed', 'scheduled'))
    or (v_send.status = 'submitting' and v_to in ('submitting', 'submitted', 'confirmed', 'failed', 'held'))
    or (v_send.status = 'submitted' and v_to in ('confirmed', 'failed', 'submitted'))
  ) then
    raise exception 'a send cannot go from % to %', v_send.status, v_to using errcode = 'check_violation';
  end if;
  update public.outreach_sends set
    status = coalesce(v_to, status),
    status_reason = coalesce(left(p_patch->>'status_reason', 500), status_reason),
    provider_draft_id = coalesce(p_patch->>'provider_draft_id', provider_draft_id),
    provider_message_id = coalesce(p_patch->>'provider_message_id', provider_message_id),
    provider_thread_id = coalesce(p_patch->>'provider_thread_id', provider_thread_id),
    thread_url = coalesce(p_patch->>'thread_url', thread_url),
    sent_copy_matches = coalesce((p_patch->>'sent_copy_matches')::boolean, sent_copy_matches),
    submitted_at = case when v_to = 'submitted' then coalesce(submitted_at, now()) else submitted_at end,
    confirmed_at = case when v_to = 'confirmed' then coalesce(confirmed_at, now()) else confirmed_at end,
    failed_at = case when v_to = 'failed' then now() else failed_at end,
    updated_at = now()
  where id = p_send;
  if p_event is not null and p_event <> '' then
    insert into public.outreach_send_events (send_id, user_id, project_id, kind, detail)
    values (p_send, v_send.user_id, v_send.project_id, left(p_event, 40), coalesce(p_detail, '{}'::jsonb));
  end if;
  -- An email that reached the mailbox goes on the person's record of who was contacted.
  if v_to = 'confirmed' and v_send.purpose = 'send' and v_send.to_address <> '' then
    insert into public.outreach_history (user_id, address, domain, occurred_on, source, project_id, subject, thread_url)
    select v_send.user_id, v_send.to_address, split_part(v_send.to_address, '@', 2), current_date, 'promptmaster', v_send.project_id,
           left(coalesce(a.snapshot->>'subject', ''), 300),
           case when coalesce(p_patch->>'thread_url', v_send.thread_url) ~ '^https://' then left(coalesce(p_patch->>'thread_url', v_send.thread_url), 500) else '' end
    from public.outreach_approvals a where a.id = v_send.approval_id;
  end if;
  return true;
end;
$$;

-- An outreach job that ends without sending says so on its send, and how sure that is.
create or replace function public.outreach_job_ended()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.kind in ('send_email', 'send_test') and new.status in ('dead', 'failed') and old.status is distinct from new.status then
    update public.outreach_sends s set
      status = 'failed',
      failed_at = now(),
      status_reason = case when s.status = 'submitting'
        then 'It may or may not have gone out: check your Sent mail before sending it again. ' || coalesce(new.error_message, '')
        else coalesce(nullif(new.error_message, ''), 'It could not be sent.') end,
      updated_at = now()
    where s.job_id = new.id and s.status in ('scheduled', 'submitting');
  end if;
  return new;
end;
$$;
drop trigger if exists outreach_job_ended on public.jobs;
create trigger outreach_job_ended
  after update of status on public.jobs
  for each row execute function public.outreach_job_ended();

revoke all on function public.schedule_outreach_sends(uuid, uuid[], timestamptz, integer) from public;
revoke all on function public.move_outreach_sends(uuid[], text, text, boolean) from public;
revoke all on function public.record_outreach_send(uuid, text, uuid, jsonb, text, jsonb) from public;
grant execute on function public.schedule_outreach_sends(uuid, uuid[], timestamptz, integer) to authenticated;
grant execute on function public.move_outreach_sends(uuid[], text, text, boolean) to authenticated;
grant execute on function public.record_outreach_send(uuid, text, uuid, jsonb, text, jsonb) to service_role;

-- Go's stop and the chapters' Pause cancel section jobs only: never an approved email.
create or replace function public.request_project_cancel(p_project_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_count   integer;
begin
  select p.user_id into v_user_id
  from public.projects p
  where p.id = p_project_id
    and (auth.uid() is null or p.user_id = auth.uid());

  if v_user_id is null then
    raise exception 'project not found or not owned by caller' using errcode = '42501';
  end if;

  update public.jobs
  set cancel_requested = true,
      status      = case when status = 'queued' then 'cancelled' else status end,
      finished_at = case when status = 'queued' then now() else finished_at end
  where project_id = p_project_id
    and kind = 'draft_section'
    and status in ('queued', 'leased');

  get diagnostics v_count = row_count;
  return coalesce(v_count, 0);
end;
$$;
