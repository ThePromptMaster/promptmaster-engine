-- 17 Nov (Sean): "I'm also wondering whether Go should start automatically once the user
-- starts the project." It does now, under Autonomous, for a project of more than one stage;
-- this is the person's switch for it, on unless they turn it off in Settings.
--
-- Idempotent: safe to re-run.

alter table public.user_preferences
  add column if not exists go_autostart boolean not null default true;
