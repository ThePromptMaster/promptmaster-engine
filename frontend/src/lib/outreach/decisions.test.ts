import { describe, expect, it } from 'vitest';

import { blankContact, REASONS, type ContactRow } from './contacts';
import { chooseCandidate, decideGroup, groupDecisions } from './decisions';
import { needsResearch, researchRow } from './research';

const row = (id: string, patch: Partial<ContactRow>): ContactRow => ({ ...blankContact(id), status: 'decide', ...patch });

// Sean, 26 Nov: an uncertain address or detail is a row to resolve; one press answers a group.
describe('grouped decisions', () => {
  const rows = [
    row('a', { domain: 'acme.example', email: 'jo.b@acme.example', email_status: 'guess', reason: 'Guessed from x.y@acme.example S2; …' }),
    row('b', { domain: 'acme.example', email: 'al.c@acme.example', email_status: 'guess', reason: 'Guessed from x.y@acme.example S2; …' }),
    row('c', { domain: 'beta.example', email: 'info@beta.example', email_kind: 'general', reason: REASONS.generalInbox }),
    row('d', { email: 'm@x.example', name: 'M', reason: 'Contacted before: 2026-03-22.' }),
    row('e', { reason: 'The site lists only a contact form.' }),
    row('f', { reason: 'Two people could be right: choose one.' }),
    row('g', { status: 'ready', email: 'ok@x.example' }),
  ];

  it('groups rows that share a question; two people stay on their row', () => {
    expect(groupDecisions(rows).map((g) => [g.key, g.rowIds])).toEqual([
      ['contacted', ['d']],
      ['guess:acme.example', ['a', 'b']],
      ['general', ['c']],
      ['not_found', ['e']],
    ]);
  });

  it('one press decides the whole group, saying what was chosen', () => {
    const [, guesses] = groupDecisions(rows);
    const next = decideGroup(rows, guesses, 'use');
    expect(next.filter((r) => ['a', 'b'].includes(r.id)).map((r) => [r.status, r.reason])).toEqual([
      ['ready', 'You chose to use the guessed address.'],
      ['ready', 'You chose to use the guessed address.'],
    ]);
    const notFound = groupDecisions(rows).find((g) => g.kind === 'not_found')!;
    expect(decideGroup(rows, notFound, 'use').find((r) => r.id === 'e')!.status).toBe('decide');
    expect(decideGroup(rows, notFound, 'skip').find((r) => r.id === 'e')).toMatchObject({ status: 'skip', reason: 'No address found.' });
  });

  it('choosing one of two people takes their details and source', () => {
    const two = row('f', { reason: 'Two people could be right: choose one.', candidates: JSON.stringify([{ name: 'Ann Lee', role: 'COO', email: 'ann@acme.example', why: 'Runs ops', source: 'S3' }, { name: 'Bo Ray', role: 'VP', email: '', why: 'Supply', source: 'S3' }]) });
    expect(chooseCandidate(two, 0)).toMatchObject({ name: 'Ann Lee', role: 'COO', email: 'ann@acme.example', email_status: 'verified', src_email: 'S3', status: 'ready' });
    // No address yet: searched again for that person.
    expect(chooseCandidate(two, 1)).toMatchObject({ name: 'Bo Ray', email: '', researched: '', reason: REASONS.noAddress });
    // 27 Nov pass: chosen on a general inbox PromptMaster found, it is not ready by itself, and the
    // person's own address is searched for.
    const inbox = { ...two, email: 'hello@acme.example', email_kind: 'general' as const, email_status: 'verified' as const, src_email: 'S2', researched: 'T' };
    const chosen = chooseCandidate(inbox, 1);
    expect(chosen).toMatchObject({ name: 'Bo Ray', email: 'hello@acme.example', status: 'decide', reason: REASONS.generalInbox, researched: '' });
    expect(needsResearch(chosen)).toBe(true);
    expect(researchRow(chosen).email).toBe('');
  });

  it("a role PromptMaster found was the other person's; the list's own role stays (27 Nov pass)", () => {
    const cands = JSON.stringify([{ name: 'Brian Cao', role: 'Co-Founder', email: '', why: 'Co-founder', source: 'S18' }, { name: 'Francis Cao', role: '', email: '', why: 'Co-founder', source: 'S19' }]);
    const found = row('g', { role: 'Founder and CEO', src_role: 'S16', added: 'name,role,email', candidates: cands });
    expect(chooseCandidate(found, 0)).toMatchObject({ name: 'Brian Cao', role: 'Co-Founder', src_role: 'S18' });
    // The other candidate has no role: none is said, rather than the first person's.
    const second = chooseCandidate(found, 1);
    expect(second).toMatchObject({ name: 'Francis Cao', role: '', src_role: '' });
    expect(second.added.split(',')).not.toContain('role');
    const listed = row('h', { role: 'Head of Ops', added: 'name', candidates: cands });
    expect(chooseCandidate(listed, 0)).toMatchObject({ name: 'Brian Cao', role: 'Head of Ops' });
  });
});
