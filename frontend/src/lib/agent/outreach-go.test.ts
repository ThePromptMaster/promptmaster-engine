import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { initialState } from '@/lib/workflow/engine';
import { EMAIL_OUTREACH_V1 } from '@/lib/workflow/templates/email-outreach.v1';
import type { StageEvaluation } from '@/lib/workflow/types';
import { blankContact, serializeContacts } from '@/lib/outreach/contacts';
import { blankMessage, serializeMessage } from '@/lib/outreach/drafts';
import { outreachFacts, withWrittenMessage } from '@/lib/outreach/go-work';
import { describeNeed, needStillHolds, needsUser, requiredWork, staleRepair, unrepairableStale } from './needs';
import { allowedActions } from './policy';

const template = EMAIL_OUTREACH_V1;
const stage = (part: string) => template.stages.find((s) => s.outreach?.part === part)!;
const bundle = (content: string) => ({ versions: [{ content }] });
const contactsWith = (rows: Partial<ReturnType<typeof blankContact>>[]) =>
  serializeContacts({ kind: 'stage_items', imports: [], items: rows.map((r, i) => ({ ...blankContact(`c${i}`), company: 'Acme', domain: 'acme.example', ...r })) });
const evaluation = { canAdvance: false, unmet: [], criteria: [] } as unknown as StageEvaluation;

// Sean, 26 Nov: PromptMaster researches and drafts; the user approves and sends.
describe('Go on an outreach round', () => {
  it('asks for the list in words that name the box, before any planner call (26 Nov: it named the Data panel)', () => {
    const contacts = stage('contacts');
    const facts = { outreach: outreachFacts({ template, stage: contacts, bundles: {}, webOn: true, running: false }) };
    const need = needsUser({ state: initialState(template), stage: contacts, stageEvaluation: evaluation, allowed: [], policy: 'autonomous', outlineStageId: null, facts });
    expect(need).toEqual({ kind: 'import_contacts', stageId: contacts.id });
    const said = describeNeed(need!, () => 'Contacts');
    expect(said.message).toContain('Paste it, or choose a CSV or Excel file');
    expect(said.message).not.toMatch(/Data panel/i);
    expect(said.action).toBe('Go to the list');
    const held = (f: object) => needStillHolds(need!, { state: initialState(template), stage: contacts, stageEvaluation: evaluation, allowed: [], policy: 'autonomous', outlineStageId: null, facts: f, objective: 'x', currentStageId: contacts.id });
    expect(held(facts)).toBe(true);
    expect(held({ outreach: { part: 'contacts', empty: false } })).toBe(false);
  });

  it('fills in the blanks while rows miss something and the web is on; never with it off', () => {
    const contacts = stage('contacts');
    const bundles = { [contacts.id]: bundle(contactsWith([{}, { name: 'Ann', email: 'ann@acme.example', personal_line: 'Hi.' }])) };
    const on = { outreach: outreachFacts({ template, stage: contacts, bundles, webOn: true, running: false }) };
    expect(on.outreach).toMatchObject({ part: 'contacts', empty: false, researchLeft: 1 });
    expect(allowedActions(template, initialState(template), contacts, false, undefined, on)).toContain('research_contacts');
    expect(requiredWork({ stage: contacts, facts: on, stageEvaluation: evaluation, allowed: ['research_contacts'] })?.key).toBe('research_contacts');
    const off = { outreach: outreachFacts({ template, stage: contacts, bundles, webOn: false, running: false }) };
    expect(allowedActions(template, initialState(template), contacts, false, undefined, off)).not.toContain('research_contacts');
  });

  it('writes the message when there is none, then makes the emails to match it', () => {
    const contacts = stage('contacts');
    const message = stage('message');
    const drafts = stage('drafts');
    const ready = contactsWith([{ name: 'Ann Lee', email: 'ann@acme.example', status: 'ready', personal_line: 'Nice hub.' }]);
    const empty = { [contacts.id]: bundle(ready) };
    const onMessage = { outreach: outreachFacts({ template, stage: message, bundles: empty, webOn: true, running: false }) };
    expect(onMessage.outreach).toEqual({ part: 'message', messageEmpty: true });
    expect(allowedActions(template, initialState(template), message, false, undefined, onMessage)).toContain('draft_outreach');

    const written = serializeMessage({ ...blankMessage(), subject: 'Hello', body: 'Hi {{first_name}}. {{personal_line}}' });
    const withMessage = { ...empty, [message.id]: bundle(written) };
    const onDrafts = { outreach: outreachFacts({ template, stage: drafts, bundles: withMessage, webOn: true, running: false }) };
    expect(onDrafts.outreach).toEqual({ part: 'drafts', draftsBehind: 1 });
    expect(requiredWork({ stage: drafts, facts: onDrafts, stageEvaluation: evaluation, allowed: ['draft_outreach'] })?.key).toBe('draft_outreach');
    // Nothing behind: nothing to do.
    expect(allowedActions(template, initialState(template), drafts, false, undefined, { outreach: { part: 'drafts', draftsBehind: 0 } })).not.toContain('draft_outreach');
  });

  it('a written message keeps the batch values and sender already chosen', () => {
    const before = { ...blankMessage(), variables: { offer: 'the beta', link: 'https://promptmasterv1.com' }, sender_id: 's1' };
    const next = withWrittenMessage(before, { subject: 'Hi', body: 'B', followup_body: 'F', offer: '', link: '' }, { sender_id: 's2', signature_id: 'g', reply_signature_id: null });
    expect(next).toMatchObject({ subject: 'Hi', variables: { offer: 'the beta', link: 'https://promptmasterv1.com' }, sender_id: 's1', signature_id: 'g', followup: { body: 'F', after_business_days: 3 } });
  });
});

