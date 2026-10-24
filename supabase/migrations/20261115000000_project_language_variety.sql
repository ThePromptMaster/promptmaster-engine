-- Sean, 24 Oct: "maybe even Ebonics too". African American English is a
-- variety of English, offered as the code 'en-aave'; the check on
-- `projects.language` allowed only two letters. It now also allows a
-- language with a variety after it. The offered list stays in code.
--
-- Idempotent: safe to re-run.

alter table public.projects drop constraint if exists projects_language_chk;
alter table public.projects add constraint projects_language_chk check (language ~ '^[a-z]{2}(-[a-z]{2,8})?$');
