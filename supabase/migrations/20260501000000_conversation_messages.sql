-- Baseline: conversation_messages table (per-iteration chat threads).
-- Introduced by the 2026-05-01 conversation/iteration refactor.
-- Reconstructed from the hosted project on 2026-09-02. Idempotent.
--
-- NOTE: (session_id, iteration_number) is a stringly-typed pointer with no FK
-- to sessions — deliberate at the time, to keep client-side session creation
-- flexible. It is also why the summary-phase session_id bug (fixed 2026-09-02)
-- silently orphaned chat history: nothing in the DB could complain.

create table if not exists public.conversation_messages (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  session_id       text not null,
  iteration_number integer not null,
  role             text not null,
  content          text not null,
  created_at       timestamptz default now(),
  constraint conversation_messages_role_check check (role = any (array['user'::text, 'assistant'::text]))
);

create index if not exists conversation_messages_lookup
  on public.conversation_messages using btree (user_id, session_id, iteration_number, created_at);

alter table public.conversation_messages enable row level security;

drop policy if exists "Users manage own conversation messages" on public.conversation_messages;
create policy "Users manage own conversation messages" on public.conversation_messages
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
