-- Reattach the three orphaned conversations that can be proven to belong to a
-- specific project.
--
-- Background. 150 of 339 chat messages were left unattachable by two bugs,
-- both since fixed:
--
--   1. summary-phase.tsx minted a fresh random session_id when saving, while
--      chat-panel.tsx wrote messages with the store's id. The two never
--      matched, and conversation_messages pointed at sessions by a plain text
--      field with no foreign key, so nothing could complain. (13 conversations)
--   2. A session was only persisted on reaching the Summary phase, so a user
--      who chatted and closed the tab produced messages with no session row to
--      belong to at all. (8 conversations — unrecoverable in principle)
--
-- Recovery method. Time proximity is useless here: it yields 5-6 candidate
-- projects for most conversations, and a wrong attribution puts someone's
-- conversation on a stranger's project — worse than leaving it detached.
--
-- What is provable is content. A user chat message is echoed verbatim into the
-- prompt of the iteration it produced, so a message found inside exactly one
-- project's version text is a link, not a guess. Only these three cleared that
-- bar, each matching exactly one project:
--
--   755cc043 -> c8f13598   9 of 14 messages matched, incl. a 109-char quote
--   c7f18bf6 -> 748f99ab   "Make the title crisis created by light for chapter 3"
--   cafdaf50 -> cd1b9078   "Okay create the perfect BRD now"
--
-- The remaining 18 conversations are deliberately left detached. They are not
-- lost — every message is intact — and a later UI can surface them as
-- unattached rather than invisible.
--
-- Idempotent: only touches rows still lacking a project_id.

do $$
declare
  n_candidates bigint;
  n_linked bigint;
  n_versioned bigint;
  n_remaining bigint;
begin
  select count(*) into n_candidates
  from public.conversation_messages cm
  where cm.project_id is null
    and (cm.session_id, cm.user_id) in (
      ('755cc043', 'a7526944-26eb-4cb3-b95c-5b8455ee3e4c'::uuid),
      ('c7f18bf6', 'a7526944-26eb-4cb3-b95c-5b8455ee3e4c'::uuid),
      ('cafdaf50', 'a7526944-26eb-4cb3-b95c-5b8455ee3e4c'::uuid)
    );

  with mapping(session_id, user_id, project_id) as (values
    ('755cc043', 'a7526944-26eb-4cb3-b95c-5b8455ee3e4c'::uuid, 'c8f13598-d350-4e7d-bb54-596932905413'::uuid),
    ('c7f18bf6', 'a7526944-26eb-4cb3-b95c-5b8455ee3e4c'::uuid, '748f99ab-40e2-4e7e-bb8a-88d307c793af'::uuid),
    ('cafdaf50', 'a7526944-26eb-4cb3-b95c-5b8455ee3e4c'::uuid, 'cd1b9078-bd43-4859-9066-88c594b2f1d0'::uuid)
  ),
  updated as (
    update public.conversation_messages cm
    set project_id = m.project_id
    from mapping m
    where cm.session_id = m.session_id
      and cm.user_id = m.user_id
      and cm.project_id is null
    returning 1
  )
  select count(*) into n_linked from updated;

  -- Point each message at the version it was discussing, where the artifact
  -- has one at that number. Left null otherwise rather than guessed.
  with updated as (
    update public.conversation_messages cm
    set version_id = v.id
    from public.artifacts a
    join public.artifact_versions v on v.artifact_id = a.id
    where a.project_id = cm.project_id
      and a.kind = 'output'
      and v.version_number = cm.iteration_number
      and cm.project_id is not null
      and cm.version_id is null
    returning 1
  )
  select count(*) into n_versioned from updated;

  select count(*) into n_remaining
  from public.conversation_messages where project_id is null;

  raise notice 'chat reattachment: % messages linked, % given a version, % still detached',
    n_linked, n_versioned, n_remaining;

  -- Assert against what was actually present to link. The first version
  -- hardcoded 18 and aborted on any other count, so the migration could not run
  -- against an empty database — which broke shadow validation and would have
  -- broken provisioning any fresh environment. Guarding on the candidate count
  -- keeps the safety (a partial link still aborts) without assuming
  -- production's data.
  if n_candidates > 0 and n_linked <> n_candidates then
    raise exception
      'Expected to link % messages, linked % — aborting', n_candidates, n_linked;
  end if;
end $$;
