# Data model, schema invariants, and migrations

All persistence is Supabase Postgres. The migrations under `supabase/migrations/` are
the source of truth; this document explains what they enforce and why, so that a
future change does not undo a guarantee without noticing.

---

## Tables

### Phase 2 (current)

| Table | What it holds |
|---|---|
| `projects` | One row per project. Setup fields, workflow key, `stage` cursor, `revision`, soft-delete. |
| `artifacts` | One per stage per project (`kind` + `stage_id`). Holds `current_version_id`, `version_count`, `long_form`, `outline_draft`, `summary`. |
| `artifact_versions` | Append-only version history. Content, prompt, model, mode, `finish_reason`, `user_rating`, `continuity_snapshot`. |
| `evaluations` | Alignment / drift / clarity / completeness per version, with `needs_realignment` as a generated column. |
| `workflow_templates` | Immutable published template versions (`key` + `version`), definition as JSONB. |
| `workflow_events` | **The live stage-history log.** Stage state is projected from this. `seq` is assigned by a `BEFORE INSERT` trigger (`workflow_events_assign_seq`, max+1 under a per-project advisory lock); any value a writer supplies is ignored. |
| `project_stage_events` | A second, unused stage-history table. See limitations. |
| `recommendations` | Proposed actions, with `status` and `resulting_version_id`. |
| `decisions` | Append-only decision trail. |
| `project_tasks` | Unresolved work items. |
| `jobs` | The background queue. See [`jobs.md`](jobs.md). |
| `section_records` | Per-section continuity records (summary, glossary, decisions, TODOs). |
| `beta_feedback` | FR-22 feedback capture. |

### Stage statuses (PM-13) and project completion (PM-14)

Stage state is projected from `workflow_events` by `projectState` (`lib/workflow/engine.ts`).
Migration `20260927000000_stage_statuses` widened `we_type_chk`:

