# PromptMaster documentation

Technical documentation for operating PromptMaster, delivered under **FR-23**.

For working *inside* the repository — conventions, where prompt strings live, which
module cites which book chapter — see [`../CLAUDE.md`](../CLAUDE.md). It is written for
a developer or agent making changes. These documents are written for someone taking
over operation of the product. They link to `CLAUDE.md` rather than duplicating it;
where the two disagree, the discrepancy is called out inline.

---

## Start here

| If you are… | Read |
|---|---|
| New to the system | [`architecture.md`](architecture.md) |
| On call | [`runbook.md`](runbook.md) |
| Assessing what is and is not finished | [`known-limitations.md`](known-limitations.md) |
| Changing the schema | [`data-model.md`](data-model.md) |
| Debugging a stalled draft | [`jobs.md`](jobs.md) |

## The documents

- **[`architecture.md`](architecture.md)** — the shape of the system, the
  stateless-backend invariant, authentication, frontend structure, and the seams the
  system is meant to be extended at.
- **[`api.md`](api.md)** — the three interfaces (data, generation, worker), how each
  is authenticated, and the full endpoint inventory with live/dormant status.
- **[`data-model.md`](data-model.md)** — tables, the four invariants the schema
  enforces, RLS policy shapes, template versioning, and the migration rules.
- **[`jobs.md`](jobs.md)** — the background queue: lease, checkpoint, idempotency, the
  drain, and the cron.
- **[`saving-and-concurrency.md`](saving-and-concurrency.md)** — FR-21. Autosave,
  the revision guard, conflict resolution, and what happens with two tabs open.
- **[`deployment.md`](deployment.md)** — the two Vercel projects, Supabase, and every
  environment variable.
- **[`testing.md`](testing.md)** — how to run both suites, what they guarantee, and
  what is not covered.
- **[`runbook.md`](runbook.md)** — deploy, roll back, read a failed job, check cron
  health, rotate secrets, backup and recovery.
- **[`known-limitations.md`](known-limitations.md)** — the register required by
  section 12 of the Amendment.

## The contract

- **[`requirements/phase2-functional-requirements.md`](requirements/phase2-functional-requirements.md)**
  — Exhibit A verbatim: FR-01 to FR-23, plus sections 8 to 12. **This is the
  authority.** Section 12 is the Definition of Done. Code comments cite FR numbers
  freely; those citations are shorthand, not the requirement. Read the FR before
  building against it.
- **[`requirements/phase2-roadmap-exhibit-b.md`](requirements/phase2-roadmap-exhibit-b.md)**
  — Exhibit B verbatim, attached for reference only and explicitly not a scope
  commitment. Useful as the record of what Phase 2 deliberately excludes.

Also in this directory: `superpowers/specs/` and `superpowers/plans/` hold design
specs and plans for the larger features — read the relevant pair before extending
long-form, conversation, continuity, custom modes, or smart setup.

---

## FR-23 coverage

> "Architecture, schemas, API boundaries, deployment, environment variables, job
> system, tests, limitations, and extension points are documented."

| Required topic | Where |
|---|---|
| Architecture | [`architecture.md`](architecture.md) |
| Schemas | [`data-model.md`](data-model.md) |
| API boundaries | [`api.md`](api.md) |
| Deployment | [`deployment.md`](deployment.md), [`runbook.md`](runbook.md) |
| Environment variables | [`deployment.md`](deployment.md) |
| Job system | [`jobs.md`](jobs.md) |
| Tests | [`testing.md`](testing.md) |
| Limitations | [`known-limitations.md`](known-limitations.md) |
| Extension points | [`architecture.md`](architecture.md#extension-points) |

FR-23's **second** acceptance criterion — transfer of repository, deployment,
database, provider and logging access — is **not satisfied**. It is tracked as L-01 in
[`known-limitations.md`](known-limitations.md).

---

## Facts worth knowing before you change anything

1. **The backend owns no user data.** It is a stateless but authenticated LLM proxy.
   All persistence is frontend-side via the Supabase SDK under RLS. Adding a Supabase
   data client or session store to the backend moves user isolation out of the database
   and into code.
2. **Stage state is projected from `workflow_events`, in one place.** `projects.stage`
   is a denormalised cursor. If they disagree, the events win.
3. **Published workflow templates are immutable.** Revise by publishing a new version;
   never edit a published row in place.
4. **A job's lease expiring is not an error.** It is how a job survives a serverless
   function timeout.
5. **`supabase db diff` proves a migration applies. It does not prove it was applied.**
   Use `supabase migration list --linked`, because pg-delta does not diff functions or
   grants.
6. **`npm run build` must pass before pushing.** There is no CI.
