import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * FR-02's proposal boundary, asserted against the DDL.
 *
 * **What this test is, and is not.** There is no SQL test harness in this
 * repository — no pgTAP, nothing in CI that talks to a database — so this is a
 * TEXT assertion over the migration. It proves the rule is *written*: the
 * column exists on the log that is actually read, it restricts rather than
 * nulls on delete, the trigger is installed on both history tables, and each
 * of the four rejections is present. It does NOT prove the trigger fires.
 *
 * `supabase/tests/fr02_proposal.sql` is what proves that, and running it is a
 * manual act. The two are complementary and neither substitutes for the other;
 * saying so here is cheaper than a later reader inferring coverage this file
 * does not have.
 *
 * Modelled on event-type-drift.test.ts, which already greps constraints out of
 * migration SQL for the same reason: a schema invariant that only one
 * migration states is one a later migration can quietly undo.
 */

const MIGRATIONS = join(process.cwd(), '..', 'supabase', 'migrations');

function migration(suffix: string): string {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith(suffix));
  if (!file) throw new Error(`no migration ending in ${suffix}`);
  return readFileSync(join(MIGRATIONS, file), 'utf8');
}

const GOVERNANCE = migration('_recommendation_governance.sql');
const M1 = migration('_projects_governance.sql');

/** Everything in the migrations directory, for the "nobody widened it" checks. */
const ALL_SQL = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8'))
  .join('\n');

describe('FR-02: the proposal boundary lives on the log that is read', () => {
  it('adds proposal_id to workflow_events, not only to the dormant table', () => {
    // The whole point of the migration. `projectState()` replays
    // workflow_events; project_stage_events has no reader and no writer, so an
    // invariant enforced only there is an invariant enforced nowhere.
    expect(GOVERNANCE).toMatch(
      /alter table public\.workflow_events\s+add column if not exists proposal_id uuid/
    );
    expect(M1).toContain('proposal_id uuid references public.recommendations(id)');
  });

  it('restricts on delete rather than nulling', () => {
    // `set null` would let a deleted proposal turn its event into what reads as
    // an ordinary unprompted user transition — erasing precisely the fact the
    // log exists to record.
    const clause = GOVERNANCE.match(
      /add column if not exists proposal_id uuid\s+references public\.recommendations\(id\) on delete (\w+)/
    );
    expect(clause?.[1]).toBe('restrict');
  });

  it('installs one function on both history tables', () => {
    expect(GOVERNANCE).toContain(
      'create or replace function public.stage_event_proposal_accepted()'
    );
    for (const table of ['public.workflow_events', 'public.project_stage_events']) {
      expect(GOVERNANCE).toMatch(
        new RegExp(
          `before insert or update on ${table.replace('.', '\\.')}\\s+for each row execute function public\\.stage_event_proposal_accepted\\(\\)`
        )
      );
    }
  });

  it('rejects all four ways a citation could be hollow', () => {
    const fn = GOVERNANCE.slice(
      GOVERNANCE.indexOf('function public.stage_event_proposal_accepted'),
      GOVERNANCE.indexOf('function public.recommendations_resolution_forward_only')
    );

    // 1. a proposal that does not exist
    expect(fn).toContain('if not found then');
    // 2. a proposal owned by someone else
    expect(fn).toMatch(/proposal_user is distinct from new\.user_id/);
    // 3. a proposal that is not accepted
    expect(fn).toMatch(/proposal_status <> 'accepted'/);
    // 4. actor='system' with a proposal stapled to it — the exact shape FR-02
    //    forbids: a model owning a transition under cover of a suggestion.
    expect(fn).toMatch(/new\.actor <> 'user'/);

    // All four must raise, not warn and continue.
    expect([...fn.matchAll(/raise exception/g)]).toHaveLength(4);
    expect([...fn.matchAll(/errcode = 'check_violation'/g)]).toHaveLength(4);
  });
});

