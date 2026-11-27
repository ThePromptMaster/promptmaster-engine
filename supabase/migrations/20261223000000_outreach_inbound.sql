-- Follow-ups and what came back (Sean, 26 Nov: follow-ups that stop on a reply, a bounce or an
-- opt-out; a reply from the company pausing the other emails to it; a reply naming someone else
-- becoming the next contact). Phase 7, L-312 and L-313. Idempotent.
--
-- * outreach_sends.parent_send_id: a follow-up's first email.
-- * outreach_inbound: what came back for an email, written only by the server (the job runner,
--   holding a job's lease); the user may only mark one handled.
-- * schedule_outreach_followup: when a first email is confirmed, its approved follow-up is queued
--   after the business days the user chose (the job runner works out the time).
-- * record_outreach_inbound: what came back, and what it does: a reply, bounce or opt-out cancels the
--   follow-up; a bounce marks the email bounced; an opt-out puts the address on the do-not-contact list
--   and holds every queued email to it; a reply from the company pauses the other queued emails to it.
-- * request_outreach_watch: the page asks for a check now (on open).

alter table public.outreach_sends add column if not exists parent_send_id uuid references public.outreach_sends (id) on delete cascade;
create index if not exists outreach_sends_parent_idx on public.outreach_sends (parent_send_id) where parent_send_id is not null;

create table if not exists public.outreach_inbound (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null,
  send_id uuid not null references public.outreach_sends (id) on delete cascade,
  kind text not null,
  provider_message_id text not null,
  from_address text not null default '',
  subject text not null default '',
  text text not null default '',
  company_domain text not null default '',
  received_at timestamptz,
  handled_at timestamptz,
  created_at timestamptz not null default now(),
  constraint outreach_inbound_project_fk foreign key (project_id, user_id) references public.projects (id, user_id) on delete cascade
);
create unique index if not exists outreach_inbound_message_idx on public.outreach_inbound (send_id, provider_message_id);
create index if not exists outreach_inbound_project_idx on public.outreach_inbound (project_id, created_at desc);
alter table public.outreach_inbound drop constraint if exists outreach_inbound_fields_chk;
alter table public.outreach_inbound add constraint outreach_inbound_fields_chk check (
  kind in ('reply', 'auto_reply', 'bounce', 'opt_out')
  and char_length(provider_message_id) between 1 and 200
  and char_length(from_address) <= 320
  and char_length(subject) <= 300
  and char_length(text) <= 4000
  and char_length(company_domain) <= 255
);

alter table public.outreach_inbound enable row level security;
drop policy if exists outreach_inbound_select on public.outreach_inbound;
create policy outreach_inbound_select on public.outreach_inbound for select using (auth.uid() = user_id);
drop policy if exists outreach_inbound_update on public.outreach_inbound;
create policy outreach_inbound_update on public.outreach_inbound for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- What came back is the mailbox's record: the user may only mark it handled.
create or replace function public.outreach_inbound_handled_only()
returns trigger
language plpgsql
as $$
begin
  if (to_jsonb(new) - 'handled_at') is distinct from (to_jsonb(old) - 'handled_at') then
    raise exception 'what came back is not edited; it can only be marked handled' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
drop trigger if exists outreach_inbound_handled_only on public.outreach_inbound;
create trigger outreach_inbound_handled_only before update on public.outreach_inbound
  for each row execute function public.outreach_inbound_handled_only();

-- ---------------------------------------------------------------------------
-- The server's moves, by the job runner holding a job's lease.
-- ---------------------------------------------------------------------------

create or replace function public.schedule_outreach_followup(
  p_job uuid,
  p_worker text,
  p_send uuid,
  p_run_after timestamptz
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_send public.outreach_sends;
  v_first public.outreach_approvals;
  v_follow public.outreach_approvals;
  v_new public.outreach_sends;
  v_job uuid;
begin
  if not exists (select 1 from public.jobs j where j.id = p_job and j.status = 'leased' and j.lease_owner = p_worker) then
    return null;
  end if;
  select * into v_send from public.outreach_sends s where s.id = p_send and s.job_id = p_job;
  if not found or v_send.purpose <> 'send' or v_send.status not in ('submitted', 'confirmed') then
    return null;
  end if;
  select * into v_first from public.outreach_approvals a where a.id = v_send.approval_id;
  -- The follow-up approved for the same email, not withdrawn, the latest.
  select * into v_follow from public.outreach_approvals a
    where a.project_id = v_send.project_id and a.user_id = v_send.user_id and a.draft_id = v_first.draft_id
      and a.purpose = 'followup' and a.revoked_at is null and a.approved_at >= v_first.approved_at - interval '1 minute'
    order by a.approved_at desc limit 1;
  if not found or exists (select 1 from public.outreach_sends s where s.approval_id = v_follow.id) then
    return null;
  end if;
  insert into public.outreach_sends (user_id, project_id, approval_id, purpose, status, scheduled_for, provider, from_address, to_address, parent_send_id)
  values (
    v_send.user_id, v_send.project_id, v_follow.id, 'followup', 'scheduled', greatest(p_run_after, now()),
    v_send.provider, v_send.from_address, lower(coalesce(v_follow.snapshot->'to'->>0, v_send.to_address)), v_send.id
  )
  returning * into v_new;
  insert into public.jobs (user_id, project_id, kind, payload, idempotency_key, max_attempts, run_after)
  values (v_send.user_id, v_send.project_id, 'send_followup', jsonb_build_object('send_id', v_new.id), 'send:' || v_follow.id::text, 6, v_new.scheduled_for)
  on conflict (project_id, idempotency_key) do nothing
  returning id into v_job;
  update public.outreach_sends set job_id = v_job where id = v_new.id;
  insert into public.outreach_send_events (send_id, user_id, project_id, kind, detail)
  values (v_new.id, v_send.user_id, v_send.project_id, 'scheduled', jsonb_build_object('for', v_new.scheduled_for, 'after', v_send.id));
  return v_new.id;
end;
$$;

-- What came back for one email, and what it does. Items: [{kind, message_id, from, subject, text, at, company_domain}].
create or replace function public.record_outreach_inbound(
  p_job uuid,
  p_worker text,
  p_send uuid,
  p_items jsonb
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.jobs;
  v_send public.outreach_sends;
  v_item jsonb;
  v_new integer := 0;
  v_kind text;
  v_when text;
  v_reason text;
  v_ids uuid[];
begin
  select * into v_job from public.jobs j where j.id = p_job and j.status = 'leased' and j.lease_owner = p_worker;
  if not found then
    return 0;
  end if;
  select * into v_send from public.outreach_sends s where s.id = p_send and s.user_id = v_job.user_id and s.project_id = v_job.project_id;
  if not found then
    return 0;
  end if;
  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_kind := v_item->>'kind';
    if v_kind not in ('reply', 'auto_reply', 'bounce', 'opt_out') then
      continue;
    end if;
    insert into public.outreach_inbound (user_id, project_id, send_id, kind, provider_message_id, from_address, subject, text, company_domain, received_at)
    values (
      v_send.user_id, v_send.project_id, v_send.id, v_kind, left(v_item->>'message_id', 200),
      left(lower(coalesce(v_item->>'from', '')), 320), left(coalesce(v_item->>'subject', ''), 300),
      left(coalesce(v_item->>'text', ''), 4000), left(lower(coalesce(v_item->>'company_domain', '')), 255),
      nullif(v_item->>'at', '')::timestamptz
    )
    on conflict (send_id, provider_message_id) do nothing;
    if not found then
      continue;
    end if;
    v_new := v_new + 1;
    if v_kind = 'auto_reply' then
      continue;
    end if;
    v_when := to_char(coalesce(nullif(v_item->>'at', '')::timestamptz, now()), 'DD Mon YYYY');
    v_reason := case v_kind
      when 'reply' then 'They replied on ' || v_when || '.'
      when 'bounce' then 'The email bounced on ' || v_when || '.'
      else 'They asked not to be contacted on ' || v_when || '.' end;

    -- The follow-ups of this email stop.
    select array_agg(s.id) into v_ids from public.outreach_sends s
      where s.parent_send_id = v_send.id and s.status in ('scheduled', 'paused', 'held');
    if v_ids is not null then
      update public.jobs set status = 'cancelled', cancel_requested = true, finished_at = now()
        where id in (select job_id from public.outreach_sends where id = any (v_ids)) and status in ('queued', 'leased');
      update public.outreach_sends set status = 'cancelled', status_reason = 'Follow-up not sent: ' || v_reason, updated_at = now() where id = any (v_ids);
      insert into public.outreach_send_events (send_id, user_id, project_id, kind, detail)
        select unnest(v_ids), v_send.user_id, v_send.project_id, 'cancelled', jsonb_build_object('because', v_kind);
    end if;

    if v_kind = 'bounce' then
      update public.outreach_sends set status = 'bounced', status_reason = v_reason, updated_at = now()
        where id = v_send.id and status in ('submitted', 'confirmed');
      insert into public.outreach_suppressions (user_id, address, reason, note)
        select v_send.user_id, v_send.to_address, 'bounced', v_reason
        where not exists (select 1 from public.outreach_suppressions x where x.user_id = v_send.user_id and x.address = v_send.to_address and x.lifted_at is null);
    end if;

    if v_kind = 'opt_out' then
      insert into public.outreach_suppressions (user_id, address, reason, note)
        select v_send.user_id, v_send.to_address, 'opted_out', v_reason
        where not exists (select 1 from public.outreach_suppressions x where x.user_id = v_send.user_id and x.address = v_send.to_address and x.lifted_at is null and x.reason = 'opted_out');
      -- Every queued email to them, in any project, is held.
      select array_agg(s.id) into v_ids from public.outreach_sends s
        where s.user_id = v_send.user_id and s.to_address = v_send.to_address and s.status in ('scheduled', 'paused');
      if v_ids is not null then
        update public.jobs set status = 'cancelled', cancel_requested = true, finished_at = now()
          where id in (select job_id from public.outreach_sends where id = any (v_ids)) and status in ('queued', 'leased');
        update public.outreach_sends set status = 'held', status_reason = v_reason, updated_at = now() where id = any (v_ids);
      end if;
    end if;

    -- A reply from the company: the other queued emails to it in this project wait for the user.
    if v_kind in ('reply', 'opt_out') and coalesce(v_item->>'company_domain', '') <> '' then
      select array_agg(s.id) into v_ids from public.outreach_sends s
        where s.project_id = v_send.project_id and s.status = 'scheduled' and s.id <> v_send.id
          and s.parent_send_id is distinct from v_send.id
          and split_part(s.to_address, '@', 2) = lower(v_item->>'company_domain');
      if v_ids is not null then
        update public.jobs set status = 'cancelled', cancel_requested = true, finished_at = now()
          where id in (select job_id from public.outreach_sends where id = any (v_ids)) and status in ('queued', 'leased');
        update public.outreach_sends set status = 'paused',
          status_reason = 'Paused: ' || lower(v_item->>'company_domain') || ' replied on ' || v_when || '. Resume to send it anyway.', updated_at = now()
          where id = any (v_ids);
      end if;
    end if;
  end loop;
  return v_new;
end;
$$;

-- The page asks for a check now: one watch job per project per ten minutes.
create or replace function public.request_outreach_watch(p_project uuid) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_job uuid;
begin
  if v_user is null or not exists (select 1 from public.projects p where p.id = p_project and p.user_id = v_user) then
    raise exception 'project not found or not owned by caller' using errcode = '42501';
  end if;
  if not exists (select 1 from public.outreach_sends s where s.project_id = p_project and s.purpose = 'send' and s.status in ('submitted', 'confirmed')) then
    return null;
  end if;
  insert into public.jobs (user_id, project_id, kind, payload, idempotency_key, max_attempts, run_after)
  values (v_user, p_project, 'outreach_watch', jsonb_build_object('project_id', p_project), 'watch:' || p_project::text || ':' || to_char(now(), 'YYYYMMDDHH24') || floor(extract(minute from now()) / 10)::text, 3, now())
  on conflict (project_id, idempotency_key) do nothing
  returning id into v_job;
  return v_job;
end;
$$;

-- A follow-up job that ends without sending says so, like a first email's.
create or replace function public.outreach_job_ended()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.kind in ('send_email', 'send_test', 'send_followup') and new.status in ('dead', 'failed') and old.status is distinct from new.status then
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

revoke all on function public.schedule_outreach_followup(uuid, text, uuid, timestamptz) from public;
revoke all on function public.record_outreach_inbound(uuid, text, uuid, jsonb) from public;
revoke all on function public.request_outreach_watch(uuid) from public;
grant execute on function public.request_outreach_watch(uuid) to authenticated;
