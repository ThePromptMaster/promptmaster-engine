import { describe, expect, it } from 'vitest';

import { projectState } from './engine';
import { BOOK_V1 } from './templates/book.v1';
import { inputsChanged, stageInputs } from './stage-inputs';
import type { WorkflowEvent } from './types';

const project = { objective: 'Why churn rose', audience: 'Executive', constraints: '', output_format: 'memo', data_files: [{ id: 'f2' }, { id: 'f1' }] };

describe('what a stage had to work with when it was marked stuck (2 Oct, item 9)', () => {
  it('is the data files, the stage\'s head version and the brief', () => {
    expect(stageInputs(project, 'v3')).toMatchObject({ files: ['f1', 'f2'], version: 'v3' });
    expect(stageInputs({}, undefined)).toEqual({ files: [], version: null, brief: '␟␟␟' });
  });

  it('says nothing changed when nothing did', () => {
    expect(inputsChanged(stageInputs(project, 'v3'), stageInputs({ ...project, data_files: [{ id: 'f1' }, { id: 'f2' }] }, 'v3'))).toEqual({ changed: false, what: [] });
  });

  it('says what changed', () => {
    const then = stageInputs(project, 'v3');
    expect(inputsChanged(then, stageInputs({ ...project, data_files: [...project.data_files, { id: 'f3' }] }, 'v3'))?.what).toEqual(['a data file was added']);
    expect(inputsChanged(then, stageInputs({ ...project, data_files: [] }, 'v4'))?.what).toEqual(['2 data files were removed', 'the work on this stage changed']);
    expect(inputsChanged(then, stageInputs({ ...project, objective: 'Why churn fell' }, 'v3'))?.what).toEqual(['the project brief changed']);
  });

  it('does not call an unrecorded block "unchanged"', () => {
    expect(inputsChanged(undefined, stageInputs(project, 'v3'))).toBeNull();
    expect(inputsChanged({ files: 'x' }, stageInputs(project, 'v3'))).toBeNull();
  });

  it('is carried on the block, and kept as the last block once cleared', () => {
    const inputs = stageInputs(project, null);
    const blocked: WorkflowEvent = { type: 'stage_blocked', stage_id: 'objective', actor: 'user', reason: 'No data', payload: { block_kind: 'data_missing', inputs_at_block: inputs }, created_at: '2026-10-02T00:00:00Z' };
    const state = projectState(BOOK_V1, [blocked]);
    expect(state.stages.objective.blocked).toEqual({ kind: 'data_missing', reason: 'No data', inputs });
    const cleared = projectState(BOOK_V1, [blocked, { type: 'stage_unblocked', stage_id: 'objective', actor: 'user', created_at: '2026-10-02T00:01:00Z' }]);
    expect(cleared.stages.objective.blocked).toBeUndefined();
    expect(cleared.stages.objective.last_block).toEqual({ kind: 'data_missing', inputs });
  });
});
