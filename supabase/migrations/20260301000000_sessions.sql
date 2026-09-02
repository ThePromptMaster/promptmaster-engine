-- Baseline: sessions table.
--
-- Reconstructed from the hosted project on 2026-09-02 via `supabase db dump`.
-- This table predates any checked-in migration; it was applied by hand. The
-- DDL below reproduces the live schema exactly so the repo becomes the source
-- of truth. Idempotent: safe to re-run.

create table if not exists public.sessions (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  session_id text not null,
  objective  text not null default ''::text,
  mode       text not null default 'architect'::text,
  audience   text not null default 'General'::text,
  iterations integer not null default 0,
  finalized  boolean not null default false,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- saveSession() upserts with onConflict 'user_id,session_id'; without this
-- constraint the upsert silently becomes an insert and duplicates rows.
alter table public.sessions drop constraint if exists sessions_user_id_session_id_key;
alter table public.sessions add constraint sessions_user_id_session_id_key unique (user_id, session_id);

create index if not exists idx_sessions_user_id on public.sessions using btree (user_id, created_at desc);

alter table public.sessions enable row level security;

drop policy if exists "Users can read own sessions" on public.sessions;
create policy "Users can read own sessions" on public.sessions
  for select using (auth.uid() = user_id);

drop policy if exists "Users can insert own sessions" on public.sessions;
create policy "Users can insert own sessions" on public.sessions
  for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update own sessions" on public.sessions;
create policy "Users can update own sessions" on public.sessions
  for update using (auth.uid() = user_id);

drop policy if exists "Users can delete own sessions" on public.sessions;
create policy "Users can delete own sessions" on public.sessions
  for delete using (auth.uid() = user_id);
