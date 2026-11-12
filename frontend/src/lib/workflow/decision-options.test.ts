import { describe, expect, it } from 'vitest';

import { decisionAsFact } from './answers';
import { approvalsGiven, approvalsOnEarlierVersion, chosenFor, earlierDecision } from './approvals';
import { answeredOnStages } from './brief-change';
import { asksForDecision, decisionTargets, decisionText, givenByChoosing, offerKey, recordDecisionReason } from './decision-options';
import type { StageArtifactBundle } from './digest';
import type { WorkflowTemplate } from './types';
import type { ProjectFact } from '@/types/project';

/**
 * 12 Nov, two production projects: "I approve this decision on the cap." and
 * "I choose Option A or Option B (stating which one)." were one button,
 * "Approve and resume", with nowhere to say which.
 */
const template = {
  stages: [
    { id: 'check', label: 'Check', renderer: 'review', exit_criteria: [{ id: 'check.approved', label: 'I confirm the brief is ready for my decision.', check: 'manual', blocking: true, authority: 'reserved' }] },
    {
      id: 'cap', label: 'Decide on the cap change', short_label: 'Cap decision', renderer: 'prose',
      exit_criteria: [
        { id: 'cap.written', label: 'Written', check: 'auto', blocking: true, rule: { type: 'artifact_non_empty' } },
        { id: 'cap.routine', label: 'The figures match the brief', check: 'manual', blocking: true, authority: 'delegable' },
        { id: 'cap.approved', label: 'I approve this decision on the cap.', check: 'manual', blocking: true, authority: 'reserved' },
      ],
    },
    { id: 'final', label: 'Final pack', renderer: 'prose', exit_criteria: [{ id: 'final.approved', label: 'I approve the final shortlists and the decision record.', check: 'manual', blocking: true, authority: 'reserved' }] },
  ],
} as unknown as WorkflowTemplate;

const version = (id: string, n: number, content: string, op = 'agent_draft') => ({ id, version_number: n, content, source_operation: op, change_summary: '' });
const bundles = (cap: ReturnType<typeof version>[], final: ReturnType<typeof version>[] = []) =>
  ({ cap: { versions: cap }, final: { versions: final }, check: { versions: [version('c1', 1, '{"kind":"stage_items","items":[]}')] } }) as unknown as Record<string, StageArtifactBundle>;

const AWAITING = 'Status: Awaiting the user\'s decision.\n- Option A: raise the cap to $195,000.\n- Option B: keep $180,000.';

describe('which approvals have options read for them', () => {
  it('is a reserved approval, not yet given, on a prose stage that holds text', () => {
    const targets = decisionTargets(template, bundles([version('v1', 1, AWAITING)]), {}, ['cap', 'check', 'final', null, undefined]);
    expect(targets).toEqual([{ criterionId: 'cap.approved', approval: 'I approve this decision on the cap.', stageId: 'cap', stageLabel: 'Decide on the cap change', content: AWAITING, versionId: 'v1' }]);
    expect(offerKey(targets[0])).toBe('cap.approved:v1');
  });

  it('is none once the approval is given, or for a stage that was not asked about', () => {
    expect(decisionTargets(template, bundles([version('v1', 1, AWAITING)]), { 'cap.approved': true }, ['cap'])).toEqual([]);
    expect(decisionTargets(template, bundles([version('v1', 1, AWAITING)]), {}, ['final'])).toEqual([]);
    expect(decisionTargets(template, bundles([]), {}, ['cap'])).toEqual([]);
  });

  it('reads the head version: a new text is a new read', () => {
    const [t] = decisionTargets(template, bundles([version('v1', 1, AWAITING), version('v2', 2, 'Decision: Option A.')]), {}, ['cap']);
    expect(t.versionId).toBe('v2');
    expect(t.content).toBe('Decision: Option A.');
  });
});

