import { describe, expect, it } from 'vitest';

import { blankContact, contactCounts, initialStatus, type ContactRow } from './contacts';
import { outreachText } from './digest-text';
import { blankMessage, changedBySync, draftText, firstName, parseMessage, serializeMessage, syncDrafts, type OutreachMessage } from './drafts';
import { heldBy } from '@/components/outreach/drafts-part';

const contact = (id: string, over: Partial<ContactRow> = {}): ContactRow => ({ ...blankContact(id), company: 'Acme', name: 'Jane Smith', email: 'jane@acme.com', email_kind: 'named', status: 'ready', personal_line: 'Your new Leeds depot opened this month.', ...over });
const message: OutreachMessage = {
  ...blankMessage(),
  subject: 'A quick look for {{company}}',
  body: 'Hi {{first_name}},\n\n{{personal_line}}\n\nWe built {{offer}}. See {{link}}.',
  variables: { offer: 'a beta for operations teams', link: 'https://promptmasterv1.com' },
};
let n = 0;
const makeId = () => `d${++n}`;

// Sean, 26 Nov: "Save the standard message and let me edit individual drafts. If I change the offer
// or link for a batch, show me which drafts would change and preserve any edits I made by hand."
describe('emails made from the message', () => {
  it('fills each contact in, and keeps the batch values as tokens until shown', () => {
    const [d] = syncDrafts([contact('c1')], message, [], makeId);
    expect(d.subject).toBe('A quick look for Acme');
    expect(d.body).toContain('Hi Jane,\n\nYour new Leeds depot opened this month.');
    expect(d.body).toContain('{{link}}');
    expect(draftText(d, message).body).toContain('See https://promptmasterv1.com.');
  });

  it('a change to the link reaches every email, and its own link overrides it', () => {
    const drafts = syncDrafts([contact('c1'), contact('c2', { email: 'sam@b.co', name: 'Sam' })], message, [], makeId);
    const moved = { ...message, variables: { ...message.variables, link: 'https://promptmasterv1.com/demo' } };
    expect(draftText(drafts[0], moved).body).toContain('/demo');
    const own = { ...drafts[1], overrides: JSON.stringify({ link: 'https://other.example/x' }) };
    expect(draftText(own, moved).body).toContain('https://other.example/x');
  });

  it('keeps what the user wrote by hand when the message changes', () => {
    const [d] = syncDrafts([contact('c1')], message, [], makeId);
    const mine = { ...d, body: 'My own words for Jane.', edited: 'body' };
    const reworded = { ...message, subject: 'New subject for {{company}}', body: 'Hello {{first_name}}. {{link}}' };
    const [after] = syncDrafts([contact('c1')], reworded, [mine], makeId);
    expect(after.body).toBe('My own words for Jane.');
    expect(after.subject).toBe('New subject for Acme');
    expect(changedBySync([mine], [after])).toEqual([mine.id]);
  });

  it('drops an untouched email whose contact is no longer ready, and sets aside one the user touched', () => {
    const [a, b] = syncDrafts([contact('c1'), contact('c2', { email: 'sam@b.co' })], message, [], makeId);
    const touched = { ...b, edited: 'subject' };
    const after = syncDrafts([contact('c1', { status: 'skip' }), contact('c2', { status: 'decide' })], message, [a, touched], makeId);
    expect(after.map((d) => d.id)).toEqual([touched.id]);
    expect(after[0]).toMatchObject({ status: 'set_aside', reason: 'The contact is no longer ready to write to.' });
  });

  it('holds an email with something still to fill in', () => {
    const [d] = syncDrafts([contact('c1', { personal_line: '' })], message, [], makeId);
    expect(heldBy(d, message)).toEqual(['{{personal_line}}']);
    expect(heldBy(d, { ...message, variables: { offer: '', link: '' } })).toEqual(['{{personal_line}}', '{{offer}}', '{{link}}']);
  });

  it('greets by first name, past a title', () => {
    expect(firstName('Dr. Jane Smith')).toBe('Jane');
    expect(firstName('Sam')).toBe('Sam');
  });

  it('round-trips the message', () => {
    expect(parseMessage(serializeMessage(message))).toEqual(message);
    expect(parseMessage('{"kind":"other"}')).toBeNull();
  });
});

// "If an address or detail is uncertain, give me a row to resolve."
describe('where a contact stands once imported', () => {
  it('ready with a named address and a name; the user decides a general inbox or a nameless address', () => {
    expect(initialStatus(contact('a', { status: '' })).status).toBe('ready');
    expect(initialStatus(contact('b', { status: '', email: 'info@acme.com', email_kind: 'general' }))).toMatchObject({ status: 'decide', reason: expect.stringContaining('general inbox') });
    expect(initialStatus(contact('c', { status: '', name: '' })).status).toBe('decide');
    expect(initialStatus(contact('d', { status: '', email: '' }))).toMatchObject({ status: '', reason: 'No address yet.' });
    expect(initialStatus(contact('e', { status: 'skip', reason: 'Same person as an earlier row.' })).status).toBe('skip');
  });

  it('counts the rows by where they stand', () => {
    expect(contactCounts([contact('a'), contact('b', { status: 'decide' }), contact('c', { status: '' }), contact('d', { status: 'skip' })])).toEqual({ ready: 1, decide: 1, skip: 1, open: 1, total: 4 });
  });
});

describe('an outreach stage as later stages read it', () => {
  it('a contact per line, never the raw data', () => {
    const text = outreachText('contacts', JSON.stringify({ kind: 'stage_items', items: [contact('c1', { given: '{"secret":"x"}' })], imports: [] }));
    expect(text).toBe('1. Acme — Jane Smith | jane@acme.com (named) [ready]');
  });

  it('the message as written, with its values', () => {
    const text = outreachText('message', serializeMessage(message));
    expect(text).toContain('Subject: A quick look for {{company}}');
    expect(text).toContain('Link (every email): https://promptmasterv1.com');
  });
});