describe('FR-02: a resolved recommendation is settled', () => {
  const fn = GOVERNANCE.slice(
    GOVERNANCE.indexOf('function public.recommendations_resolution_forward_only')
  );

  it('freezes the substance a decision cited', () => {
    // RLS grants UPDATE on recommendations, which is what lets a client accept
    // or dismiss. Unqualified it also lets one rewrite an accepted
    // recommendation's instruction after an event has cited it.
    expect(M1).toContain('create policy "recs_owner_update" on public.recommendations');
    expect(fn).toMatch(/if old\.status <> 'pending' then/);
    for (const column of ['kind', 'title', 'summary', 'instruction', 'severity']) {
      expect(fn).toContain(`new.${column}`);
    }
    for (const jsonb of ['rationale', 'scope', 'tags']) {
      expect(fn).toContain(`new.${jsonb}::text`);
    }
  });

  it('moves status forward only, and owns resolved_at', () => {
    expect(fn).toMatch(/old\.status = 'superseded'/);
    expect(fn).toMatch(/not in \('accepted', 'dismissed', 'superseded'\)/);
    expect(fn).toMatch(/new\.resolved_at = now\(\)/);
  });

  it('is attached as a trigger, not merely defined', () => {
    expect(GOVERNANCE).toMatch(
      /before update on public\.recommendations\s+for each row execute function public\.recommendations_resolution_forward_only\(\)/
    );
  });
});

describe('FR-02: no CHECK constraint was widened to make this fit', () => {
  it('recommendations.status still has exactly the four M1 values', () => {
    // Deferral was the pressure here: the UI needs "not now", and adding a
    // 'deferred' status would have been the tidy-looking fix. It is not this
    // table's job — a deferred recommendation is still pending, and the task
    // lives in project_tasks.
    const statuses = [...ALL_SQL.matchAll(/recs_status_chk check \(status in \(([^)]*)\)\)/g)];
    expect(statuses).toHaveLength(1);
    expect([...statuses[0][1].matchAll(/'(\w+)'/g)].map((m) => m[1])).toEqual([
      'pending',
      'accepted',
      'dismissed',
      'superseded',
    ]);
  });

  it('recommendations.kind still has exactly the eight M1 values', () => {
    const kinds = [...ALL_SQL.matchAll(/recs_kind_chk check \(kind in\s*\(([^)]*)\)\)/g)];
    expect(kinds).toHaveLength(1);
    expect([...kinds[0][1].matchAll(/'(\w+)'/g)].map((m) => m[1])).toEqual([
      'quick_action',
      'fix',
      'workflow',
      'coaching',
      'restraint',
      'setup',
      'stage_transition',
      'realignment',
    ]);
  });

  it('decisions.decision_type still has exactly the eight M1 values', () => {
    // No 'defer_recommendation'. Deferral is therefore NOT in the append-only
    // decision trail — a real and documented gap (see recommend.ts), left open
    // rather than closed by widening a contract-evidence constraint to make a
    // demo look tidier.
    const types = [...ALL_SQL.matchAll(/decisions_type_chk check \(decision_type in \(([^)]*)\)\)/g)];
    expect(types).toHaveLength(1);
    const values = [...types[0][1].matchAll(/'(\w+)'/g)].map((m) => m[1]);
    expect(values).toEqual([
      'accept_recommendation',
      'dismiss_recommendation',
      'restore_version',
      'skip_stage',
      'advance_stage',
      'return_stage',
      'finalize',
      'rate_version',
    ]);
    expect(values).not.toContain('defer_recommendation');
  });

  it('workflow_events.actor still has no "model"', () => {
    const actors = [...ALL_SQL.matchAll(/we_actor_chk check \(actor in \(([^)]*)\)\)/g)];
    expect(actors).toHaveLength(1);
    expect([...actors[0][1].matchAll(/'(\w+)'/g)].map((m) => m[1])).toEqual(['user', 'system']);
  });
});
