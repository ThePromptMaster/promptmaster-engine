-- Custom Modes table — user-scoped persona library.
--
-- Rewritten 2026-09-02 to be idempotent and to match the hosted schema exactly.
-- The original version used bare `create policy`, which errors 42710 on re-run
-- (Postgres has no `create policy if not exists`). Every migration in this repo
-- now uses `drop policy if exists` first.

create table if not exists public.custom_modes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  preamble   text not null,
  tone       text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists custom_modes_user_id_idx
  on public.custom_modes using btree (user_id, created_at desc);

alter table public.custom_modes enable row level security;

drop policy if exists "custom_modes_owner_select" on public.custom_modes;
create policy "custom_modes_owner_select" on public.custom_modes
  for select using (auth.uid() = user_id);

drop policy if exists "custom_modes_owner_insert" on public.custom_modes;
create policy "custom_modes_owner_insert" on public.custom_modes
  for insert with check (auth.uid() = user_id);

-- Live schema has no WITH CHECK here. Postgres defaults WITH CHECK to the
-- USING expression for UPDATE, so this is behaviourally equivalent to the
-- original migration; reproduced as-is so `db diff` stays empty.
drop policy if exists "custom_modes_owner_update" on public.custom_modes;
create policy "custom_modes_owner_update" on public.custom_modes
  for update using (auth.uid() = user_id);

drop policy if exists "custom_modes_owner_delete" on public.custom_modes;
create policy "custom_modes_owner_delete" on public.custom_modes
  for delete using (auth.uid() = user_id);

-- Touch updated_at on UPDATE.
create or replace function public.custom_modes_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists custom_modes_set_updated_at on public.custom_modes;
create trigger custom_modes_set_updated_at
  before update on public.custom_modes
  for each row execute function public.custom_modes_touch_updated_at();
