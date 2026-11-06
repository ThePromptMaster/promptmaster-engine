import { describe, expect, it } from 'vitest';

import { documentsCut, materialFrom, setupMaterial, withinMessage, type PreparedFile } from './attachments';

/**
 * 5 Nov (a book attached to a conversation): "Could not set the project up: `material` is
 * longer than the 200,000-character limit." The conversation had worked; making it a
 * project joined the document and the conversation with no limit.
 */
const doc = (name: string, words: number) => ({ file: new File([''], name), preview: { kind: 'document' }, text: 'word '.repeat(words) }) as unknown as PreparedFile;
const data = (name: string) => ({ file: new File([''], name), preview: { kind: 'table', columns: ['a'], rows: 1, sample: [] } }) as unknown as PreparedFile;
const LIMIT = 200_000;

describe('the material sent to set a project up', () => {
  it('stays within the limit, whatever is joined', () => {
    const attached = materialFrom([doc('book.docx', 60_000)], LIMIT);
    expect(attached.length).toBeLessThanOrEqual(LIMIT);
    const sent = setupMaterial('The conversation:\nMe: market my book', attached, LIMIT);
    expect(sent.length).toBeLessThanOrEqual(LIMIT);
    expect(sent).toContain('the rest of the material was not sent');
  });

  it('opens on what was said, because setup reads only the opening', () => {
    const sent = setupMaterial('The conversation:\nMe: market my book', materialFrom([doc('book.docx', 60_000)], LIMIT), LIMIT);
    expect(sent.startsWith('The conversation:')).toBe(true);
  });

  it('is untouched when it fits, with no empty parts', () => {
    expect(setupMaterial('Said.', 'Attached.', LIMIT)).toBe('Said.\n\nAttached.');
    expect(setupMaterial('', 'Attached.', LIMIT)).toBe('Attached.');
    expect(setupMaterial('Said.', '', LIMIT)).toBe('Said.');
  });

  it('a long document leaves room for the data files beside it', () => {
    const sent = materialFrom([doc('book.docx', 60_000), data('sales.csv')], LIMIT);
    expect(sent.length).toBeLessThanOrEqual(LIMIT);
    expect(sent).toContain('Data files attached:');
    expect(sent).toContain('sales.csv');
  });
});

describe('a document too long for a project', () => {
  it('is named, so the cut is said', () => {
    expect(documentsCut([doc('book.docx', 60_000), doc('note.docx', 10)], LIMIT)).toContain('book.docx');
    expect(documentsCut([doc('note.docx', 10)], LIMIT)).toEqual([]);
  });
});

describe('what one side-chat message can carry (5 Nov: eleven phone screenshots)', () => {
  const image = (name: string, size: number) => ({ name, image: `data:image/jpeg;base64,${'A'.repeat(size)}` });

  it('carries what fits, in order, and names the rest as not read', () => {
    const out = withinMessage([image('1.png', 1_000), image('2.png', 1_000), image('3.png', 1_000)], 2_200);
    expect(out[0].image).toBeTruthy();
    expect(out[1].image).toBeTruthy();
    expect(out[2]).toEqual({ name: '3.png', not_read: true });
  });

  it('a long document is cut, and says so', () => {
    const [doc] = withinMessage([{ name: 'book.docx', text: 'word '.repeat(20_000) }]);
    expect(doc.text!.length).toBeLessThan(61_000);
    expect(doc.text).toContain('the rest of this document was not sent');
  });

  it('a file with nothing to read is still named', () => {
    expect(withinMessage([{ name: 'sales.csv' }])).toEqual([{ name: 'sales.csv' }]);
  });
});
