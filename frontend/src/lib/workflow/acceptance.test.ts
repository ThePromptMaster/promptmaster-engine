/**
 * Sean's acceptance tests for delegated authority and safe project updates
 * (email of 5 Oct, "Acceptance tests for delegated authority and safe project
 * updates"), as code. One `describe` per case, in his order. A case that is
 * built is a real test over the pure functions that decide it; a case that is
 * not yet built is `it.todo`, with the register entry that says why.
 *
 * What a pure function cannot show — what the database refuses — is covered by
 * e2e/routine-decisions.spec.ts and e2e/apply-table.spec.ts. The assessment is
 * docs/assessments/2026-10-06-delegation-and-efficiency.md.
 */
import { describe, expect, it } from 'vitest';

import { delegableToCommit, needsUser, requiredWork } from '@/lib/agent/needs';
import { checkCommit } from './commit-check';
import { presentationOnly } from './brief-change';
import { templateFromDesign, type DesignedWorkflow } from './custom';
import { initialState, projectState } from './engine';
import { isTriaged, serializeItems, ITEM_SCHEMAS } from './stage-artifact';
import type { StageEvaluation, WorkflowEvent } from './types';

const design: DesignedWorkflow = {
  name: 'Supplier review', description: '', deliverable: 'memo', inquiry: false,
  stages: [
    { label: 'Brief', short_label: 'Brief', kind: 'write', purpose: 'p', instruction: 'i', required: true, approval: '' },
    {
      label: 'Extract terms', short_label: 'Terms', kind: 'list', purpose: 'p', instruction: 'i', required: true,
      approval: 'I confirm the extracted terms match the contract', approval_kind: 'routine',
      decision: 'I accept the new commitments it proposes',
    },
    { label: 'Memo', short_label: 'Memo', kind: 'write', purpose: 'p', instruction: 'i', required: true, approval: '' },
  ],
};
const template = templateFromDesign(design, 'acc');
const terms = template.stages[1];
const unmet = (...ids: string[]): StageEvaluation => ({
  stageId: terms.id, criteria: [], canAdvance: false,
  unmet: ids.map((id) => ({ id, label: terms.exit_criteria.find((c) => c.id === id)!.label, satisfied: false, blocking: true, manual: true })),
});
const drafted = { draft: { truncated: false, checked: true } } as never;
const base = { state: initialState(template), policy: 'autonomous' as const, outlineStageId: null, facts: drafted, stage: terms, allowed: ['commit_delegated', 'revise_stage'] };
const ev = (type: WorkflowEvent['type'], stage_id: string, created_at: string, extra: Partial<WorkflowEvent> = {}): WorkflowEvent => ({
  type, stage_id, actor: 'user', created_at, ...extra,
});

describe('1. Routine extraction proceeds without unnecessary approval', () => {
  it('under "handle them for me", the extraction check is Go\'s to commit, not a question', () => {
    const e = unmet(`${terms.id}.approved`);
    expect(requiredWork({ ...base, stageEvaluation: e, routine: 'handle' })).toMatchObject({ key: 'commit_delegated' });
    expect(needsUser({ ...base, stageEvaluation: e, routine: 'handle' })).toBeNull();
  });
  it.todo('its status stays "supported by supplied material", not externally verified — rows carry status_source, but extraction rows have no supplied-vs-verified status yet (L-46)');
});

describe('2. A new commitment receives separate authority treatment', () => {
  it('the commitment is its own sign-off, reserved to the user, and Go stops for it', () => {
    const e = unmet(`${terms.id}.decision`);
    expect(delegableToCommit(terms, e, 'handle')).toBeNull();
    expect(needsUser({ ...base, stageEvaluation: e, routine: 'handle' })).toMatchObject({ kind: 'tick_criterion', authority: 'reserved' });
  });
});

