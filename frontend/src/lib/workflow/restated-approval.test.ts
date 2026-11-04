/**
 * 4 Nov (Sean): Go said it had decided the routine findings, then asked him to
 * attest "I have accepted or rejected each finding"; "Carry on with other
 * work first" led straight back to the same approval. The bicycle project
 * (1 Nov) pinned a design from before 2 Nov, whose Check stage carries both
 * criteria below.
 */
import { describe, expect, it } from 'vitest';

import { otherWorkFor } from '@/lib/agent/other-work';
import { effectiveTemplate } from './added-stages';
import { withRestatedApprovalsAsChecks } from './triage-approval';
import { BOOK_V1 } from './templates/book.v1';
import { RESEARCH_V1 } from './templates/research.v1';
import { SINGLE_OUTPUT_V1 } from './templates/single-output.v1';
import { ASSESSMENT_V1 } from './templates/assessment.v1';
import { EXPLORATION_V1 } from './templates/exploration.v1';
import { QUICK_V1 } from './templates/quick.v1';
import type { OutstandingItem } from './engine';
import type { StageDefinition, WorkflowTemplate } from './types';

const check: StageDefinition = {
  ...BOOK_V1.stages.find((s) => s.id === 'critique')!,
  id: 'accuracy_and_requirements_chec',
  label: 'Accuracy and requirements check',
  exit_criteria: [
    { id: 'accuracy_and_requirements_chec.triaged', label: 'Every finding accepted or rejected', check: 'auto', rule: { type: 'all_findings_triaged' }, blocking: false },
    { id: 'accuracy_and_requirements_chec.approved', label: 'I have accepted or rejected each finding', check: 'manual', blocking: true, authority: 'delegable' },
  ],
};
const old: WorkflowTemplate = { ...BOOK_V1, key: 'custom_332720c0a4', stages: [BOOK_V1.stages[0], check] };

describe('an old design\'s "accepted or rejected each finding" box is the check it restates', () => {
  it('folds the box into the automatic check, which now blocks', () => {
    const t = withRestatedApprovalsAsChecks(old);
    const criteria = t.stages[1].exit_criteria;
    expect(criteria.map((c) => c.id)).toEqual(['accuracy_and_requirements_chec.triaged']);
    expect(criteria[0].blocking).toBe(true);
    expect(criteria[0].check).toBe('auto');
    // The stored template is not touched.
    expect(old.stages[1].exit_criteria).toHaveLength(2);
  });

  it('keeps a box that says something else, and a box on a stage without the automatic check', () => {
    const other = { ...check, exit_criteria: [check.exit_criteria[0], { ...check.exit_criteria[1], label: 'I approve the corrected figures' }] };
    expect(withRestatedApprovalsAsChecks({ ...old, stages: [old.stages[0], other] }).stages[1].exit_criteria).toHaveLength(2);
    const alone = { ...check, exit_criteria: [check.exit_criteria[1]] };
    expect(withRestatedApprovalsAsChecks({ ...old, stages: [old.stages[0], alone] }).stages[1].exit_criteria).toHaveLength(1);
  });

  it('leaves the system workflows as they are', () => {
    for (const t of [BOOK_V1, RESEARCH_V1, SINGLE_OUTPUT_V1, ASSESSMENT_V1, EXPLORATION_V1, QUICK_V1]) expect(withRestatedApprovalsAsChecks(t)).toBe(t);
  });

  it('is what the workspace reads', () => {
    expect(effectiveTemplate(old, []).stages[1].exit_criteria.map((c) => c.id)).toEqual(['accuracy_and_requirements_chec.triaged']);
  });
});

describe('"Carry on with other work first" only when there is other work for Go', () => {
  const here = 'final_memo';
  it('a stage elsewhere awaiting a recheck, or a draft Go would revise, is other work', () => {
    const items: OutstandingItem[] = [{ kind: 'stale_stage', stageId: 'figures', label: 'Figures', reason: 'the reserve changed' }];
    expect(otherWorkFor(items, here)).toBe(true);
    expect(otherWorkFor([{ kind: 'check_says', stageId: 'draft', label: 'Draft', says: 'incomplete' }], here)).toBe(true);
  });

  it('the approval itself, the user\'s rows elsewhere, or Go waiting are not', () => {
    const items: OutstandingItem[] = [
      { kind: 'unmet_blocking', stageId: here, label: 'Final memo', criteria: ['I approve this memo'] },
      { kind: 'stale_stage', stageId: here, label: 'Final memo', reason: 'x' },
      { kind: 'open_findings', stageId: 'check', label: 'Check', count: 1 },
      { kind: 'go_waiting', label: 'Go', need: 'your approval' },
    ];
    expect(otherWorkFor(items, here)).toBe(false);
    expect(otherWorkFor([], here)).toBe(false);
  });
});