describe('an approval worded as a decision', () => {
  it.each([
    'I approve this decision on the cap.',
    'I choose Option A or Option B (stating which one).',
    'I choose option A or option B (state which).',
    'I select the recovery plan to carry forward',
    'I decide whether the exception is granted',
  ])('%s', (label) => expect(asksForDecision(label)).toBe(true));

  it.each([
    'I confirm the shortlists and brief are accurate and ready for my decision.',
    'I approve the final shortlists and the decision record.',
    'I accept this decision package as final.',
    'I approve this decision package for internal use.',
    'I approve the decision record as written.',
    'I approve this leadership brief.',
  ])('not: %s', (label) => expect(asksForDecision(label)).toBe(false));
});

describe('what a chosen option records', () => {
  const fact = decisionAsFact('I approve this decision on the cap.', 'Cap decision', '  Option A: raise the cap to $195,000 per hire for both searches ', { criterion_id: 'cap.approved', stage_id: 'cap', version_id: 'v1', run_id: 'r1' })!;

  it('is a fact of the project that names the approval, the stage and the choice', () => {
    expect(fact.statement).toBe('Decided by the user — on "I approve this decision on the cap" (Cap decision): Option A: raise the cap to $195,000 per hire for both searches');
    expect(fact.subject).toBe('Decision');
    expect(fact.source_ref).toMatchObject({ via: 'go answer', criterion_id: 'cap.approved', stage_id: 'cap', version_id: 'v1', choice: 'Option A: raise the cap to $195,000 per hire for both searches' });
  });

  it('records nothing for an empty choice', () => {
    expect(decisionAsFact('I approve', 'Cap', '   ', { criterion_id: 'c', stage_id: 's' })).toBeNull();
  });

  it('leaves the stage it was decided on to Go: the change check does not reopen it a second time', () => {
    const saved = { ...fact, id: 'f1', retired_at: null } as unknown as ProjectFact;
    expect(answeredOnStages('', [saved])).toEqual(new Set(['cap']));
  });

  it('leaves the stages before the decision alone too: they are what it was made from (12 Nov, production)', () => {
    // Choosing the $195,000 cap reopened the shortlists under $180,000, the brief and the check.
    const saved = { ...fact, id: 'f1', retired_at: null } as unknown as ProjectFact;
    expect(answeredOnStages('', [saved], ['shortlists', 'brief', 'check', 'cap', 'final'])).toEqual(new Set(['shortlists', 'brief', 'check', 'cap']));
  });

  it('an answer to a question of Go\'s still leaves only its own stage', () => {
    const answer = { id: 'f2', retired_at: null, statement: 'Decided by the user — asked "Shorter?", answered: Yes', kind: 'fact', source_ref: { via: 'go answer', stage_id: 'cap' } } as unknown as ProjectFact;
    expect(answeredOnStages('', [answer], ['shortlists', 'brief', 'check', 'cap', 'final'])).toEqual(new Set(['cap']));
  });

  it('tells the repair to write the decision in and change nothing else', () => {
    expect(recordDecisionReason('Option A')).toContain('the user has decided: "Option A"');
    expect(recordDecisionReason('Option A')).toContain('Change nothing else');
    expect(decisionText(`${'x'.repeat(500)}`).length).toBe(400);
  });
});

