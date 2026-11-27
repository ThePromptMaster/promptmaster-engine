import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { initialState } from '@/lib/workflow/engine';
import { EMAIL_OUTREACH_V1 } from '@/lib/workflow/templates/email-outreach.v1';
import type { StageEvaluation } from '@/lib/workflow/types';
import { blankContact, serializeContacts } from '@/lib/outreach/contacts';
import { blankMessage, serializeMessage } from '@/lib/outreach/drafts';
import { outreachFacts, withWrittenMessage } from '@/lib/outreach/go-work';
import { describeNeed, needStillHolds, needsUser, requiredWork } from './needs';
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
