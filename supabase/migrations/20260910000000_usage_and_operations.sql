-- FR-18 and FR-19: where usage, cost, and operational errors land.
--
-- Two tables, and the first question is why neither of them is
-- `usage_tracking`.
--
-- `usage_tracking` is legacy. It stores `(user_id, action, created_at)` and
-- nothing else — no model, no tokens, no cost — because it was built to count
-- how many iterations someone ran, not what they spent. It has had **no writer
-- at all** since the /session retirement: `recordUsage()` in
-- lib/supabase/usage.ts has zero call sites. Widening it would mean adding six
-- columns to a table whose existing rows can never have them, changing what its
-- `action` column means, and doing that to one of the tables CLAUDE.md names as
-- the M1 rollback path. So it is superseded, not extended: it keeps its
-- meaning, keeps its rows, and stops being the thing anyone reaches for.
--
-- `model_usage` is a row per provider call, not per user action. That grain is
-- the point — a single "generate" costs four calls through the evaluation
-- pipeline, plus a repair pass when JSON comes back malformed, and those are
-- exactly the calls that get expensive when something is going wrong.
--
-- **On the price columns.** The unit prices in force at the moment of the call
-- are stored alongside the tokens, and `cost_usd` is their product. Not a
-- hardcoded rate table (correct the day it is written, silently wrong forever
-- after) and not a read-time lookup (which would retroactively rewrite last
-- month's spend when a price changes). A call whose price was not known records
-- tokens with a NULL cost, and every surface renders that as "pricing
-- unavailable" — never as $0.00, which is a lie that looks like a fact.
--
-- **On trust.** These rows are written by the client under RLS, from a header
-- the backend emits. A user could therefore under-report their own usage. That
-- is accepted for a controlled beta, deliberately and with the alternative
-- understood: the authoritative spend figure is OpenRouter's own dashboard, and
-- the backend independently logs every call structurally (FR-19), so the log is
-- the tamper-evident record and this table is the queryable one. The invariant
-- that forces this shape is the one in CLAUDE.md — the backend owns no user
-- data and gets no Supabase client — and buying non-repudiation here would mean
-- breaking it.
--
-- Conventions: idempotent, `drop policy if exists` before `create policy`,
-- user_id denormalized so RLS never needs a join, composite (project_id,
-- user_id) FK so a row cannot be parented into another user's project even from
-- a service-role client.

-- ---------------------------------------------------------------------------
-- model_usage — FR-18
-- ---------------------------------------------------------------------------

create table if not exists public.model_usage (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,

  -- Nullable: usage is incurred outside a project too (smart setup, the
  -- long-form detector). Composite FK, per the schema rule above.
  project_id uuid,

  -- FR-19: the correlation id the API returned on this request. This is the
  -- column that turns "what did this cost" and "what went wrong" into the same
  -- query — it joins to error_events.request_id and to the backend's log lines.
  request_id text not null default '',
  -- The API path, so cost can be attributed to a feature and not only a user.
  route      text not null default '',

  model      text not null default '',
  tokens_in  integer not null default 0,
  tokens_out integer not null default 0,

  -- USD per single token, as OpenRouter quotes them, snapshotted at call time.
  -- numeric, never float: these are money and they are very small.
  prompt_price_usd     numeric(20, 12),
  completion_price_usd numeric(20, 12),
  -- NULL means the price was unknown when the call happened. It does not mean
  -- free. Readers must distinguish the two.
  cost_usd             numeric(20, 10),

  -- 'app' is the browser; 'drain' is the background job worker. Worth knowing
  -- separately, because drain spend continues after the user has closed the tab.
  source text not null default 'app',

  created_at timestamptz not null default now(),

  constraint model_usage_tokens_nonneg
    check (tokens_in >= 0 and tokens_out >= 0),
  constraint model_usage_cost_nonneg
    check (cost_usd is null or cost_usd >= 0),
  constraint model_usage_source_check
    check (source in ('app', 'drain')),
  constraint model_usage_project_fk
    foreign key (project_id, user_id)
    references public.projects (id, user_id) on delete set null
);

-- "What has this user spent recently" — the admin page's per-user roll-up.
create index if not exists model_usage_user_created_idx
  on public.model_usage using btree (user_id, created_at desc);

-- "What has everyone spent recently" — the cross-user admin query, which has no
-- user_id predicate and would otherwise be a sequential scan.
create index if not exists model_usage_created_idx
  on public.model_usage using btree (created_at desc);

create index if not exists model_usage_project_created_idx
  on public.model_usage using btree (project_id, created_at desc)
  where project_id is not null;

alter table public.model_usage enable row level security;

-- Insert and select only. Usage is a record of what happened, not a document
-- anyone maintains: no update policy, no delete policy. A user who could edit
-- their own usage rows could edit their own bill.
drop policy if exists "Users insert own usage" on public.model_usage;
create policy "Users insert own usage" on public.model_usage
  for insert with check (auth.uid() = user_id);

drop policy if exists "Users read own usage" on public.model_usage;
create policy "Users read own usage" on public.model_usage
  for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- error_events — FR-19
-- ---------------------------------------------------------------------------
--
-- `jobs.error_code` / `error_message` already record background-job failures,
-- and they stay the record for those — this does not duplicate them. What had
-- nowhere to land was everything else: a stage generation that 502'd, a rate
-- limit a user hit, a request refused for size. Those surfaced to one person,
-- once, in a panel they then dismissed, and were gone.
--
-- Same grain as the classified error the user was shown, so the admin page
-- reports what people actually saw rather than a re-derivation of it.

create table if not exists public.error_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  project_id uuid,

  -- The FR-16 taxonomy code: insufficient_credits, rate_limited,
  -- context_length, provider_unavailable, invalid_request, unknown, ...
  code    text not null default 'unknown',
  -- The plain-language title and message the user was actually shown.
  title   text not null default '',
  message text not null default '',
  -- The unvarnished cause, from the "view technical details" disclosure.
  technical text not null default '',

  route       text not null default '',
  request_id  text not null default '',
  http_status integer,

  -- Where the report came from. 'client' is the browser's error boundary and
  -- API path; 'drain' is the job worker.
  source text not null default 'client',

  created_at timestamptz not null default now(),

  constraint error_events_source_check
    check (source in ('client', 'drain')),
  constraint error_events_project_fk
    foreign key (project_id, user_id)
    references public.projects (id, user_id) on delete set null
);

create index if not exists error_events_created_idx
  on public.error_events using btree (created_at desc);

create index if not exists error_events_user_created_idx
  on public.error_events using btree (user_id, created_at desc);

-- "How often is anyone hitting this failure this week" — the question that
-- decides what to fix next.
create index if not exists error_events_code_created_idx
  on public.error_events using btree (code, created_at desc);

alter table public.error_events enable row level security;

drop policy if exists "Users insert own errors" on public.error_events;
create policy "Users insert own errors" on public.error_events
  for insert with check (auth.uid() = user_id);

drop policy if exists "Users read own errors" on public.error_events;
create policy "Users read own errors" on public.error_events
  for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Note on the admin surface
-- ---------------------------------------------------------------------------
--
-- Neither table has a policy granting anyone cross-user reads, and that is
-- deliberate. The admin page does not widen RLS; it goes through a Next.js
-- route handler that holds the service-role key and checks the caller against
-- an allowlist BEFORE it reads anything. Adding an "admins can read everything"
-- policy here would mean encoding who is an admin in the database and trusting
-- `auth.uid()` inside a policy to gate it — a second, weaker copy of the same
-- decision, in the place where getting it wrong is a data breach rather than
-- an empty page. See src/app/api/admin/overview/route.ts.