// 27 Nov pass: a change to Contacts reopened Message and Drafts, and Go stopped with "a repair failed".
describe('a reopened outreach stage', () => {
  it('is Go\'s to settle, not a stop', () => {
    const state = initialState(template);
    const message = stage('message');
    const drafts = stage('drafts');
    const reopened = {
      ...state,
      current_stage_id: drafts.id,
      stages: {
        ...state.stages,
        [stage('contacts').id]: { ...state.stages[stage('contacts').id], status: 'complete' as const },
        [message.id]: { ...state.stages[message.id], status: 'stale' as const, stale: { reason: 'Contacts was changed.', since: '2026-11-27T00:00:00Z', was: 'complete' as const } },
        [drafts.id]: { ...state.stages[drafts.id], status: 'stale' as const, stale: { reason: 'Contacts was changed.', since: '2026-11-27T00:00:00Z', was: 'in_progress' as const } },
      },
    };
    expect(staleRepair(template, reopened)).toMatchObject({ key: 'recheck_stage', params: { stage_id: message.id } });
    expect(unrepairableStale(template, reopened)).toBeNull();
  });
});

// "Go never approves or sends": no file Go runs reaches the approval, ticket or sending code.
describe('Go never approves or sends', () => {
  const root = join(__dirname, '..', '..');
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });
  const goFiles = [...files(join(root, 'lib', 'agent')), join(root, 'components', 'workflow', 'use-go-loop.ts'), join(root, 'lib', 'outreach', 'go-work.ts'), join(root, 'lib', 'outreach', 'research-run.ts')];

  it.each(goFiles.map((f) => [f.slice(root.length + 1)]))('%s', (file) => {
    const text = readFileSync(join(root, file), 'utf8');
    expect(text).not.toMatch(/outreach-sends|use-sending|outreach-job|outreach-client|outreach-store|outreachTickets|outreachCheckTest|scheduleSends|createApprovals/);
  });
});

// 27 Nov pass: Go asked "What name … should appear as the signature under each email?"
describe('what Go reads of the message and the emails', () => {
  it('says the signature comes from Settings and approving and sending are the user\'s', async () => {
    const { outreachText } = await import('@/lib/outreach/digest-text');
    const withSender = outreachText('message', serializeMessage({ ...blankMessage(), subject: 'Hi', body: 'B', sender_id: 's1' }));
    expect(withSender).toContain('Sender and signature: from Settings.');
    expect(outreachText('message', serializeMessage({ ...blankMessage(), subject: 'Hi', body: 'B' }))).toContain('not chosen yet');
    expect(outreachText('drafts', '{"kind":"stage_items","items":[]}')).toContain("Approving and sending each email are the user's");
  });
});

describe('what Go is shown of the emails', () => {
  it('the emails as they would go out, the offer and link filled, and who signs and sends', async () => {
    const { outreachExcerpt } = await import('@/lib/outreach/go-work');
    const { serializeDrafts } = await import('@/lib/outreach/drafts');
    const message = { ...blankMessage(), subject: 'Hello {{company}}', body: 'Hi. Try {{offer}} at {{link}}.', variables: { offer: 'the beta', link: 'https://promptmasterv1.com' }, sender_id: 's1' };
    const drafts = serializeDrafts([{ id: 'd1', status: '', reason: '', contact_id: 'c1', to: 'ann@acme.example', cc: '', bcc: '', subject: 'Hello Acme', body: 'Hi. Try {{offer}} at {{link}}.', edited: '', overrides: '' }]);
    const bundles = { [stage('message').id]: bundle(serializeMessage(message)), [stage('drafts').id]: bundle(drafts) };
    const text = outreachExcerpt(template, stage('drafts'), bundles);
    expect(text).toContain('Try the beta at https://promptmasterv1.com.');
    expect(text).not.toContain('{{');
    expect(text).toContain('Sender and signature: from Settings.');
  });

  it("each email says what the earlier-contact check found for its contact (27 Nov pass)", async () => {
    const { outreachExcerpt } = await import('@/lib/outreach/go-work');
    const { serializeDrafts } = await import('@/lib/outreach/drafts');
    const { blankContact, serializeContacts } = await import('@/lib/outreach/contacts');
    const message = { ...blankMessage(), subject: 'Hello', body: 'Hi.', sender_id: 's1' };
    const draft = (id: string, contact: string, to: string) => ({ id, status: '' as const, reason: '', contact_id: contact, to, cc: '', bcc: '', subject: 'Hello', body: 'Hi.', edited: '', overrides: '' });
    const contacts = serializeContacts({ kind: 'stage_items', imports: [], items: [
      { ...blankContact('c1'), email: 'jo@gmail.com', status: 'ready', contacted: JSON.stringify({ address: 'jo@gmail.com', on: '2026-11-27', source: 'promptmaster' }) },
      { ...blankContact('c2'), email: 'kim@acme.example', status: 'ready' },
    ] });
    const bundles = { [stage('contacts').id]: bundle(contacts), [stage('message').id]: bundle(serializeMessage(message)), [stage('drafts').id]: bundle(serializeDrafts([draft('d1', 'c1', 'jo@gmail.com'), draft('d2', 'c2', 'kim@acme.example')])) };
    const text = outreachExcerpt(template, stage('drafts'), bundles);
    expect(text).toContain('Earlier contact: contacted before on 2026-11-27 (sent from PromptMaster); the user chose to write again.');
    expect(text).toContain('Earlier contact: not contacted before.');
    expect(text).toContain('nothing more is needed from the user for it');
  });
});