| Event | Projects to |
|---|---|
| `stage_marked_complete` | `completed_with_artifact` when `payload.evidence_version_id` is set (a trigger checks the version belongs to that stage's artifact in the same project), else `complete` |
| `stage_advanced` | cursor moves; the stage stays `in_progress` with `left_open` — **moving on is not completing** |
| `stage_blocked` / `stage_unblocked` | `blocked` with `{kind, reason}` (`we_block_reason_chk`: reason required, kind ∈ tool_missing / data_missing / needs_decision) / back to `in_progress` |
| `project_finalized` / `project_reopened` | `WorkflowState.project_status`; `projects.status` is the denormalised copy |
| `template_upgraded` | re-pin to a newer workflow version; payload records from/to |
| `stage_completed` (legacy) | `complete` — kept so every existing log replays unchanged; new code does not write it |

Finish is gated on the **deliverable** (`deliverableStage`: the manuscript on the first
long-form stage, else the last required prose stage), shown in a completion summary;
finishing without it is allowed and said out loud. `decisions_type_chk` was deliberately
**not** widened (FR-02 contract evidence).


### Legacy (still live, deliberately)

`sessions`, `templates`, `usage_tracking`, `custom_modes`, `conversation_messages`,
`user_presets`.

`sessions` holds a whole legacy `Session` in a `data` JSONB blob (the per-row columns
exist only for listing). **It is the rollback path for the M1 import and must not be
narrowed or dropped.** The import migration never reads it destructively.
`conversation_messages` is still live — the side chat writes to it.

---

## The four invariants the schema enforces

These are in the DDL rather than in application code specifically so that a later code
change cannot undo them. For `project_stage_events.actor` this also matters as
contract evidence: it is auditable from the DDL alone.

### 1. There is no `'model'` actor

`supabase/migrations/20260903000000_projects_governance.sql`:

```sql
constraint pse_actor_chk check (actor in ('user', 'system')),
```

with the same restriction repeated on `workflow_events.actor` (`we_actor_chk`). A
model reaches stage state only by way of `proposal_id` pointing at a recommendation
the user accepted. This is the mechanical expression of FR-02's "model may propose but
does not silently own transitions".

The *acceptance* half is enforced too, by
`20260909000000_recommendation_governance.sql`. It adds `proposal_id` to
`workflow_events` — the log that is actually read — and installs
`stage_event_proposal_accepted()` as a `BEFORE INSERT OR UPDATE` trigger on **both**
history tables, "so the rule cannot hold on one and not the other". It rejects four
things:

- a `proposal_id` that does not exist — a citation nobody can check is not evidence;
- a proposal belonging to **another user** — otherwise one user's accepted
  recommendation could launder a transition in another's project, even from a
  service-role client that RLS does not constrain;
- a proposal that is pending, dismissed or superseded — "accepted" is the whole
  content of the requirement;
- any row with `actor <> 'user'` — a proposal-driven transition is the *user* acting on
  a suggestion; `actor = 'system'` with a `proposal_id` is a model owning a transition
  with a recommendation stapled on as cover, which is exactly what FR-02 forbids.

`supabase/tests/fr02_proposal.sql` exercises this against a real Postgres, **including
a negative control**: with the trigger dropped, a pending proposal could be cited — so
the foreign key alone does not enforce FR-02, and the trigger is what does. Running it
is a manual act; see [`testing.md`](testing.md).

### 2. Children carry a composite ownership foreign key

`projects` declares `constraint projects_id_user_key unique (id, user_id)`, which is
what makes the composite reference possible. Ten tables then carry:

```sql
foreign key (project_id, user_id) references public.projects (id, user_id) on delete cascade
```

— `artifacts`, `artifact_versions`, `evaluations`, `recommendations`, `decisions`,
`project_stage_events`, `project_tasks`, `jobs`, `workflow_events`, `section_records`.
Two more chain further: `av_artifact_fk (artifact_id, user_id) → artifacts`, and
`eval_version_fk (version_id, user_id) → artifact_versions`.

The point: **an artifact cannot be parented into another user's project even from a
service-role client**, which bypasses RLS. RLS protects the browser; this protects the
worker and any future admin tooling.

A new child table of `projects` should follow this pattern. The one deliberate
exception is `beta_feedback.project_id`, a nullable single-column FK — feedback
outlives the project it was left on.

### 3. `artifact_versions` is append-only

```sql
create or replace function public.artifact_versions_immutable()
returns trigger language plpgsql as $$
begin
  if to_jsonb(new) - 'user_rating' is distinct from to_jsonb(old) - 'user_rating' then
    raise exception
      'artifact_versions rows are immutable (only user_rating may change); '
      'to change content, append a new version';
  end if;
  return new;
end;
$$;

create trigger artifact_versions_no_update before update on public.artifact_versions
  for each row execute function public.artifact_versions_immutable();
```

Restoring a version **appends a new version** with `restored_from_version_id` set,
rather than mutating history. That is why version history and prompt assembly can
trust the table.

**Two things this does not do**, worth knowing before relying on it:

- The trigger is `BEFORE UPDATE` only — **it does not block DELETE**. Deletion is
  prevented instead by the *absence* of a DELETE policy under RLS. A service-role
  client, which bypasses RLS, can delete versions. Rows also legitimately disappear
  via `on delete cascade` from `projects`, which the purge function depends on.
- It is a whole-row `jsonb` comparison, so it is robust to new columns being added
  (a new column is automatically immutable) but it also means adding a second
  user-mutable column requires editing the function.

### 4. `revision` is bumped by trigger, never by the client

```sql
create or replace function public.touch_and_bump_revision() ... 
  new.updated_at = now();
  new.revision = old.revision + 1;
```

attached as `projects_touch` and `artifacts_touch`. A client that could set `revision`
would echo its stale value back and defeat the optimistic-concurrency guard entirely.
`frontend/src/lib/supabase/projects.test.ts` asserts that `revision` never appears in
an update payload. See [`saving-and-concurrency.md`](saving-and-concurrency.md).

---

## Row-level security

Every table has RLS enabled with owner policies keyed on `auth.uid() = user_id`. The
shapes vary deliberately:

| Table | Policies present |
|---|---|
| `projects`, `artifacts`, `project_tasks` | select, insert, update, delete |
| `artifact_versions` | select, insert, **update restricted to rating** — no delete |
| `evaluations`, `workflow_events`, `project_stage_events`, `decisions`, `beta_feedback`, `usage_tracking` | select, insert only — append-only |
| `recommendations` | select, insert, update — no delete |
| `jobs` | **select only.** All writes go through `SECURITY DEFINER` functions. |
| `workflow_templates` | select only, `using (is_system or auth.uid() = owner_id)`. No user-id column; new versions arrive by migration. |

## Template versioning

`workflow_templates` is keyed `unique (key, version)` with
`status in ('draft', 'published', 'archived')` and a `supersedes_id` chain.

**Published templates are immutable.** Revising a workflow publishes a *new version*;
a project keeps the version it pinned in `projects.workflow_template_id`, so a book
halfway through drafting is unaffected by a template revision. Never edit a published
row in place.

Seeds are **generated, never hand-written**:

```
cd frontend
npm run --silent gen:templates > ../supabase/migrations/<timestamp>_seed_workflow_templates.sql
```

`--silent` matters: without it npm's banner lands in the SQL and the migration will
not parse. `frontend/src/lib/workflow/seed-drift.test.ts` fails if the TypeScript
templates and the seed migration disagree, so this cannot rot silently.

**Read the seed caveat in [`known-limitations.md`](known-limitations.md) before adding
another seed migration** — the seeds use `on conflict (key, version) do nothing`, and
a `(key, version)` pair that has already been inserted will keep its *old* definition.

---

## Migrations

Rules, all of which have been broken here at least once and cost time:

1. **A migration must apply against an empty database.** Validate with
   `supabase db diff --linked --schema public` before pushing. Two migrations in this
   repository broke this rule and had to be fixed —
   `20260904000300_reattach_provable_chat.sql` originally hardcoded a row count of 18
   and aborted on anything else, which meant it could not run against a fresh
   database and broke shadow validation.
2. **Always idempotent.** `create table if not exists`, `create index if not exists`,
   `create or replace function`, `drop trigger if exists` before `create trigger`, and
   `drop policy if exists` before `create policy` — Postgres has no
   `create policy if not exists`.
3. **`db diff` proves a migration *applies*. It does not prove it *has been applied*.**
   Use `supabase migration list --linked` for that. This distinction is not academic:
   `pg-delta` (enabled here — `[experimental.pgdelta] enabled = true` in
   `supabase/config.toml`) **does not diff functions**, which is how two migrations
   once reached `main` unapplied without the diff complaining.

Four migrations define functions and are therefore invisible to schema diffing:

| Migration | Functions |
|---|---|
| `20260515000000_custom_modes.sql` | `custom_modes_touch_updated_at` |
| `20260902000000_projects_core.sql` | `touch_and_bump_revision`, `touch_updated_at`, `artifact_versions_immutable` |
| `20260907000000_jobs_functions.sql` | `enqueue_job`, `claim_next_job`, `reap_expired_leases` |
| `20260907000100_section_records_and_job_writes.sql` | `checkpoint_job`, `complete_job`, `fail_job`, `release_job`, `request_project_cancel`, `write_long_form_section`, `write_section_record` |
| `20260909000000_recommendation_governance.sql` | `stage_event_proposal_accepted`, `recommendations_resolution_forward_only` |
| `20260909200000_purge_deleted_projects.sql` | `purge_deleted_projects` |

**Grants are equally invisible to diffing.** Every one of the job/section functions is
`revoke all ... from public` and then granted narrowly — `enqueue_job` and
`request_project_cancel` to `authenticated, service_role`, everything else to
`service_role` only, and `purge_deleted_projects` to nobody at all (operator/cron
use). If a function is redeployed without its grants, the symptom is a permission
error at runtime that no diff predicted.

### The M1 import

`20260903000100_migrate_sessions_to_projects.sql` imports legacy `sessions` into
projects/artifacts/versions/evaluations under a `migration_batch` uuid, which is
logged. **The reversal is `delete from public.projects where migration_batch = '<uuid>';`**
— worth writing down somewhere outside this repository too.

It aborts rather than committing a partial import if the version count does not
reconcile. It also backfills `conversation_messages`, incompletely and on purpose; see
[`known-limitations.md`](known-limitations.md).

### Data retention

The only retention guarantee expressed anywhere in the codebase is application-level:
`purge_deleted_projects(interval)` hard-deletes soft-deleted projects after 30 days,
scheduled via pg_cron at `'17 3 * * *'` **when the extension is present**. The
migration schedules it conditionally and raises a notice when pg_cron is absent,
rather than failing to apply — so on an environment without pg_cron, **soft-deleted
projects are never purged and nothing says so**. Confirm pg_cron is enabled on the
production project.

Backup and recovery responsibility is covered in [`runbook.md`](runbook.md) and its
current unresolved state is recorded in [`known-limitations.md`](known-limitations.md).


### Go mode: agent runs (B1)

`20260928000000_agent_runs` adds three tables and one trigger on `workflow_events`.

| Table | What it holds | Who writes |
|---|---|---|
| `agent_runs` | One Go session: `policy` (guided / checkpoint / autonomous), status, budget, lease. Checkpoint and Autonomous require `authorization_id` — an **accepted** recommendation with `scope.kind = 'agent_authorization'` for that policy. One running run per project (partial unique index). Policy and authorization are immutable; ended runs are final. | Owner (RLS) |
| `agent_steps` | One action each: action key, rationale, status and **execution label** (PM-12). `code_executed` / `simulation_run` require a `sandbox_runs` row for the step; `result_interpreted` must cite one of the run's executions. Finished steps are immutable. | Owner (RLS) |
| `sandbox_runs` | Executed code and its real output. | **Service role only** — owners can read, never write, so an execution cannot be forged from a browser |
| `project_files` | Data files a user attaches to a project (name, storage path, size, and a `preview`: columns, first rows, row count). The object lives in the private `project-files` bucket under `<user id>/<project id>/`. Insert, select and delete only — no update. | Owner (RLS); the sandbox route reads them with the service role after checking the caller owns the project |

`workflow_events.agent_run_id` + trigger `workflow_events_agent_authorized`: a system-actor stage move must cite a running, authorized run of the same project, and only what its policy allows — Autonomous may block, advance, or complete *with evidence*; Checkpoint may only block; Guided may change nothing. Skip, return, finish, reopen and upgrade are user decisions under every policy. The FR-02 proposal trigger is unchanged. Asserted by `supabase/tests/agent_runs.sql` (14 cases).

### Critique dials and "no further pass" (C1: PM-21, PM-25)

- `projects.critique_intensity` (`light | standard | rigorous`, default `standard`) and
  `projects.critique_tone` (`gentle | neutral | direct`, default `neutral`) are two
  separate settings. They travel in every `PMInput` (`lib/workflow/stage-requests.ts`),
  and only the evaluation and critique prompts read them (`promptmaster/critique_style.py`).
  Intensity sets what is found and the findings cap (3, 7 or 10). Tone sets only the
  wording.
- `evaluations.further_pass_needed` / `further_pass_reason` hold the evaluator's answer to
  "would another AI pass materially improve this?". `null` means the evaluator was not asked
  (evaluations before C1, and the iteration pipeline), which is never read as "needed".
  `stage_evaluation._further_pass` overrides a "not needed" that contradicts the evaluation's
  own scores: Low alignment, High drift, incomplete, or any findings.
