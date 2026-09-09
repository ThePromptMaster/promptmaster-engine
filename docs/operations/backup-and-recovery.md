# Backup and recovery responsibility

Contract section 9 (Security, Trust and Operations) requires a **defined backup
and recovery responsibility**. Nothing in this repository stated one. This
document is that statement.

It is deliberately a statement of *who is responsible for what*, not a runbook
of commands. A runbook that is never rehearsed is worse than an honest division
of responsibility, because it implies a capability that has not been tested.

---

## What holds the data

All durable user data is in **Supabase Postgres**. There is no second store.

That is a direct consequence of the architecture: the FastAPI backend owns no
user data and holds no session state, and the Next.js frontend and job drain
persist everything through Supabase under RLS. So "back up the product" and
"back up the Postgres database" are the same sentence, which is the main thing
this design buys operationally.

What is **not** in Postgres, and what that means:

| Thing | Where it lives | If it is lost |
|---|---|---|
| Projects, artifacts, versions, evaluations, workflow events, jobs | Supabase Postgres | Real data loss. This is the backup target. |
| Usage and cost rows (`model_usage`), error events | Supabase Postgres | Reporting history lost; the provider account remains the authoritative billing record. |
| Generated prose | Supabase Postgres (`artifact_versions`, append-only) | Real data loss, and expensive — it was paid for per token. |
| Server logs | The hosting platform's log retention | Diagnostic history lost. Not a backup target; see below. |
| Provider API keys, service-role key, worker secret | Deployment environment variables | Not recoverable from a database backup. Held by whoever administers the deployment. |
| Model outputs at the provider | Nowhere — OpenRouter does not retain them for us | Nothing to recover. Regeneration costs money again. |

## Who is responsible

**The platform (Supabase)** is responsible for taking backups of the Postgres
database on the schedule and retention of the project's current plan, and for
the mechanism that restores them. This is a managed responsibility and is not
reimplemented here.

**The deployment administrator** is responsible for three things the platform
does not do:

1. **Confirming what the plan actually provides.** Backup frequency, retention
   window, and whether point-in-time recovery is included differ by Supabase
   plan, and the free and lowest paid tiers differ sharply. This must be
   confirmed against the live project rather than assumed — an untested
   assumption about retention is the most common way a backup policy turns out
   not to exist.
2. **Custody of the secrets.** `SUPABASE_SERVICE_ROLE_KEY`, `OPENROUTER_API_KEY`,
   `WORKER_SHARED_SECRET`, `CRON_SECRET` and `ADMIN_USER_IDS` are environment
   variables in the hosting platform. A database restore does not restore them,
   and a project restored without them is a project that cannot generate, drain
   jobs, or be administered. They are held outside the repository, and losing
   them requires reissuing rather than recovering.
3. **Rehearsing a restore at least once.** A backup nobody has restored is a
   hypothesis.

**This repository** is responsible for the schema being reconstructible.
`supabase/migrations/` is the source of truth for structure: every migration is
checked in, idempotent, and must apply against an empty database. That property
is what makes a restore-into-a-fresh-project possible at all, and it is verified
rather than asserted — see the migration commits for what was actually run.

## Recovery expectations, stated honestly

- **Recovering the database recovers the product.** There is no second system to
  reconcile with, no cache to warm, and no state held in the backend that would
  be stale afterwards. The backend is stateless; restarting it is sufficient.
- **In-flight jobs survive a restore badly, and that is acceptable.** A job that
  was `leased` when the snapshot was taken will have a lease that has long since
  expired; `reap_expired_leases` returns it to the queue on the next drain tick,
  and the checkpoint means it resumes from the last completed step rather than
  from the beginning. Sections already written are in `artifact_versions`, which
  is append-only, so restoring cannot silently roll a section back to an earlier
  body — it can only lose versions newer than the snapshot.
- **Cost data may gap.** `model_usage` rows written after the snapshot are lost
  on restore. The provider account's own record is unaffected and remains the
  authority for anything billing-related; the admin page's figures are
  attribution, not invoicing.
- **Logs are not backed up and are not expected to be.** They are diagnostic,
  retained by the platform for its own window, and nothing in the product reads
  them. FR-19's durable operational record is `jobs.error_code`,
  `error_events` and `model_usage` — all in Postgres, all covered by the
  database backup.

## Deletion is not a backup concern

FR-20 deletion is a product feature, not an operational one: a user deleting a
project removes it, and the purge migration removes soft-deleted rows on its own
schedule. A restore that resurrects a project a user deleted after the snapshot
is a known and accepted consequence of point-in-time recovery, not a defect —
but it is worth knowing before a restore is performed rather than after.
