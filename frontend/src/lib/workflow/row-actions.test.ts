import { describe, expect, it } from 'vitest';

import { ITEM_SCHEMAS } from './stage-artifact';
import { previewRowAction } from './row-actions';
import type { ReplyAction } from '@/types';

const runs = ITEM_SCHEMAS.runs;
const rows = [
  { id: 'r1', run: 'Cohort extract', observed: '', deviation: '' },
  { id: 'r2', run: 'Survival model', observed: '', deviation: '', status: 'not_run', reason: 'No data.', status_source: 'model' },
];

describe('previewRowAction: a chat action as row changes (1 Oct, item 15)', () => {
  it('sets a status with its reason, says what changes, and marks it the user\'s', () => {
    const action: ReplyAction = {
      label: 'Mark the extract not run', kind: 'row_updates',
      updates: [{ id: 'r1', status: 'not_run', reason: 'The CRM extract was never provided.', fields: { observed: 'Nothing was run.' } }],
    };
    const { items, changes } = previewRowAction(rows, action, runs);
    expect(items[0]).toMatchObject({ status: 'not_run', reason: 'The CRM extract was never provided.', status_source: 'user', observed: 'Nothing was run.' });
    expect(items[1]).toBe(rows[1]);
    expect(changes).toEqual([{
      id: 'r1', title: 'Cohort extract', added: false,
      lines: ['What actually happened: (empty) → Nothing was run.', 'Status: Not looked at → Not run', 'Why: The CRM extract was never provided.'],
    }]);
  });

  it('leaves out what the table cannot hold', () => {
    const action: ReplyAction = {
      label: 'x', kind: 'row_updates',
      updates: [
        { id: 'ghost', status: 'completed' },
        { id: 'r1', status: 'not_run' },                       // needs a reason
        { id: 'r2', status: 'invented', fields: { made_up: 'x' } },
      ],
    };
    const { items, changes } = previewRowAction(rows, action, runs);
    expect(changes).toEqual([]);
    expect(items).toEqual(rows);
  });

  it('adds rows, and a table whose generated rows start in a state starts them there', () => {
    const lit = ITEM_SCHEMAS.literature_map;
    const action: ReplyAction = { label: 'Add the cohort study', kind: 'add_rows', rows: [{ work: 'Ascarza 2018', finding: 'Targeting can backfire', link: 'doi:made-up' }, { nope: 'x' }] };
    const { items, changes } = previewRowAction([], action, lit);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ work: 'Ascarza 2018', status: 'candidate', status_source: 'model' });
    expect(changes[0]).toMatchObject({ added: true, title: 'Ascarza 2018' });
  });
});
