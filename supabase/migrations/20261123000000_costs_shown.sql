-- 31 Oct: what work costs is shown to the user — under each side-chat reply,
-- on each Go step, for each Go run and for the project (the client: "I
-- couldn't tell whether chat messages or actions cost anything").
--
-- A Go step's cost was kept to four decimal places, which rounds a call of
-- $0.00004 to zero; shown to a user, that zero reads as "free". Kept to ten,
-- like model_usage.cost_usd. Re-running this is harmless.

alter table public.agent_steps alter column cost_usd type numeric(20, 10);
alter table public.agent_runs alter column cost_usd type numeric(20, 10);
