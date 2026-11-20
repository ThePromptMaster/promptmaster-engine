-- Routine decisions: "Handle them for me" by default (20 Nov, L-264).
--
-- A client asked for new projects to start on "Handle them for me" rather
-- than "Ask me": on production nearly every project set to 'handle' got there
-- by the user switching it by hand (a `routine_policy_changed` event) each time.
--
-- New projects only. A project that exists keeps the setting it shows: it is
-- not moved to 'handle' behind the user's back, because under 'handle' Go may
-- accept routine work and commit delegable approvals the user expected to be
-- asked about. "Ask me" is one press away, and that press is still the
-- user's alone (we_routine_policy_user_chk).
--
-- What 'handle' allows is unchanged: the guards in
-- workflow_events_agent_authorized() and project_facts_on_insert() read the
-- project's value when each row is written.
--
-- Idempotent: safe to re-run.

alter table public.projects alter column routine_decisions set default 'handle';
