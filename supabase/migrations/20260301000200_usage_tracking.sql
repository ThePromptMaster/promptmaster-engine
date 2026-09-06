-- Baseline: usage_tracking table.
-- Reconstructed from the hosted project on 2026-09-02. Idempotent.
--
-- Append-only by design: INSERT + SELECT policies only, no UPDATE or DELETE.

create table if not exists public.usage_tracking (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  action     text not null default 'iteration'::text,
  created_at timestamptz not null default now()
);

create index if not exists idx_usage_user_date on public.usage_tracking using btree (user_id, created_at);

alter table public.usage_tracking enable row level security;

drop policy if exists "Users can read own usage" on public.usage_tracking;
create policy "Users can read own usage" on public.usage_tracking
  for select using (auth.uid() = user_id);

drop policy if exists "Users can insert own usage" on public.usage_tracking;
create policy "Users can insert own usage" on public.usage_tracking
  for insert with check (auth.uid() = user_id);
