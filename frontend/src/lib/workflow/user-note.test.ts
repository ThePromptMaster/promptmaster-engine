/**
 * 4 Nov (Sean, Lakeside proposal): the same fixtures as the backend's splitter
 * (`backend/tests/test_user_note.py`) — the endings Go saved on production,
 * and text a document may end with that is not a note.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { forReader } from './reader-text';
import { splitUserNote, userNoteLine } from './user-note';

const { cases } = JSON.parse(
  readFileSync(join(process.cwd(), '..', 'backend', 'tests', 'fixtures', 'user_notes.json'), 'utf8')
) as { cases: { name: string; text: string; document: string; note: boolean }[] };

describe('splitUserNote', () => {
  it('reads the shared fixtures', () => {
    expect(cases.length).toBeGreaterThan(20);
  });

  it.each(cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const { body, note } = splitUserNote(c.text);
    expect(body).toBe(c.document);
    expect(Boolean(note)).toBe(c.note);
  });

  it('keeps what the note said, for the user', () => {
    const v13 = cases.find((c) => c.name.startsWith('Lakeside final proposal v13'))!;
    const { note } = splitUserNote(v13.text);
    expect(note).toContain('Approving the document does not authorise sending it');
    expect(userNoteLine(note)).toMatch(/^Kept out of the document, for you: Notes for you, outside the proposal: - The closing note block/);
  });

  it('says nothing when there is no note', () => {
    expect(userNoteLine('')).toBe('');
    expect(userNoteLine(undefined)).toBe('');
  });
});

describe('forReader', () => {
  it('drops a note to the user from a version saved before 4 Nov', () => {
    const v12 = cases.find((c) => c.name.startsWith('Lakeside final proposal v12'))!;
    expect(forReader(v12.text)).toBe(v12.document);
  });
});
