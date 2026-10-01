import { describe, expect, it } from 'vitest';

import { carryUserFields } from './apply-findings';
import { figuresFromOutput, mergeFigures, withRunFigures } from './figures';
import { applyRunResult, runObservation } from './run-result';
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
