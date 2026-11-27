import { describe, expect, it } from 'vitest';

import { blankContact, type ContactRow } from './contacts';
import { decideGroup, groupDecisions } from './decisions';
import { blankMessage, type DraftRow, type OutreachMessage } from './drafts';
import { backForReview, findChanged } from './hold-changed';
import { replacedIn } from './holds';
import { mergeImport } from './import';
import { buildSnapshot } from './snapshot';
import { outreachCounts } from './summary';
import { previewChange, replaceInDrafts } from './variable-change';
import type { ProjectFact } from '@/types/project';
import type { OutreachSender } from '@/types/outreach';
import type { ApprovalRecord, SendRecord } from '@/lib/supabase/outreach-sends';

const fact = (over: Partial<ProjectFact>): ProjectFact => ({
  id: 'f1', project_id: 'p', user_id: 'u', statement: '', subject: null, kind: 'fact', source_kind: 'chat', source_ref: {}, accepted_by: 'user',
  agent_run_id: null, supersedes: null, retired_at: null, retired_reason: null, created_at: '2026-11-26T10:00:00Z', ...over,
}) as ProjectFact;
// A replaced fact is retired when its replacement is recorded (`project_facts` is append-only).
const moved = [fact({ id: 'f1', statement: 'Go-live is on 14 March 2027.', retired_at: '2026-11-27T10:00:00Z' }), fact({ id: 'f2', statement: 'Go-live moved to 21 March 2027.', supersedes: 'f1', created_at: '2026-11-27T10:00:00Z' })];

const row = (id: string, patch: Partial<ContactRow> = {}): ContactRow => ({ ...blankContact(id), company: 'Acme', domain: 'acme.example', ...patch });
const draft = (id: string, patch: Partial<DraftRow> = {}): DraftRow => ({ id, status: '', reason: '', contact_id: id, to: `${id}@acme.example`, cc: '', bcc: '', subject: 'Hello', body: 'Try {{offer}} at {{link}}.', edited: '', overrides: '', ...patch });
const message: OutreachMessage = { ...blankMessage(), subject: 'Hello', body: 'Try {{offer}} at {{link}}.', variables: { offer: 'the beta', link: 'https://promptmasterv1.com' }, sender_id: 's1' };
const sender: OutreachSender = { id: 's1', user_id: 'u', toolkit: 'gmail', from_name: '', from_address: 'me@pm.example', reply_to: null, postal_address: '1 Main St', opt_out_line: 'Reply stop.', commercial: true };

// Sean, 26 Nov: "If I change the offer or link for a batch, show me which drafts would change … send
// that message back for review … re-importing must not duplicate anyone".
describe('a replaced fact holds an email', () => {
  it('names what it still says and what replaced it', () => {
    expect(replacedIn('We go live on 14 March 2027, as planned.', moved)).toBe('It still states what "Go-live is on 14 March 2027" said, since replaced by "Go-live moved to 21 March 2027".');
    expect(replacedIn('We go live on 21 March 2027.', moved)).toBeNull();
    expect(replacedIn('Anything.', [])).toBeNull();
  });
});

describe('approved emails that changed go back for review', () => {
  const approvedFor = (d: DraftRow, m: OutreachMessage): ApprovalRecord => ({
    id: `a_${d.id}`, project_id: 'p', stage_id: 'drafts', draft_id: d.id, purpose: 'send', message_hash: '', approved_at: '', revoked_at: null, revoked_reason: null,
    snapshot: buildSnapshot({ draft: d, message: m, sender, signature: null, logo: null, purpose: 'send' }),
  });
  const d1 = draft('d1', { status: 'approved', approval_id: 'a_d1' });
  const d2 = draft('d2', { status: 'approved', approval_id: 'a_d2' });
  const sends = [{ id: 's_d1', approval_id: 'a_d1', status: 'scheduled' }, { id: 's_d2', approval_id: 'a_d2', status: 'confirmed' }] as unknown as SendRecord[];

  it('a new link reaches every approved email not yet sent; one already sent stays as it went', async () => {
    const approvals = [approvedFor(d1, message), approvedFor(d2, message)];
    const changed = await findChanged({ drafts: [d1, d2], message: { ...message, variables: { ...message.variables, link: 'https://promptmasterv1.com/beta' } }, identity: { sender, signature: null, logo: null }, approvals, sends });
    expect(changed).toEqual([{ draftId: 'd1', approvalId: 'a_d1', sendId: 's_d1', movable: true, reason: 'Changed since you approved it: the text, a link.' }]);
    expect(backForReview([d1, d2], changed).map((d) => [d.status, d.approval_id, d.reason])).toEqual([['', '', 'Changed since you approved it: the text, a link.'], ['approved', 'a_d2', '']]);
  });

  it('a fact replaced since approval sends it back too, though nothing else changed', async () => {
    const said = draft('d1', { status: 'approved', approval_id: 'a_d1', body: 'We go live on 14 March 2027.' });
    const changed = await findChanged({ drafts: [said], message, identity: { sender, signature: null, logo: null }, approvals: [approvedFor(said, message)], sends: [], facts: moved });
    expect(changed[0]).toMatchObject({ movable: false, reason: expect.stringContaining('since replaced by "Go-live moved to 21 March 2027"') });
  });

  // Sean's first test: "change the link on one queued email … the old-link message held for review".
  it('a new link on one queued email sends back that email only', async () => {
    const approvals = [approvedFor(d1, message), approvedFor(d2, message)];
    const one = { ...d1, overrides: JSON.stringify({ link: 'https://promptmasterv1.com/demo' }) };
    const changed = await findChanged({ drafts: [one, { ...d2 }], message, identity: { sender, signature: null, logo: null }, approvals, sends: [{ id: 's_d1', approval_id: 'a_d1', status: 'scheduled' }, { id: 's_d2', approval_id: 'a_d2', status: 'scheduled' }] as unknown as SendRecord[] });
    expect(changed.map((c) => [c.draftId, c.reason])).toEqual([['d1', 'Changed since you approved it: the text, a link.']]);
  });

  it('nothing goes back when nothing changed, or before who it goes out as is known', async () => {
    expect(await findChanged({ drafts: [d1], message, identity: { sender, signature: null, logo: null }, approvals: [approvedFor(d1, message)], sends })).toEqual([]);
    expect(await findChanged({ drafts: [d1], message: blankMessage(), identity: { sender: null, signature: null, logo: null }, approvals: [approvedFor(d1, message)], sends })).toEqual([]);
  });
});

