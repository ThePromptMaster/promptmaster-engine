-- FR-22: beta notice and feedback.
--
-- The controlled beta has two halves. The notice half is copy in the client;
-- this migration is the other half — somewhere for the real-world usage
-- feedback to land.
--
-- The four fields are deliberately STRUCTURED COLUMNS and not a jsonb blob.
-- They are the section-10 validation-framework questions verbatim (task/use
-- case, what was valuable, where the user got confused or blocked, likelihood
-- of reuse), the product owner queries and aggregates them directly, and a
-- blob would make "what blocked people this week" an ad-hoc json path
-- expression instead of a column. If the questionnaire is ever reissued, that
-- is a new migration adding columns — not a schema-free escape hatch.
--
-- Conventions: idempotent, `drop policy if exists` before `create policy`,
-- user_id denormalized so RLS never needs a join.

create table if not exists public.beta_feedback (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  -- Feedback may be given from anywhere in the app, including outside a
  -- project, so this is nullable; deleting the project keeps the feedback.
  project_id uuid references public.projects(id) on delete set null,

  -- FR-22: task/use case (required — feedback with no task is not usable),
  -- value, confusion or blockage, likelihood of reuse.
  use_case         text not null,
  value            text not null default '',
  blockage         text not null default '',
  reuse_likelihood smallint,

  created_at timestamptz not null default now(),

  -- Null means "not answered"; anything present must be on the 1-5 scale the
  -- form actually offers.
  constraint beta_feedback_reuse_likelihood_check
    check (reuse_likelihood is null or (reuse_likelihood between 1 and 5))
);

create index if not exists beta_feedback_user_created_idx
  on public.beta_feedback using btree (user_id, created_at desc);

alter table public.beta_feedback enable row level security;

-- Insert and select only. There is deliberately no update or delete policy:
-- feedback is a record of what someone said at a moment in the beta, not a
-- document they maintain. The product owner reads across all users via the
-- admin surface with elevated (service-role) access, which bypasses RLS.
drop policy if exists "Users insert own beta feedback" on public.beta_feedback;
create policy "Users insert own beta feedback" on public.beta_feedback
  for insert with check (auth.uid() = user_id);

drop policy if exists "Users read own beta feedback" on public.beta_feedback;
create policy "Users read own beta feedback" on public.beta_feedback
  for select using (auth.uid() = user_id);
