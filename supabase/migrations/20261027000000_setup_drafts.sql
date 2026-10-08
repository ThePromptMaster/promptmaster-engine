-- U2 (Sean, 7 Oct, email 14): "I signed out during setup, and when I returned,
-- the setup wasn't retained … Could you check whether unfinished setup and
-- workflow edits are saved?"
--
-- One unfinished setup per user: what was asked, the setup card, the
-- conversation at the front door, the workflow being designed. Written as the
-- user works (debounced), read when /projects/new opens, deleted when the
-- project is created or the user starts fresh. Attached files are not kept
-- here; the page says so.
--
-- Owner-only. No project exists yet, so there is no composite key to carry.
--
-- Idempotent: safe to re-run.

create table if not exists public.setup_drafts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.setup_drafts enable row level security;

drop policy if exists setup_drafts_select on public.setup_drafts;
create policy setup_drafts_select on public.setup_drafts for select using (auth.uid() = user_id);
drop policy if exists setup_drafts_insert on public.setup_drafts;
create policy setup_drafts_insert on public.setup_drafts for insert with check (auth.uid() = user_id);
drop policy if exists setup_drafts_update on public.setup_drafts;
create policy setup_drafts_update on public.setup_drafts for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists setup_drafts_delete on public.setup_drafts;
create policy setup_drafts_delete on public.setup_drafts for delete using (auth.uid() = user_id);

-- A draft is a few pages of text, not a store.
alter table public.setup_drafts drop constraint if exists setup_drafts_size_chk;
alter table public.setup_drafts add constraint setup_drafts_size_chk check (pg_column_size(data) < 2000000);
