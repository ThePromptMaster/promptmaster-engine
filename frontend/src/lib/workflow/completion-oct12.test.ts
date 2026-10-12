/**
 * 12 Oct (Sean): the sidebar said "4 done · 1 skipped · 0 to go" while Go
 * waited on corrections; a routine Defer still stopped Go; carried-forward
 * findings waited instead of being repaired.
 */
import { describe, expect, it } from 'vitest';

import { staleRepair } from '@/lib/agent/needs';
import { partialUpdate } from '@/components/workflow/brief-change-notice';
import { initialState, outstandingWork, progressCaptionText, progressSummary } from './engine';
import { carriedForwardUnmet, deferredNotBlocking, itemSchemaFor, type StageItem } from './stage-artifact';
import { SINGLE_OUTPUT_V1 } from './templates/single-output.v1';
import type { WorkflowState } from './types';

const T = SINGLE_OUTPUT_V1;
const finished = (): WorkflowState => {
  const st = initialState(T);
  for (const s of T.stages) st.stages[s.id] = { ...st.stages[s.id], status: s.id === 'realign' ? 'skipped' : 'complete' } as never;
  return st;
};

describe('the sidebar counts what Go stops on', () => {
  it('says what is still open beside "0 to go"', () => {
    const st = finished();
    const open = outstandingWork(T, st, { measured: { output: [{ id: 'm', label: 'Summary: at most 100 words', satisfied: false, detail: '212 words' }] } });
    expect(open.map((o) => o.kind)).toEqual(['unmet_blocking']);
    expect(progressCaptionText(progressSummary(T, st), false, [...open, { kind: 'go_waiting', label: 'Go', need: 'x' }])).toBe(
      '4 done · 1 skipped · 0 to go · 1 still open · Go is waiting for you'
    );
  });

  it('reads as before when nothing is open', () => {
    expect(progressCaptionText(progressSummary(T, finished()), false, [])).toBe('4 done · 1 skipped · 0 to go');
  });
});

describe('a Defer under the routine-decision policy does not block', () => {
  const schema = itemSchemaFor(T.stages.find((s) => s.id === 'summary')!);
  const row = (over: Partial<StageItem>): StageItem => ({ id: 'r', text: 'Closing summary wording is inconsistent with H1', status: 'deferred', reason: 'Defer — routine', ...over }) as StageItem;

  it('a minor wording finding Go deferred under the policy is listed, not blocking', () => {
    const r = row({ severity: 'minor', status_source: 'policy' });
    expect(carriedForwardUnmet([r], schema)).toEqual([]);
    expect(deferredNotBlocking([r], schema)).toHaveLength(1);
  });

  it('the same row deferred by hand, or a major one, still blocks', () => {
    expect(carriedForwardUnmet([row({ severity: 'minor' })], schema)).toHaveLength(1);
    expect(carriedForwardUnmet([row({ severity: 'major', status_source: 'policy' })], schema)).toHaveLength(1);
  });

  it('on a table whose rows do not block finishing, only a major row does', () => {
    expect(carriedForwardUnmet([row({ severity: 'minor' })], schema, true)).toEqual([]);
    expect(carriedForwardUnmet([row({ severity: 'major' })], schema, true)).toHaveLength(1);
  });
});

describe('carried-forward findings are repaired under "handle them for me"', () => {
  it('revises the finished deliverable with the rows', () => {
    const st = finished();
    st.current_stage_id = 'summary';
    const move = staleRepair(T, st, [], {}, new Set(['output']), { deliverableId: 'output', rows: ['The ending after Q11 is missing'] });
    expect(move).toMatchObject({ key: 'recheck_stage', params: { stage_id: 'output', carried: ['The ending after Q11 is missing'] } });
  });

  it('no more than twice', () => {
    const st = finished();
    st.current_stage_id = 'summary';
    expect(staleRepair(T, st, ['output', 'output'], {}, new Set(['output']), { deliverableId: 'output', rows: ['x'] })).toBeNull();
  });
});

describe('a partial update says what is left', () => {
  const label = (id: string) => id[0].toUpperCase() + id.slice(1);
  it('names what was updated and what still waits', () => {
    expect(partialUpdate(['output', 'realign', 'summary'], ['summary'], label)).toBe('2 of 3 updated (Output, Realign). Still awaiting a recheck: Summary.');
  });
  it('says nothing before anything is updated', () => {
    expect(partialUpdate(['output'], ['output'], label)).toBeNull();
  });
});