describe('the approval carries its choice', () => {
  const facts = [
    { source_ref: { via: 'go answer', criterion_id: 'cap.approved', choice: 'Option B: keep $180,000' }, retired_at: '2026-11-12T00:00:00Z' },
    { source_ref: { via: 'go answer', criterion_id: 'cap.approved', choice: 'Option A: raise the cap to $195,000' }, retired_at: null },
    { source_ref: { via: 'front door' }, retired_at: null },
  ] as unknown as ProjectFact[];
  const project = { manual_checks: { 'cap.approved': true, 'final.approved': true }, manual_check_versions: { 'cap.approved': 'v1', 'final.approved': 'f1' }, routine_decisions: 'handle' as const, facts };

  it('is read from the fact, by criterion; a retired fact says nothing', () => {
    expect(Object.fromEntries(chosenFor(facts))).toEqual({ 'cap.approved': 'Option A: raise the cap to $195,000' });
    expect(chosenFor(undefined).size).toBe(0);
  });

  it('goes to every prompt with the approval, and a plain sign-off has none', () => {
    const given = approvalsGiven(project, template, bundles([version('v1', 1, AWAITING)], [version('f1', 1, 'Final.')]));
    expect(given.find((a) => a.stage === 'Decide on the cap change')).toMatchObject({ approval: 'I approve this decision on the cap.', choice: 'Option A: raise the cap to $195,000', version: 1, current: 1 });
    expect(given.find((a) => a.stage === 'Final pack')).not.toHaveProperty('choice');
  });

  it('is not asked for again after Go writes the decision into the stage', () => {
    const recorded = bundles([version('v1', 1, AWAITING), version('v2', 2, 'Decision: Option A, raise the cap to $195,000.', 'agent_revise')], [version('f1', 1, 'Final.')]);
    expect(approvalsOnEarlierVersion(project, template, recorded)).toEqual([]);
  });

  it('is asked for again when the user changed the stage themselves afterwards', () => {
    const edited = bundles([version('v1', 1, AWAITING), version('v2', 2, 'Decision: Option A.', 'agent_revise'), version('v3', 3, 'Decision: Option B after all.', 'stage_edit')], [version('f1', 1, 'Final.')]);
    expect(approvalsOnEarlierVersion(project, template, edited).map((a) => a.stageId)).toEqual(['cap']);
  });

  it('a plain sign-off on an earlier version is still said, as before', () => {
    const moved = bundles([version('v1', 1, AWAITING)], [version('f1', 1, 'Final.'), version('f2', 2, 'Final, revised.', 'agent_revise')]);
    expect(approvalsOnEarlierVersion(project, template, moved).map((a) => a.stageId)).toEqual(['final']);
  });
});

describe('an answer given from the list of what is waiting', () => {
  it('is recorded even when it is one word, with the kept questions and rows it answers', async () => {
    const { queueAnswerAsFact } = await import('./answers');
    const fact = queueAnswerAsFact('Are any absences expected that week?', '  None ', { stage_id: 'check', run_id: 'r1', kept_step_ids: ['k1'], row_ids: ['check::i5'] })!;
    expect(fact.statement).toBe('Decided by the user — asked "Are any absences expected that week?", answered: None');
    expect(fact.source_ref).toMatchObject({ via: 'go answer', stage_id: 'check', kept_step_ids: ['k1'], row_ids: ['check::i5'] });
    expect(queueAnswerAsFact('Q?', '   ', { stage_id: 'check' })).toBeNull();
  });
});

describe('an approval given by choosing is never offered as a bare tick (12 Nov, production pass)', () => {
  // The pinned copy of Go's stop still read "Approve and resume" beside a card that listed Option A and Option B.
  it('is so while its options are shown or still being read, and not otherwise', () => {
    expect(givenByChoosing({ loading: false, question: '', options: [{ label: 'Option A', quote: 'q' }, { label: 'Option B', quote: 'q' }] })).toBe(true);
    expect(givenByChoosing({ loading: true, question: '', options: [] })).toBe(true);
    expect(givenByChoosing({ loading: false, question: '', options: [] })).toBe(false);
    expect(givenByChoosing(null)).toBe(false);
    expect(givenByChoosing(undefined)).toBe(false);
  });
});

describe('a decision made again replaces the earlier one', () => {
  const facts = [
    { id: 'a', source_ref: { criterion_id: 'cap.approved', choice: 'Option A' }, retired_at: '2026-11-12T10:00:00Z' },
    { id: 'b', source_ref: { criterion_id: 'cap.approved', choice: 'Option B' }, retired_at: null },
    { id: 'c', source_ref: { criterion_id: 'final.approved', choice: 'x' }, retired_at: null },
    { id: 'd', source_ref: { via: 'front door' }, retired_at: null },
  ] as unknown as ProjectFact[];

  it('finds the current decision fact for that approval, and none for another', () => {
    expect((earlierDecision(facts, 'cap.approved') as ProjectFact).id).toBe('b');
    expect(earlierDecision(facts, 'brief.approved')).toBeNull();
    expect(earlierDecision(undefined, 'cap.approved')).toBeNull();
  });
});
