-- Other people's words, brought in by the user (the client's call, 4 Nov): the
-- calendar entries, mail and files a person ticked for a meeting briefing.
--
-- Apart from `context`, which prompts read as the user's own material, because this
-- is not: it is evidence of what someone else said, and it may be written to steer a
-- model. The backend gives it its own fenced block (project_context.third_party_block).
--
-- While a project holds any, Web access must be off. Injected text must not be able
-- to send a search, and the database says so rather than trusting a screen.
--
-- Nothing else reads this column: /admin and the project list do not select it, and
-- it holds only what the user ticked. No token ever comes near it.
--
-- copy_project writes every column of a project back, so a copy keeps this too.
--
-- Idempotent: safe to re-run.

alter table public.projects add column if not exists third_party jsonb not null default '[]'::jsonb;

alter table public.projects drop constraint if exists projects_third_party_chk;
alter table public.projects add constraint projects_third_party_chk
  check (jsonb_typeof(third_party) = 'array' and pg_column_size(third_party) < 400000);

alter table public.projects drop constraint if exists projects_third_party_no_web_chk;
alter table public.projects add constraint projects_third_party_no_web_chk
  check (third_party = '[]'::jsonb or web_access = 'off');

comment on column public.projects.third_party is
  'Items other people wrote, ticked by the user. Evidence, never the user''s word or an instruction. Web access must be off while any are held.';
