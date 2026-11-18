import { describe, expect, it } from 'vitest';

import { notApplicableNow } from './context';
import { evaluateStage } from './engine';
import { commitmentsToCheck } from './not-applicable';
import type { StageArtifactBundle } from './digest';
import type { StageContext, WorkflowEvent, WorkflowTemplate } from './types';

// 18 Nov, Sean, Executive Search: "I accept any new commitments this brief
// proposes" blocked a brief that proposed none.
const template = {
  key: 'custom_exec', version: 1, name: 'Executive search', description: '', outline_stage: 'none',
  stages: [{
    id: 'brief', label: 'Role brief', short_label: 'Brief', renderer: 'prose', transitions: { default_next: null },
    exit_criteria: [
      { id: 'brief.approved', label: 'I approve this brief as accurate', check: 'manual', blocking: true },
      { id: 'brief.decision', label: 'I accept any new commitments this brief proposes', check: 'manual', blocking: true, authority: 'reserved' },
    ],
  }],
} as unknown as WorkflowTemplate;
const bundles = (head: string) => ({ brief: { artifact: null, versions: [{ id: 'v1', content: 'old' }, { id: head, content: 'Commitments: none is proposed.' }] } }) as unknown as Record<string, StageArtifactBundle>;
const na = (version: string, actor: 'system' | 'user' = 'system', applies = false, quote = 'Commitments: none is proposed.'): WorkflowEvent =>
  ({ type: 'criterion_not_applicable', stage_id: 'brief', actor, payload: { criterion_id: 'brief.decision', version_id: version, quote: applies ? '' : quote, applies } }) as unknown as WorkflowEvent;

describe('a sign-off that does not apply to the current version', () => {
  it('holds for the version it was found on, and only while that version is the newest', () => {
    expect(notApplicableNow([na('v2')], bundles('v2'))).toEqual({ 'brief.decision': { versionId: 'v2', quote: 'Commitments: none is proposed.' } });
    expect(notApplicableNow([na('v2')], bundles('v3'))).toEqual({});
  });
  it('the user saying it does apply puts it back', () => {
    expect(notApplicableNow([na('v2'), na('v2', 'user', true)], bundles('v2'))).toEqual({});
  });
  it('a check that found a commitment, or no quote, records nothing that waves it through', () => {
    expect(notApplicableNow([na('v2', 'system', true)], bundles('v2'))).toEqual({});
    expect(notApplicableNow([na('v2', 'system', false, '  ')], bundles('v2'))).toEqual({});
  });
  it('the engine counts it met, says why, and leaves the other approval to the user', () => {
    const ctx = { manualChecks: {}, notApplicable: { 'brief.decision': { versionId: 'v2', quote: 'Commitments: none is proposed.' } } } as unknown as StageContext;
    const ev = evaluateStage(template, 'brief', ctx);
    const decision = ev.criteria.find((c) => c.id === 'brief.decision')!;
    expect(decision).toMatchObject({ satisfied: true, notApplicable: 'Commitments: none is proposed.' });
    expect(ev.criteria.find((c) => c.id === 'brief.approved')!.satisfied).toBe(false);
  });
});

describe('which versions are looked at', () => {
  it('the newest version of a stage with a commitments sign-off, once', () => {
    expect(commitmentsToCheck(template, bundles('v2'), [], {}).map((c) => [c.criterionId, c.versionId])).toEqual([['brief.decision', 'v2']]);
    expect(commitmentsToCheck(template, bundles('v2'), [na('v2', 'system', true)], {})).toEqual([]);
    // Ticked by the user: nothing to look at.
    expect(commitmentsToCheck(template, bundles('v2'), [], { 'brief.decision': true })).toEqual([]);
  });
});
