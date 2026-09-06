-- Baseline: templates table.
-- Reconstructed from the hosted project on 2026-09-02. Idempotent.

create table if not exists public.templates (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  template_id text not null,
  name        text not null,
  mode        text not null default 'architect'::text,
  audience    text not null default 'General'::text,
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

alter table public.templates drop constraint if exists templates_user_id_template_id_key;
alter table public.templates add constraint templates_user_id_template_id_key unique (user_id, template_id);

create index if not exists idx_templates_user_id on public.templates using btree (user_id, created_at desc);

alter table public.templates enable row level security;

drop policy if exists "Users can read own templates" on public.templates;
create policy "Users can read own templates" on public.templates
  for select using (auth.uid() = user_id);

drop policy if exists "Users can insert own templates" on public.templates;
create policy "Users can insert own templates" on public.templates
  for insert with check (auth.uid() = user_id);

drop policy if exists "Users can delete own templates" on public.templates;
create policy "Users can delete own templates" on public.templates
  for delete using (auth.uid() = user_id);

-- NOTE: the live schema has no UPDATE policy on templates. saveTemplate()
-- upserts on (user_id, template_id), and an upsert that hits the conflict
-- needs UPDATE — so it would fail under RLS. Not fixed here because this
-- baseline must reproduce live state exactly; saveTemplate currently has zero
-- call sites, so the path is unreachable. Add the policy when template
-- creation is actually wired up.
