-- Who has been contacted, and who must not be (Sean, 26 Nov: "Check the project history and, if
-- I've connected the mailbox for that purpose, Sent mail. Catch duplicate people and addresses and
-- show when I've reached somebody else at the same company. I should be able to record outreach I
-- did outside PromptMaster too … Build in a suppression list that survives another import").
--
-- Per user, owner-only under RLS, and kept apart from any project: deleting a project, or
-- importing the same list again, never forgets who was written to or who asked not to be.
--
--   outreach_history       one earlier touch: an address, when, and where it is known from.
--                          source 'manual' (the user's own record) and 'mailbox' (found in their
--                          Sent mail, recorded on their press) are written by the user;
--                          'promptmaster' (an email PromptMaster sent) only by the server, later.
--   outreach_suppressions  an address or a whole domain not to write to. A user adds one; only
--                          `lifted_at` may change after, and an opt-out or a complaint can never
--                          be lifted.
--
-- Idempotent: safe to re-run.

create table if not exists public.outreach_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  address text not null,
  domain text not null default '',
  person_name text not null default '',
  company text not null default '',
  occurred_on date,
  channel text not null default 'email',
  source text not null,
  -- The project it was recorded from, if any. No foreign key: the record outlives the project.
  project_id uuid,
  subject text not null default '',
  thread_url text not null default '',
  note text not null default '',
  retired_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.outreach_history drop constraint if exists outreach_history_fields_chk;
alter table public.outreach_history add constraint outreach_history_fields_chk check (
  source in ('manual', 'mailbox', 'promptmaster')
  and channel in ('email', 'phone', 'linkedin', 'meeting', 'other')
  and char_length(address) between 3 and 320 and address = lower(address) and position('@' in address) > 1
  and char_length(domain) <= 255 and domain = lower(domain)
  and char_length(person_name) <= 160 and char_length(company) <= 160
  and char_length(subject) <= 300 and char_length(note) <= 500
  and (thread_url = '' or (thread_url ~ '^https://' and char_length(thread_url) <= 500))
);
create index if not exists outreach_history_user_address_idx on public.outreach_history (user_id, address);
create index if not exists outreach_history_user_domain_idx on public.outreach_history (user_id, domain);

create table if not exists public.outreach_suppressions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  address text,
  domain text,
  reason text not null,
  note text not null default '',
  lifted_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.outreach_suppressions drop constraint if exists outreach_suppressions_fields_chk;
alter table public.outreach_suppressions add constraint outreach_suppressions_fields_chk check (
  (address is not null or domain is not null)
  and (address is null or (char_length(address) between 3 and 320 and address = lower(address) and position('@' in address) > 1))
  and (domain is null or (char_length(domain) between 3 and 255 and domain = lower(domain) and position('.' in domain) > 1))
  and reason in ('opted_out', 'bounced', 'complained', 'company_replied', 'manual')
  and char_length(note) <= 500
);
create index if not exists outreach_suppressions_user_idx on public.outreach_suppressions (user_id);

alter table public.outreach_history enable row level security;
alter table public.outreach_suppressions enable row level security;

drop policy if exists outreach_history_select on public.outreach_history;
create policy outreach_history_select on public.outreach_history for select using (auth.uid() = user_id);
-- The user records their own touches and what their Sent mail showed; a PromptMaster send is the server's to record.
drop policy if exists outreach_history_insert on public.outreach_history;
create policy outreach_history_insert on public.outreach_history for insert
  with check (auth.uid() = user_id and source in ('manual', 'mailbox'));
-- A record the user made can be retired (a mistake); nothing else changes.
drop policy if exists outreach_history_update on public.outreach_history;
create policy outreach_history_update on public.outreach_history for update
  using (auth.uid() = user_id and source in ('manual', 'mailbox'))
  with check (auth.uid() = user_id and source in ('manual', 'mailbox'));

drop policy if exists outreach_suppressions_select on public.outreach_suppressions;
create policy outreach_suppressions_select on public.outreach_suppressions for select using (auth.uid() = user_id);
drop policy if exists outreach_suppressions_insert on public.outreach_suppressions;
create policy outreach_suppressions_insert on public.outreach_suppressions for insert
  with check (auth.uid() = user_id and reason in ('manual', 'opted_out') and lifted_at is null);
drop policy if exists outreach_suppressions_update on public.outreach_suppressions;
create policy outreach_suppressions_update on public.outreach_suppressions for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Only retiring a history record, and only lifting a suppression that may be lifted.
create or replace function public.outreach_history_retire_only()
returns trigger
language plpgsql
as $$
begin
  if old.retired_at is not null then
    raise exception 'that record is already retired' using errcode = 'check_violation';
  end if;
  if new.retired_at is null
     or (new.id, new.user_id, new.address, new.domain, new.person_name, new.company, new.occurred_on, new.channel,
         new.source, new.project_id, new.subject, new.thread_url, new.note, new.created_at)
        is distinct from
        (old.id, old.user_id, old.address, old.domain, old.person_name, old.company, old.occurred_on, old.channel,
         old.source, old.project_id, old.subject, old.thread_url, old.note, old.created_at) then
    raise exception 'a contact record is never edited; it can only be retired' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
drop trigger if exists outreach_history_retire_only on public.outreach_history;
create trigger outreach_history_retire_only
  before update on public.outreach_history
  for each row execute function public.outreach_history_retire_only();

create or replace function public.outreach_suppressions_lift_only()
returns trigger
language plpgsql
as $$
begin
  if old.lifted_at is not null then
    raise exception 'that suppression is already lifted' using errcode = 'check_violation';
  end if;
  if old.reason in ('opted_out', 'complained') then
    raise exception 'someone who opted out or complained is never written to again' using errcode = 'check_violation';
  end if;
  if new.lifted_at is null
     or (new.id, new.user_id, new.address, new.domain, new.reason, new.note, new.created_at)
        is distinct from
        (old.id, old.user_id, old.address, old.domain, old.reason, old.note, old.created_at) then
    raise exception 'a suppression is never edited; it can only be lifted' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
drop trigger if exists outreach_suppressions_lift_only on public.outreach_suppressions;
create trigger outreach_suppressions_lift_only
  before update on public.outreach_suppressions
  for each row execute function public.outreach_suppressions_lift_only();
