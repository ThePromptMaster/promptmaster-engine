-- Baseline: user_presets table (custom constraint/format pills).
-- Introduced by the 2026-04-16 conversation-bridge + custom-presets project.
-- Reconstructed from the hosted project on 2026-09-02. Idempotent.

create table if not exists public.user_presets (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  type       text not null,
  label      text not null,
  created_at timestamptz default now(),
  constraint user_presets_type_check check (type = any (array['constraint'::text, 'format'::text]))
);

create unique index if not exists user_presets_unique
  on public.user_presets using btree (user_id, type, label);

alter table public.user_presets enable row level security;

-- Single ALL policy (not the four-policy pattern used elsewhere).
drop policy if exists "Users manage own presets" on public.user_presets;
create policy "Users manage own presets" on public.user_presets
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
