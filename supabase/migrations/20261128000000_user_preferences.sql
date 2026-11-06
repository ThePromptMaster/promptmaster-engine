-- One row per user: how they chose to have the app suggest work to them (the
-- client's call, 4 Nov). Nothing here is project data, and there is no project to
-- carry a composite key, so it follows setup_drafts: owner-only under RLS.
--
-- `questionnaire` holds the taps of the short questionnaire and nothing typed.
-- `connections` will record which accounts were connected and when. It never holds
-- a token: tokens stay in the browser's memory.
--
-- A guest is an authenticated user, so a guest has a row too, and upgrading keeps
-- the user id, so the answers carry over.
--
-- Idempotent: safe to re-run.

create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  personalization text not null default 'unset',
  questionnaire jsonb not null default '{}'::jsonb,
  connections jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_preferences drop constraint if exists user_preferences_personalization_chk;
alter table public.user_preferences add constraint user_preferences_personalization_chk
  check (personalization in ('unset', 'questionnaire', 'connected', 'declined'));

-- A few taps and a few dates, not a store.
alter table public.user_preferences drop constraint if exists user_preferences_size_chk;
alter table public.user_preferences add constraint user_preferences_size_chk
  check (pg_column_size(questionnaire) + pg_column_size(connections) < 20000);

alter table public.user_preferences enable row level security;

drop policy if exists user_preferences_select on public.user_preferences;
create policy user_preferences_select on public.user_preferences for select using (auth.uid() = user_id);
drop policy if exists user_preferences_insert on public.user_preferences;
create policy user_preferences_insert on public.user_preferences for insert with check (auth.uid() = user_id);
drop policy if exists user_preferences_update on public.user_preferences;
create policy user_preferences_update on public.user_preferences for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists user_preferences_delete on public.user_preferences;
create policy user_preferences_delete on public.user_preferences for delete using (auth.uid() = user_id);
