import { describe, expect, it, vi } from 'vitest';

import { blankContact, parseContacts, serializeContacts, type ContactRow } from './contacts';
import { mergeResearch, needsResearch, type ResearchedRow } from './research';
import { researchLeft, runResearch } from './research-run';

const row = (id: string, patch: Partial<ContactRow> = {}): ContactRow => ({ ...blankContact(id), company: 'Harbourline Supply', domain: 'harbourline.example', ...patch });
const found = (id: string, patch: Partial<ResearchedRow> = {}): ResearchedRow => ({
  id, name: '', role: '', email: '', email_status: '', detail: '', personal_line: '', src_name: '', src_role: '', src_email: '', src_detail: '', candidates: [], guessed_from: '', reason: '', ...patch,
});

// Sean, 26 Nov: fill in what the list is missing, each value with its source; say why when nothing was found.
describe('filling in the blanks', () => {
  it('fills blanks with their sources and marks the row ready when a page shows a named address', () => {
    const next = mergeResearch(row('c1'), found('c1', { name: 'Morgan Reyes', src_name: '[S2]', role: 'Head of Operations', src_role: '[S2]', email: 'morgan@harbourline.example', email_status: 'verified', src_email: '[S2]', detail: 'Opened a Leeds hub', src_detail: '[S3]', personal_line: 'Your Leeds hub caught my eye.' }), 'T');
    expect(next).toMatchObject({ name: 'Morgan Reyes', src_name: 'S2', email_status: 'verified', email_kind: 'named', src_email: 'S2', src_detail: 'S3', personal_line: 'Your Leeds hub caught my eye.', status: 'ready', researched: 'T' });
    expect(next.added.split(',')).toEqual(['name', 'role', 'email', 'detail', 'personal_line']);
  });

  it('never replaces what the list had', () => {
    const next = mergeResearch(row('c1', { name: 'Morgan', email: 'm@harbourline.example', email_kind: 'named', status: 'ready' }), found('c1', { name: 'Someone', email: 'x@harbourline.example', email_status: 'verified' }), 'T');
    expect([next.name, next.email, next.status]).toEqual(['Morgan', 'm@harbourline.example', 'ready']);
  });

  it('a guessed address, two possible people, or nothing found are rows to resolve, each saying why', () => {
    expect(mergeResearch(row('c1', { name: 'Morgan Reyes' }), found('c1', { email: 'morgan.reyes@harbourline.example', email_status: 'guess', src_email: '[S4]', guessed_from: 'jane.doe@harbourline.example [S4]' }), 'T')).toMatchObject({ status: 'decide', email_status: 'guess', reason: 'Guessed from jane.doe@harbourline.example [S4]; no page shows this address. Use it, or find another.' });
    const two = mergeResearch(row('c1'), found('c1', { candidates: [{ name: 'A', role: 'COO', email: '', why: 'Runs ops', source: '[S1]' }, { name: 'B', role: 'VP', email: '', why: 'Leads supply', source: '[S1]' }] }), 'T');
    expect(two).toMatchObject({ status: 'decide', reason: 'Two people could be right: choose one.' });
    expect(JSON.parse(two.candidates)[0].source).toBe('S1');
    expect(mergeResearch(row('c1', { name: 'Morgan' }), found('c1', { email_status: 'none', reason: 'The site lists only a contact form.' }), 'T')).toMatchObject({ status: 'decide', reason: 'The site lists only a contact form.', email_status: 'none' });
  });

  it('keeps a decision that is not research\'s own', () => {
    const before = row('c1', { name: 'Morgan', email: 'm@harbourline.example', status: 'decide', reason: 'Contacted before: 2026-03-22.' });
    expect(mergeResearch(before, found('c1', { detail: 'Opened a Leeds hub', src_detail: '[S1]', personal_line: 'Nice hub.' }), 'T')).toMatchObject({ status: 'decide', reason: 'Contacted before: 2026-03-22.', personal_line: 'Nice hub.' });
  });

  it('searches a row once, and never a skipped row or a repeat', () => {
    expect(needsResearch(row('c1'))).toBe(true);
    expect(needsResearch(row('c1', { researched: 'T' }))).toBe(false);
    expect(needsResearch(row('c1', { status: 'skip' }))).toBe(false);
    expect(needsResearch(row('c1', { duplicate_of: 'c0' }))).toBe(false);
    expect(needsResearch(row('c1', { name: 'A', email: 'a@x.example', personal_line: 'Hi.' }))).toBe(false);
  });

  it('runs five a call, saves after each, and a stop keeps what was saved', async () => {
    const content = serializeContacts({ kind: 'stage_items', imports: [], items: Array.from({ length: 7 }, (_, i) => row(`c${i}`)) });
    expect(researchLeft(content)).toBe(7);
    const saves: string[] = [];
    const controller = new AbortController();
    const call = vi.fn(async (rows: { id: string }[]) => ({ rows: rows.map((r) => found(r.id, { name: `Person ${r.id}`, src_name: '[S1]' })), web_query: 'q' }));
    const result = await runResearch({
      content,
      call,
      keep: async () => null,
      save: async (c) => {
        saves.push(c);
        controller.abort();
      },
      signal: controller.signal,
      now: () => 'T',
    });
    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0][0]).toHaveLength(5);
    expect(result).toEqual({ researched: 5, filled: 5, left: 2, stopped: true });
    expect(researchLeft(saves[0])).toBe(2);
    expect(parseContacts(saves[0]).items[0].name).toBe('Person c0');
  });

  it('an error stops the run and says so; what was saved stays', async () => {
    const content = serializeContacts({ kind: 'stage_items', imports: [], items: [row('c1')] });
    const result = await runResearch({ content, call: async () => { throw new Error('Filling in the blanks searches the web: turn on Web access for this project first.'); }, keep: async () => null, save: async () => undefined });
    expect(result).toMatchObject({ researched: 0, left: 1, error: expect.stringContaining('Web access') });
  });
});
