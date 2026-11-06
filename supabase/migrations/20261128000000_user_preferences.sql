-- One row per user: the taps of the short questionnaire on the examples (the client's
-- call, 4 Nov). Nothing typed is kept here. Nothing here is project data, and there is
-- no project to carry a composite key, so it follows setup_drafts: owner-only under RLS.
--
-- A guest is an authenticated user, so a guest has a row too, and upgrading keeps the
-- user id, so the answers carry over.
--
-- Idempotent: safe to re-run.

create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  questionnaire jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- A few taps, not a store.
alter table public.user_preferences drop constraint if exists user_preferences_size_chk;
alter table public.user_preferences add constraint user_preferences_size_chk
  check (pg_column_size(questionnaire) < 4000);

alter table public.user_preferences enable row level security;

drop policy if exists user_preferences_select on public.user_preferences;
create policy user_preferences_select on public.user_preferences for select using (auth.uid() = user_id);
drop policy if exists user_preferences_insert on public.user_preferences;
create policy user_preferences_insert on public.user_preferences for insert with check (auth.uid() = user_id);
drop policy if exists user_preferences_update on public.user_preferences;
create policy user_preferences_update on public.user_preferences for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists user_preferences_delete on public.user_preferences;
create policy user_preferences_delete on public.user_preferences for delete using (auth.uid() = user_id);
