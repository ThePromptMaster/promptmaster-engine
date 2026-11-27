import { describe, expect, it } from 'vitest';

import { blankMessage, type DraftRow, type OutreachMessage } from './drafts';
import { buildSnapshot, canonicalJson, changedSince, hashSnapshot } from './snapshot';
import type { OutreachSender, OutreachSignature } from '@/types/outreach';

const sender: OutreachSender = {
  id: 'snd1', user_id: 'u', toolkit: 'gmail', from_name: 'Sean Moran', from_address: 'Sean@PromptMaster.example', reply_to: null,
  postal_address: '1 Main Street', opt_out_line: 'Reply "unsubscribe" to stop.', commercial: true,
};
const signature: OutreachSignature = {
  id: 'sig1', user_id: 'u', sender_id: 'snd1', kind: 'first', label: '', name: 'Sean Moran', title: 'Founder', company: 'PromptMaster',
  website: 'https://promptmasterv1.com', links: [], logo_id: null, logo_width: 120,
};
const message: OutreachMessage = { ...blankMessage(), subject: 'Hi', body: 'Hello. {{link}}', variables: { offer: 'x', link: 'https://promptmasterv1.com' } };
const draft: Pick<DraftRow, 'to' | 'cc' | 'bcc' | 'subject' | 'body' | 'overrides'> = { to: 'morgan@harbourline.example', cc: '', bcc: '', subject: 'A look for Harbourline', body: 'Hi Morgan. See {{link}}', overrides: '' };

// Sean, 26 Nov: "Record the exact version I approved. If someone changes the recipient, body, link,
// attachment, or sender after approval, send that message back for review."
describe('the exact email approved', () => {
  it('carries everything that goes out, filled in, with the footer', () => {
    const s = buildSnapshot({ draft, message, sender, signature, logo: null, purpose: 'send' });
    expect(s).toMatchObject({ from: { name: '', address: 'sean@promptmaster.example' }, to: ['morgan@harbourline.example'], subject: 'A look for Harbourline', commercial: true, footer: '1 Main Street\nReply "unsubscribe" to stop.' });
    expect(s.text).toContain('See https://promptmasterv1.com');
    expect(s.links).toEqual(['https://promptmasterv1.com']);
  });

  it('a test goes to the sender only', () => {
    const s = buildSnapshot({ draft: { ...draft, cc: 'boss@x.example' }, message, sender, signature, logo: null, purpose: 'test' });
    expect(s.to).toEqual(['sean@promptmaster.example']);
    expect(s.cc).toEqual([]);
  });

  it('the same email hashes the same; any change in what goes out changes it', async () => {
    const a = buildSnapshot({ draft, message, sender, signature, logo: null, purpose: 'send' });
    const b = buildSnapshot({ draft, message, sender, signature, logo: null, purpose: 'send' });
    expect(await hashSnapshot(a)).toBe(await hashSnapshot(b));
    const moved = buildSnapshot({ draft, message: { ...message, variables: { ...message.variables, link: 'https://promptmasterv1.com/demo' } }, sender, signature, logo: null, purpose: 'send' });
    expect(await hashSnapshot(moved)).not.toBe(await hashSnapshot(a));
    expect(changedSince(a, moved)).toEqual(['the text', 'a link']);
    const resigned = buildSnapshot({ draft, message, sender, signature: { ...signature, title: 'CEO' }, logo: null, purpose: 'send' });
    expect(changedSince(a, resigned)).toEqual(['how it looks (the signature or logo)']);
    const elsewhere = buildSnapshot({ draft: { ...draft, to: 'other@harbourline.example' }, message, sender, signature, logo: null, purpose: 'send' });
    expect(changedSince(a, elsewhere)).toEqual(['the recipient']);
  });

  it('writes keys in one order, whatever order they came in', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: 'é' } })).toBe('{"a":{"c":"é","d":[2,{"y":2,"z":1}]},"b":1}');
  });
});
