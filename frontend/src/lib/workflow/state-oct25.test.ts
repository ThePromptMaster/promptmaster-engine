/**
 * 25 Oct (Sean): approved decisions still called unresolved by the final
 * check; supplied facts read as "nothing has changed"; and an open objective
 * said the same way whether or not work could go on.
 */
import { describe, expect, it } from 'vitest';
import { approvalsGiven } from './approvals';
import { describeOutstanding, outstandingWork } from './engine';
import { inputsChanged, stageInputs } from './stage-inputs';
import { inputsFrom } from './stage-requests';
import { SINGLE_OUTPUT_V1 } from './templates/single-output.v1';
import type { Project } from '@/types/project';

const stage = SINGLE_OUTPUT_V1.stages.find((s) => s.exit_criteria.some((c) => c.check === 'manual'))!;
const criterion = stage.exit_criteria.find((c) => c.check === 'manual')!;
const v = (id: string, n: number) => ({ id, version_number: n }) as never;

describe('approvals reach the prompts', () => {
  it('lists each ticked approval with the version it was given on', () => {
    const bundles = { [stage.id]: { artifact: null, versions: [v('a', 1), v('b', 2), v('c', 3)] } };
    const out = approvalsGiven({ manual_checks: { [criterion.id]: true }, manual_check_versions: { [criterion.id]: 'b' } }, SINGLE_OUTPUT_V1, bundles);
    expect(out).toEqual([{ stage: stage.label, approval: criterion.label, version: 2, current: 3 }]);
    expect(approvalsGiven({ manual_checks: {}, manual_check_versions: {} }, SINGLE_OUTPUT_V1, bundles)).toEqual([]);
  });

  it('inputsFrom sends them', () => {
    const approvals = [{ stage: 'Budget', approval: 'I approve the ceiling', version: 1, current: 1 }];
    const project = { objective: 'o', audience: 'a', constraints: '', output_format: '', mode: 'architect', approvals } as unknown as Project;
    expect(inputsFrom(project).approvals).toEqual(approvals);
  });
});

describe('a fact or the context changing is a change', () => {
  it('names a new fact and a changed context', () => {
    const then = stageInputs({ objective: 'o', facts: [{ id: 'f1' }], context: 'x' }, 'v1');
    const now = stageInputs({ objective: 'o', facts: [{ id: 'f1' }, { id: 'f2' }], context: 'y' }, 'v1');
    expect(inputsChanged(then, now)?.what).toEqual(['a fact was accepted', 'the project context changed']);
  });

  it('a record made before facts were kept is read as before', () => {
    const now = stageInputs({ objective: 'o', facts: [{ id: 'f1' }] }, 'v1');
    expect(inputsChanged({ files: [], version: 'v1', brief: now.brief }, now)?.changed).toBe(false);
  });
});

describe('an open objective with work that can go on is not "not met — waiting"', () => {
  it('says the next task and what is missing only for other work', () => {
    const items = outstandingWork(SINGLE_OUTPUT_V1, { current_stage_id: stage.id, stages: {} }, {}, {
      objectiveUnmet: { blockers: ['the 2023 PDFs'], next: 'Two-interval Rényi-2 calculation' },
    });
    const line = describeOutstanding(items.find((i) => i.kind === 'objective_unmet')!);
    expect(line).toMatch(/still open/);
    expect(line).toMatch(/Two-interval Rényi-2 calculation/);
    expect(line).toMatch(/Missing only for other work: the 2023 PDFs/);
  });
});
