-- 8 Nov (L-203): a project may search its owner's connected accounts.
--
-- Projects that already exist stay off: their owners connected when the settings page
-- said nothing is read until they tick it. A new project starts on, and the switch is
-- in its "From your accounts" panel.

alter table public.projects add column if not exists account_search text not null default 'off';

alter table public.projects drop constraint if exists projects_account_search_chk;
alter table public.projects add constraint projects_account_search_chk check (account_search in ('off', 'on'));

alter table public.projects alter column account_search set default 'on';

comment on column public.projects.account_search is
  'on: the side chat and a draft the person asked for may search their connected accounts. Go never does.';
