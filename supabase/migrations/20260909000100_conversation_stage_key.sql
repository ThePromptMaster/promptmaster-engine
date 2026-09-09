-- The side chat belongs to a project's STAGE, not to a session's iteration.
--
-- conversation_messages was keyed (user_id, session_id, iteration_number) by
-- the 2026-05-01 refactor, and the M1 import added project_id and version_id
-- alongside. Nothing in it names a *stage*, so a chat held on the Audience
-- stage and one held on the Critique stage of the same project were
-- indistinguishable — the whole project's history would replay into both.
--
-- Both columns are additive and nullable, so every existing row stays valid
-- and the legacy (session_id, iteration_number) reader is untouched. Rows
-- written before this migration simply have no stage, which is true: they were
-- written by a flow that had none.
--
-- `meta` carries what the thread needs to redisplay itself after a refresh —
-- which mode a message was sent in, and for an instruction, the scope it was
-- applied to. Without it a reloaded thread cannot tell a question that changed
-- nothing from an instruction that appended a version, which is the one
-- distinction the panel exists to make visible.

alter table public.conversation_messages
  add column if not exists stage_id text,
  add column if not exists meta jsonb not null default '{}'::jsonb;

-- Partial, because most rows in the table are legacy and have no stage.
create index if not exists conversation_messages_stage_lookup
  on public.conversation_messages (project_id, stage_id, created_at)
  where project_id is not null and stage_id is not null;

-- RLS is already enabled on this table with a "users manage own" policy keyed
-- on user_id; new columns inherit it. Restated here so a reader of this file
-- does not have to go looking to confirm the new key is not a way around it.
alter table public.conversation_messages enable row level security;

drop policy if exists "Users manage own conversation messages" on public.conversation_messages;
create policy "Users manage own conversation messages" on public.conversation_messages
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
