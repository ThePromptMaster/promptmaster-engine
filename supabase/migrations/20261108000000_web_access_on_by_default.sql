-- Web access on by default (22 Oct). A project starts with its switch on, so
-- Go, the side chat and the Web sources panel may search the web without the
-- user first finding the switch. Turning it off is still the user's alone,
-- recorded as `web_access_changed`.
--
-- Existing projects whose switch is off only because that was the old default
-- (no `web_access_changed` event: the user never touched it) are turned on.
-- A project the user switched off stays off.
--
-- Idempotent: safe to re-run. A re-run turns on only projects the user has
-- never switched, which is what the first run did.

alter table public.projects alter column web_access set default 'on';

-- Without projects_touch: this is not the user's edit, so it must not move the
-- project up the "recently updated" list or bump `revision` under an open tab
-- (field patches never send web_access, so a stale cache cannot undo it).
alter table public.projects disable trigger projects_touch;

update public.projects p
   set web_access = 'on'
 where p.web_access = 'off'
   and not exists (
     select 1 from public.workflow_events e
      where e.project_id = p.id and e.type = 'web_access_changed'
   );

alter table public.projects enable trigger projects_touch;
