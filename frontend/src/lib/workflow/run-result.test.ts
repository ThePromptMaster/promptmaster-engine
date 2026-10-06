import { describe, expect, it } from 'vitest';

import { carryUserFields } from './apply-findings';
import { figuresFromOutput, mergeFigures, withRunFigures } from './figures';
import { applyRunBlocked, applyRunResult, reasonFromRow, runObservation } from './run-result';
import { ITEM_SCHEMAS, isTriaged, type StageItem } from './stage-artifact';

const runs = ITEM_SCHEMAS.runs;
const run = { id: '0a1b2c3d-0000-0000-0000-000000000000', stdout: 'rows: 240\nmid_market_churn_rate: 8.8%\n' };
const rows: StageItem[] = [
  { id: 'r1', run: 'Count the accounts', status: 'not_run', reason: 'No data was provided.', status_source: 'model' },
  { id: 'r2', run: 'Interview five customers', status: 'not_run', reason: 'We chose not to.', status_source: 'user' },
  { id: 'r3', run: 'Compare cohorts' },
];

describe('a sandbox run settles the row it carried out (1 Oct, item 17)', () => {
  it('marks the row completed, with what the run printed and where it came from', () => {
    const result = applyRunResult(rows, 1, runs, run)!;
    expect(result.row).toEqual({
      id: 'r1', run: 'Count the accounts', status: 'completed', status_source: 'sandbox', sandbox_run_id: run.id,
      observed: 'Ran in the sandbox (run 0a1b2c3d). Output: rows: 240 mid_market_churn_rate: 8.8%',
    });
    // The reason belonged to "not run"; the row now counts as resolved without one.
    expect(result.row.reason).toBeUndefined();
    expect(isTriaged(result.row, runs)).toBe(true);
    expect(result.items[1]).toBe(rows[1]);
  });

  it('empties what the draft wrote about a run it could not make — it is no longer true', () => {
    const drafted: StageItem[] = [
      { id: 'r1', run: 'Count the accounts', observed: 'Not provided.', deviation: 'The outcome is not available in the provided materials.', status: 'not_run', reason: 'No data.', status_source: 'model' },
      { id: 'r2', run: 'Compare cohorts', deviation: 'Used last quarter only.' },
    ];
    expect(applyRunResult(drafted, 1, runs, run)!.row.deviation).toBeUndefined();
    // A row the model had not ruled on keeps what was written beside it.
    expect(applyRunResult(drafted, 2, runs, run)!.row.deviation).toBe('Used last quarter only.');
  });

  it('takes the row number as the planner gives it, and settles an untouched row', () => {
    expect(applyRunResult(rows, '3', runs, run)!.row).toMatchObject({ id: 'r3', status: 'completed', status_source: 'sandbox' });
  });

  it('leaves alone a row the user decided, a row that is not there, and a table a run cannot settle', () => {
    expect(applyRunResult(rows, 2, runs, run)).toBeNull();
    expect(applyRunResult(rows, 9, runs, run)).toBeNull();
    expect(applyRunResult(rows, undefined, runs, run)).toBeNull();
    expect(applyRunResult(rows, 'the first', runs, run)).toBeNull();
    expect(applyRunResult(rows, 1, ITEM_SCHEMAS.claim_table, run)).toBeNull();
  });

  it('keeps the observation inside the cell, and says when nothing was printed', () => {
    expect(runObservation({ id: run.id, stdout: 'x'.repeat(900) }).length).toBeLessThanOrEqual(400);
    expect(runObservation({ id: run.id, stdout: '  \n' })).toBe('Ran in the sandbox (run 0a1b2c3d). It printed nothing.');
  });

  it('survives the table being regenerated: the model cannot say "completed", so the run\'s word is carried', () => {
    const settled = applyRunResult(rows, 1, runs, run)!.items;
    const regenerated = [{ id: 'r1', run: 'Count the accounts, by segment' }, { id: 'r2', run: 'Interview five customers' }];
    const kept = carryUserFields(settled, regenerated, runs);
    expect(kept[0]).toMatchObject({ run: 'Count the accounts, by segment', status: 'completed', status_source: 'sandbox', sandbox_run_id: run.id });
    expect(kept[0].observed).toContain('rows: 240');
    expect(kept[1]).toMatchObject({ status: 'not_run', reason: 'We chose not to.', status_source: 'user' });
  });
});

