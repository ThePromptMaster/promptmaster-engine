import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const tickets = vi.fn();
vi.mock('@/lib/api/client', () => ({ api: { outreachTickets: (a: unknown) => tickets(a), outreachCheckTest: vi.fn() } }));
const drain = vi.fn().mockResolvedValue(true);
vi.mock('@/lib/jobs/client-drain', () => ({ drainOnce: (p: string) => drain(p) }));
const sends = { createApprovals: vi.fn(), scheduleSends: vi.fn(), moveSends: vi.fn(), revokeApproval: vi.fn(), list: [] as unknown[], approvals: [] as unknown[] };
vi.mock('@/lib/supabase/outreach-sends', () => ({
  createApprovals: (...a: unknown[]) => sends.createApprovals(...a),
  scheduleSends: (...a: unknown[]) => sends.scheduleSends(...a),
  moveSends: (...a: unknown[]) => sends.moveSends(...a),
  revokeApproval: (...a: unknown[]) => sends.revokeApproval(...a),
  listSends: async () => sends.list,
  listApprovals: async () => sends.approvals,
}));
vi.mock('@/lib/supabase/outreach-identity', () => ({
  listSenders: async () => [{ id: 'snd1', user_id: 'u1', toolkit: 'gmail', from_name: 'Sean', from_address: 'sean@pm.example', reply_to: null, postal_address: '1 Main St', opt_out_line: 'Reply stop.', commercial: true }],
  listSignatures: async () => [],
  listLogos: async () => [],
  loadOutreachSettings: async () => ({ user_id: 'u1', daily_cap: 50, spacing_seconds: 45, paused: false, timezone: 'UTC' }),
}));

import { DraftsPart } from './drafts-part';
import type { OutreachContext } from '@/components/workflow/renderers/types';

const contact = (id: string, email: string) => ({ id, status: 'ready', name: 'A Person', company: 'Co', email, personal_line: 'Nice launch.' });
const draft = (id: string, to: string, extra: Record<string, string> = {}) => ({ id, status: '', reason: '', contact_id: id, to, cc: '', bcc: '', subject: 'Hello', body: 'Hi. Nice launch. {{link}}', edited: '', overrides: '', ...extra });

function setup(drafts: unknown[]) {
  const save = vi.fn().mockResolvedValue(undefined);
  const context: OutreachContext = {
    project: { id: 'p1', user_id: 'u1' } as OutreachContext['project'],
    parts: {
      contacts: { stageId: 'contacts', content: JSON.stringify({ kind: 'stage_items', items: [contact('c1', 'a@x.example'), contact('c2', 'b@y.example')], imports: [] }) },
      message: { stageId: 'message', content: JSON.stringify({ kind: 'outreach_message', subject: 'Hello', body: 'Hi. {{personal_line}} {{link}}', followup: null, variables: { offer: 'x', link: 'https://promptmasterv1.com' }, sender_id: 'snd1', signature_id: null, reply_signature_id: null }) },
      drafts: { stageId: 'drafts', content: JSON.stringify({ kind: 'stage_items', items: drafts }) },
    },
    briefText: '',
    save,
  };
  render(<DraftsPart context={context} stageId="drafts" readOnly={false} />);
  return save;
}

beforeEach(() => {
  tickets.mockReset();
  drain.mockClear();
  sends.createApprovals.mockReset().mockResolvedValue(undefined);
  sends.scheduleSends.mockReset().mockResolvedValue([]);
  sends.list = [];
  sends.approvals = [];
});

// Sean, 26 Nov: "Let me approve one email or a selected batch. Record the exact version I approved."
describe('approving and sending outreach email', () => {
  it('approves the selected emails as they are, each with its ticket, and says why one could not be', async () => {
    tickets.mockImplementation(async (items: { approval_id: string }[]) => [
      { approval_id: items[0].approval_id, message_hash: 'a'.repeat(64), ticket: 'b'.repeat(64), problems: [] },
      { approval_id: items[1].approval_id, message_hash: '', ticket: '', problems: ['An outreach email goes to exactly one person.'] },
    ]);
    const save = setup([draft('c1', 'a@x.example'), draft('c2', 'b@y.example')]);
    await waitFor(() => expect(document.querySelectorAll('[data-select-draft]')).toHaveLength(2));
    for (const box of document.querySelectorAll('[data-select-draft]')) await userEvent.click(box as HTMLElement);
    await userEvent.click(screen.getByRole('button', { name: 'Approve 2' }));
    await waitFor(() => expect(save).toHaveBeenCalled());

    const sent = tickets.mock.calls[0][0] as { purpose: string; snapshot: { to: string[]; from: { address: string } } }[];
    expect(sent.map((s) => [s.purpose, s.snapshot.to[0], s.snapshot.from.address])).toEqual([['send', 'a@x.example', 'sean@pm.example'], ['send', 'b@y.example', 'sean@pm.example']]);
    const rows = sends.createApprovals.mock.calls[0][2] as { draft_id: string; ticket: string; stage_id: string; message_stage_id: string }[];
    expect(rows).toEqual([expect.objectContaining({ draft_id: 'c1', ticket: 'b'.repeat(64), stage_id: 'drafts', message_stage_id: 'message' })]);
    const saved = JSON.parse(save.mock.calls[0][1]).items;
    expect(saved[0]).toMatchObject({ status: 'approved', approval_id: (sent as unknown as { approval_id: string }[])[0].approval_id });
    expect(saved[1].status).toBe('');
    expect(screen.getByText('An outreach email goes to exactly one person.')).toBeTruthy();
  });

  it('sends the approved emails now through the job runner, spaced as Settings says', async () => {
    setup([draft('c1', 'a@x.example', { status: 'approved', approval_id: 'ap1' }), draft('c2', 'b@y.example', { status: 'approved', approval_id: 'ap2' })]);
    await userEvent.click(await screen.findByRole('button', { name: 'Send now' }));
    await waitFor(() => expect(sends.scheduleSends).toHaveBeenCalled());
    const [projectId, ids, , spacing] = sends.scheduleSends.mock.calls[0];
    expect([projectId, ids, spacing]).toEqual(['p1', ['ap1', 'ap2'], 45]);
    await waitFor(() => expect(drain).toHaveBeenCalledWith('p1'));
  });

  it('holds back an email with something left to fill in: it cannot be selected', async () => {
    setup([draft('c1', 'a@x.example', { body: 'Hi {{first_name}}' })]);
    await waitFor(() => expect(document.querySelector('[data-draft]')).toBeTruthy());
    expect(document.querySelector('[data-select-draft]')).toBeNull();
  });
});
