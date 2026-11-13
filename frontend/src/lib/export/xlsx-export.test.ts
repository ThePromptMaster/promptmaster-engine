// @vitest-environment node
import readExcelFile from 'read-excel-file/node';
import { describe, expect, it } from 'vitest';

import { cellValue, sheetFrom, sheetNames, workbookFrom, workbookToXlsx } from './xlsx-export';

const doc = [
  '## Shortlist',
  '',
  '| Candidate | Fee | Share | Code | Note |',
  '|---|---|---|---|---|',
  '| Avery | 1200 | 12% | 007 | =SUM(A1:A2) |',
  '| Morgan | -3.5 | 1,200 | 12 | +44 20 7946 0000 |',
  '',
  '## Shortlist',
  '',
  '| A |',
  '|---|',
  '| @handle |',
].join('\n');

describe('a cell is a number only when the whole of it is one', () => {
  it('keeps what is written', () => {
    expect(cellValue('1200')).toBe(1200);
    expect(cellValue(' -3.5 ')).toBe(-3.5);
    expect(cellValue('0')).toBe(0);
    for (const text of ['1,200', '12%', '007', '$40', '1e5', '12345678901234567890', '=SUM(A1:A2)', '+44', '-', '@x', '']) {
      expect(cellValue(text)).toBe(text);
    }
  });
});

describe('sheet names Excel accepts', () => {
  it('drops what a name cannot hold, keeps to 31 characters, and never repeats one', () => {
    expect(sheetNames(['Q1/Q2: plan [draft]?', '', 'Shortlist', 'shortlist', 'x'.repeat(40)])).toEqual([
      'Q1 Q2 plan draft',
      'Table 2',
      'Shortlist',
      'shortlist (2)',
      'x'.repeat(31),
    ]);
    expect(sheetNames(['a'.repeat(31), 'a'.repeat(31)])[1]).toBe(`${'a'.repeat(27)} (2)`);
  });
});

describe('the work as a workbook', () => {
  it('makes one sheet a table, named after its heading', () => {
    const sheets = workbookFrom(doc);
    expect(sheets.map((s) => s.name)).toEqual(['Shortlist', 'Shortlist (2)']);
    expect(sheets[0].rows[1]).toEqual(['Avery', 1200, '12%', '007', '=SUM(A1:A2)']);
    expect(workbookFrom('No table.')).toEqual([]);
  });

  it('writes a file a spreadsheet reader opens, with nothing turned into a formula', async () => {
    const blob = await workbookToXlsx(workbookFrom(doc));
    const read = (await readExcelFile(Buffer.from(await blob.arrayBuffer()))) as unknown as { sheet: string; data: unknown[][] }[];
    expect(read.map((s) => s.sheet)).toEqual(['Shortlist', 'Shortlist (2)']);
    expect(read[0].data).toEqual([
      ['Candidate', 'Fee', 'Share', 'Code', 'Note'],
      ['Avery', 1200, '12%', '007', '=SUM(A1:A2)'],
      ['Morgan', -3.5, '1,200', 12, '+44 20 7946 0000'],
    ]);
    expect(read[1].data).toEqual([['A'], ['@handle']]);
  });

  it('writes one table given as rows, for the assessment table', async () => {
    const blob = await workbookToXlsx(sheetFrom('Assess: candidates', [['Subject', 'Verdict'], ['Avery', 'Green'], ['=cmd', '3']]));
    const [sheet] = (await readExcelFile(Buffer.from(await blob.arrayBuffer()))) as unknown as { sheet: string; data: unknown[][] }[];
    expect(sheet.sheet).toBe('Assess candidates');
    expect(sheet.data).toEqual([['Subject', 'Verdict'], ['Avery', 'Green'], ['=cmd', 3]]);
  });
});