describe('a change to the message, seen before it is saved', () => {
  it('counts the emails that follow, the approved ones among them, and the hand edits that keep the old wording', () => {
    const after = { ...message, variables: { ...message.variables, offer: 'a free trial' } };
    const typed = draft('d3', { body: 'Try the beta, made for you, at {{link}}.', edited: 'body' });
    const went = draft('d5', { status: 'approved', approval_id: 'a5' });
    const preview = previewChange(message, after, [draft('d1'), draft('d2', { status: 'approved', approval_id: 'a2' }), typed, draft('d4', { status: 'set_aside' }), went], new Set(['a5']));
    expect(preview).toEqual({ follow: 3, approved: 1, sent: 1, kept: ['d3'] });
    expect(replaceInDrafts([typed], preview.kept, message, after)[0].body).toBe('Try a free trial, made for you, at {{link}}.');
  });
});

describe('importing the list again', () => {
  it('adds no one twice, and asks when the new import says something different', () => {
    const existing = [row('c1', { name: 'Ann Lee', email: 'ann@acme.example', status: 'ready' }), row('c2', { name: 'Bo Ray', email: 'bo@acme.example', role: 'COO', status: 'skip', reason: 'Not now.' })];
    const incoming = [row('n1', { name: 'Ann Lee', email: 'ann@acme.example' }), row('n2', { name: 'Bo Ray', email: 'bo@acme.example', role: 'CEO' }), row('n3', { name: 'Cy Doe', email: 'cy@acme.example' })];
    const merged = mergeImport(existing, incoming);
    expect([merged.added, merged.repeated, merged.changed]).toEqual([1, 1, 1]);
    expect(merged.rows.map((r) => r.id)).toEqual(['c1', 'c2', 'n3']);
    expect(merged.rows[1]).toMatchObject({ status: 'decide', reason: 'The new import says role CEO.', kept_status: 'skip', kept_reason: 'Not now.' });
    const [group] = groupDecisions(merged.rows);
    expect(group).toMatchObject({ kind: 'import_change', rowIds: ['c2'] });
    // Keep what you had: the row as it was.
    expect(decideGroup(merged.rows, group, 'skip')[1]).toMatchObject({ role: 'COO', status: 'skip', reason: 'Not now.', incoming: '' });
    // Use the new values: taken from the import; a skipped row stays skipped.
    expect(decideGroup(merged.rows, group, 'use')[1]).toMatchObject({ role: 'CEO', src_role: 'import', status: 'skip' });
  });
});

describe('what needs you', () => {
  it('counts the list, the emails and the sent record', () => {
    const contacts = JSON.stringify({ kind: 'stage_items', imports: [], items: [row('c1', { status: 'decide' }), row('c2')] });
    const drafts = JSON.stringify({ kind: 'stage_items', items: [draft('d1'), draft('d2', { body: 'Hi {{first_name}}' }), draft('d3', { reason: 'Changed since you approved it: the text.' }), draft('d4', { status: 'approved' })] });
    const sends = [{ status: 'scheduled', purpose: 'send' }, { status: 'confirmed', purpose: 'send' }, { status: 'confirmed', purpose: 'test' }, { status: 'failed', purpose: 'send' }];
    expect(outreachCounts({ contacts, message: JSON.stringify(message), drafts, sends })).toEqual({ decide: 1, search: 2, approve: 1, held: 2, scheduled: 1, sent: 1, failed: 1, replied: 0, bounced: 0, optedOut: 0 });
  });
});
