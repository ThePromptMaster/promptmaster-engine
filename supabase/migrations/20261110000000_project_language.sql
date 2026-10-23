-- Client, 21 Oct: "Can we do pick your language?"
--
-- `projects.language`: the language this project's work is written in, as a
-- two-letter code. 'en' is what every project did before. The browser sends it
-- as the X-PromptMaster-Language header and the backend, which owns no data,
-- adds the directive to every model call that request makes. The offered list
-- lives in code (promptmaster/language.py, lib/workflow/languages.ts); the
-- check only keeps the column a code, so adding a language needs no migration.
--
-- Idempotent: safe to re-run.

alter table public.projects add column if not exists language text not null default 'en';
alter table public.projects drop constraint if exists projects_language_chk;
alter table public.projects add constraint projects_language_chk check (language ~ '^[a-z]{2}$');