describe('a run that could not be made settles its row as not run, with the reason (2 Oct, item 1)', () => {
  const blocked = { runId: run.id, reason: 'Account-level churn records were not provided.' };

  it('marks an untouched row Not run with the run\'s reason, so nobody types it again', () => {
    const result = applyRunBlocked(rows, 3, runs, blocked)!;
    expect(result.row).toMatchObject({
      id: 'r3', status: 'not_run', status_source: 'sandbox', sandbox_run_id: run.id,
      reason: 'Could not be run: Account-level churn records were not provided.',
    });
    expect(isTriaged(result.row, runs)).toBe(true);
    expect(result.items[0]).toBe(rows[0]);
  });

  it('replaces the draft\'s guess, but never the user\'s decision or a run that did execute', () => {
    expect(applyRunBlocked(rows, 1, runs, blocked)!.row.status_source).toBe('sandbox');
    expect(applyRunBlocked(rows, 2, runs, blocked)).toBeNull();
    const executed = applyRunResult(rows, 3, runs, run)!.items;
    expect(applyRunBlocked(executed, 3, runs, blocked)).toBeNull();
  });

  it('does nothing without a row, a reason, or a table that has a "not run"', () => {
    expect(applyRunBlocked(rows, undefined, runs, blocked)).toBeNull();
    expect(applyRunBlocked(rows, 9, runs, blocked)).toBeNull();
    expect(applyRunBlocked(rows, 3, runs, { runId: null, reason: '  ' })).toBeNull();
    expect(applyRunBlocked(rows, 3, ITEM_SCHEMAS.validation_table, blocked)).toBeNull();
  });

  it('survives the table being regenerated', () => {
    const before = applyRunBlocked(rows, 3, runs, blocked)!.items;
    const after = carryUserFields(before, [{ id: 'r3', run: 'Compare cohorts' }], runs);
    expect(after[0]).toMatchObject({ status: 'not_run', status_source: 'sandbox', reason: expect.stringContaining('were not provided') });
  });
});

describe('a reason the row already gives is not typed twice (2 Oct, item 1)', () => {
  it('offers the row\'s own deviation, then what happened', () => {
    expect(reasonFromRow({ id: 'a', run: 'x', deviation: ' No source data were provided. ', observed: 'Nothing ran.' }, runs)).toBe('No source data were provided.');
    expect(reasonFromRow({ id: 'a', run: 'x', observed: 'Nothing ran.' }, runs)).toBe('Nothing ran.');
    expect(reasonFromRow({ id: 'a', run: 'x' }, runs)).toBe('');
    // Since 3 Oct every check table offers its own words as the reason.
    expect(reasonFromRow({ id: 'a', notes: 'text' }, ITEM_SCHEMAS.validation_table)).toBe('text');
    expect(reasonFromRow({ id: 'a', attempt: 'Compared with earlier stages only.', notes: 'text' }, ITEM_SCHEMAS.validation_table)).toBe('Compared with earlier stages only.');
    expect(reasonFromRow({ id: 'a', item: 'x' }, ITEM_SCHEMAS.critique_report)).toBe('');
  });
});

describe('what a run printed goes on record without a model (1 Oct, item 32)', () => {
  it('reads labelled results, and nothing else', () => {
    const out = [
      'rows: 240',
      'mid_market_churn_rate = 8.8%',
      'Mean tenure (months): 14.2',
      'Loading the file…',
      '2 + 2 = 4',
      'Traceback (most recent call last):',
      '  File "main.py", line 3, in <module>',
      "{'a': 1}",
      'note: no dates in the file',
      'rows: 240',
    ].join('\n');
    expect(figuresFromOutput(out, run.id)).toEqual([
      { name: 'rows', value: '240', context: 'Printed by sandbox run 0a1b2c3d', source: 'sandbox' },
      { name: 'mid_market_churn_rate', value: '8.8%', context: 'Printed by sandbox run 0a1b2c3d', source: 'sandbox' },
      { name: 'Mean tenure (months)', value: '14.2', context: 'Printed by sandbox run 0a1b2c3d', source: 'sandbox' },
    ]);
    expect(figuresFromOutput(Array.from({ length: 40 }, (_, i) => `m${i}x: ${i}`).join('\n'), run.id)).toHaveLength(12);
  });

  it('adds them to the stage\'s record, keeping earlier runs and dropping figures about an older version\'s text', () => {
    const printed = figuresFromOutput('rows: 240', run.id);
    expect(withRunFigures(null, 'v2', [])).toBeNull();
    expect(withRunFigures(null, 'v2', printed)).toEqual({ version_id: 'v2', figures: printed });
    const stored = {
      version_id: 'v1',
      figures: [
        { name: 'Churn', value: '9%', context: 'from the text' },
        { name: 'accounts', value: '114', context: 'Printed by sandbox run ffff0000', source: 'sandbox' as const },
      ],
    };
    expect(withRunFigures(stored, 'v2', printed)!.figures.map((f) => f.name)).toEqual(['accounts', 'rows']);
    expect(withRunFigures(stored, 'v1', printed)!.figures.map((f) => f.name)).toEqual(['Churn', 'accounts', 'rows']);
    expect(mergeFigures(printed, printed)).toHaveLength(1);
  });
});