describe('3. Failed revisions preserve the valid current artifact', () => {
  const table = serializeItems([{ id: 'a', term: 'Net 30', status: 'accepted', status_source: 'user' }, { id: 'b', term: 'Penalty clause' }]);
  it('an empty, malformed or row-dropping revision is refused and the current version stays', () => {
    expect(checkCommit({ before: table, after: '', operation: 'agent_revise' })).toMatch(/empty/);
    expect(checkCommit({ before: table, after: 'Here are the terms…', operation: 'agent_revise' })).toMatch(/text instead of a table/);
    expect(checkCommit({ before: table, after: serializeItems([{ id: 'b', term: 'Penalty clause' }]), operation: 'agent_revise' })).toMatch(/dropped a row you had decided/);
  });
  it('the refused attempt is in the history and moves nothing', () => {
    const before = projectState(template, []);
    expect(projectState(template, [ev('revision_refused', terms.id, 't', { actor: 'system', reason: 'empty' })])).toEqual(before);
  });
});

describe('4. A factual change triggers relevant downstream review', () => {
  it('only the stages named as relying on it are reopened, with why', () => {
    const done = template.stages.slice(0, 2).map((s, i) =>
      ev('stage_marked_complete', s.id, `2026-10-06T10:0${i}:00Z`, { to_stage_id: template.stages[i + 1].id, payload: { evidence_version_id: `v${i}` } })
    );
    const state = projectState(template, [
      ...done,
      ev('brief_changed', 'memo', '2026-10-06T11:00:00Z', { payload: { field: 'context', kind: 'fact', affected: [{ stage_id: terms.id, reason: 'Relied on secured funding.' }] } }),
    ]);
    expect(state.stages[terms.id]).toMatchObject({ status: 'stale', stale: { reason: 'Relied on secured funding.' } });
    expect(state.stages[template.stages[0].id].status).toBe('completed_with_artifact');
  });
  it.todo('"repair what it can": Go revises a reopened stage against the change on its own — it is marked for recheck, not yet repaired (L-45)');
});

describe('5. A presentation change avoids unnecessary rework', () => {
  it('punctuation and formatting are caught without a model call and reopen nothing', () => {
    expect(presentationOnly('Funding is secured through Q3 2026', 'Funding is secured through Q3, 2026.')).toBe(true);
    expect(presentationOnly('Funding is secured', 'Funding is pending')).toBe(false);
  });
});

describe('6. Changed intent preserves valid calculations but reopens affected recommendations', () => {
  it('a change of intent reopens only what was judged against it (which, is the assess-change call\'s; see test_change_impact.py)', () => {
    const state = projectState(template, [
      ev('stage_marked_complete', template.stages[0].id, 't1', { to_stage_id: terms.id, payload: { evidence_version_id: 'v0' } }),
      ev('stage_marked_complete', terms.id, 't2', { to_stage_id: 'memo', payload: { evidence_version_id: 'v1' } }),
      ev('brief_changed', 'memo', 't3', { payload: { kind: 'intent', calculations_hold: true, affected: [{ stage_id: template.stages[0].id, reason: 'Judged against margin.' }] } }),
    ]);
    expect(state.stages[template.stages[0].id].status).toBe('stale');
    expect(state.stages[terms.id].status).toBe('completed_with_artifact');
  });
});

describe('7. Pending work respects changed authority', () => {
  it('the policy is read at each move: narrowed to "ask", the same approval is no longer Go\'s', () => {
    const e = unmet(`${terms.id}.approved`);
    expect(delegableToCommit(terms, e, 'handle')).not.toBeNull();
    expect(delegableToCommit(terms, e, 'ask')).toBeNull();
    // The database re-reads projects.routine_decisions when the commit is written: e2e/routine-decisions.spec.ts.
  });
  it.todo('external actions under a narrowed authority — PromptMaster takes none today, so there is nothing to govern yet (L-48)');
});

describe('8. Evidence conflict produces investigation before interruption', () => {
  it.todo('two sources disagreeing on a material input are investigated with the authorised tools before the user is asked (L-44)');
});

describe('9. Approval preserves evidence limitations', () => {
  it('approving a stage does not promote a proposal, an assumption or an AI reading to a decision', () => {
    const validation = ITEM_SCHEMAS.validation_table;
    const proposed = { id: 'r', result: 'Margin fell', status: 'supported_by_prior', status_source: 'proposed', reason: 'r' };
    // A tick is projects.manual_checks; nothing in that path writes a row.
    expect(isTriaged(proposed, validation)).toBe(false);
  });
});

describe('10. Several small decisions respect aggregate limits', () => {
  it.todo('a cumulative budget or scope limit is checked across individually permitted decisions (L-43)');
});
