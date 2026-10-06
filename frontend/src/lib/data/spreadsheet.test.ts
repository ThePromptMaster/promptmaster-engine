import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import readExcelFile from 'read-excel-file/node';
import { describe, expect, it } from 'vitest';

import { previewOf, rejectReason } from './preview';
import { csvNamesFor, sheetToCsv, sheetsToCsv, type Cell } from './spreadsheet';

describe('a spreadsheet becomes CSV (1 Oct, item 17)', () => {
  it('quotes what needs quoting, writes dates as dates, and squares the rows off', () => {
    const csv = sheetToCsv([
      ['name', 'joined', 'note'],
      ['Acme, Inc.', new Date('2026-03-01T00:00:00Z'), 'said "maybe"'],
      ['Bolt', null],
      [null, null, null],
    ]);
    expect(csv).toBe('name,joined,note\n"Acme, Inc.",2026-03-01,"said ""maybe"""\nBolt,,\n');
    expect(sheetToCsv([])).toBe('');
  });

  it('names one sheet after the workbook, and several after their sheets', () => {
    expect(csvNamesFor('accounts.xlsx', ['Sheet1'])).toEqual(['accounts.csv']);
    expect(csvNamesFor('accounts.xlsx', ['Q1', 'Q2/Q3', 'Q1'])).toEqual(['accounts - Q1.csv', 'accounts - Q2 Q3.csv', 'accounts - Q1 (2).csv']);
  });

  it('reads a real workbook: one CSV per sheet that holds anything, previewed like any CSV', async () => {
    const sheets = (await readExcelFile(readFileSync(join(__dirname, '../../../e2e/fixtures/churn-workbook.xlsx')))) as unknown as { sheet: string; data: Cell[][] }[];
    expect(sheets.map((s) => s.sheet)).toEqual(['Accounts', 'Notes', 'Empty']);
    const files = sheetsToCsv('churn-workbook.xlsx', sheets);
    // The empty sheet is not attached.
    expect(files.map((f) => f.name)).toEqual(['churn-workbook - Accounts.csv', 'churn-workbook - Notes.csv']);
    const preview = previewOf(files[0].name, files[0].csv);
    expect(preview).toMatchObject({ kind: 'table', columns: ['account_id', 'segment', 'seats', 'churned'], rows: 12 });
    expect(preview.sample[0]).toEqual(['A001', 'Mid-Market', '11', 'no']);
    expect(previewOf(files[1].name, files[1].csv).sample[0]).toEqual(['Renewal, "priority" accounts', 'CS']);
  });

  it('the old .xls format is refused with what to do about it', () => {
    expect(rejectReason('old.xls', 10, [])).toMatch(/old Excel format/);
    expect(rejectReason('notes.docx', 10, [])).toBeNull();
  });
});
