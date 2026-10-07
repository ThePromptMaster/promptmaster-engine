import { describe, expect, it } from 'vitest';
import { storageSafeName } from './project-files';

describe('storageSafeName', () => {
  it('keeps a plain name as it is', () => {
    expect(storageSafeName('brief.pdf')).toBe('brief.pdf');
    expect(storageSafeName('Q3_figures-v2.xlsx')).toBe('Q3_figures-v2.xlsx');
  });

  it('turns accents, curly quotes and dashes into a key Storage accepts (6 Oct, email 9)', () => {
    const key = storageSafeName('Résumé – “final”.pdf');
    expect(key).toBe('Resume-final.pdf');
    expect(key).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it('never returns an empty stem', () => {
    expect(storageSafeName('“”.docx')).toBe('file.docx');
    expect(storageSafeName('日本語')).toBe('file');
  });

  it('keeps the extension lower-case and bounded', () => {
    expect(storageSafeName('Report.PDF')).toBe('Report.pdf');
    expect(storageSafeName(`${'a'.repeat(300)}.csv`)).toHaveLength(84);
  });
});
