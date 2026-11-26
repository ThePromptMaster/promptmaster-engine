import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 'u1', email: 'sean@x.co', is_anonymous: false }, loading: false, isGuest: false }) }));

const outreachMailbox = vi.fn();
vi.mock('@/lib/api/client', () => ({ api: { outreachMailbox: () => outreachMailbox() } }));

const store = {
  senders: [] as unknown[],
  signatures: [] as unknown[],
  createSender: vi.fn(),
  updateSender: vi.fn(),
  saveSignature: vi.fn(),
};
vi.mock('@/lib/supabase/outreach-identity', async (orig) => {
  const real = await orig<typeof import('@/lib/supabase/outreach-identity')>();
  return {
    ...real,
    listSenders: async () => store.senders,
    listSignatures: async () => store.signatures,
    listLogos: async () => [],
    loadOutreachSettings: async (userId: string) => ({ user_id: userId, ...real.DEFAULT_SETTINGS }),
    saveOutreachSettings: vi.fn(),
    createSender: (...a: unknown[]) => store.createSender(...a),
    updateSender: (...a: unknown[]) => store.updateSender(...a),
    saveSignature: (...a: unknown[]) => store.saveSignature(...a),
  };
});

import { OutreachSettings } from './outreach-settings';

const sender = {
  id: 's1', user_id: 'u1', toolkit: 'gmail', from_name: 'Sean Moran', from_address: 'sean@x.co', reply_to: null,
  postal_address: '', opt_out_line: 'Reply "unsubscribe" to stop.', commercial: true,
};

beforeEach(() => {
  store.senders = [];
  store.signatures = [];
  store.createSender.mockReset().mockResolvedValue(sender);
  store.updateSender.mockReset().mockResolvedValue(sender);
  store.saveSignature.mockReset().mockResolvedValue({});
  outreachMailbox.mockReset();
});

// Sean, 26 Nov: "Show me which account is connected … Save reusable signatures by sender or brand."
describe('outreach email in Settings', () => {
  it('asks for a mailbox when none is connected', async () => {
    outreachMailbox.mockResolvedValue({ mailboxes: [] });
    render(<OutreachSettings />);
    expect(await screen.findByText('Connect Gmail or Outlook above to send outreach from it.')).toBeTruthy();
  });

  it('names the address the connected Gmail sends as, and sets up a sender for it', async () => {
    outreachMailbox.mockResolvedValue({ mailboxes: [{ toolkit: 'gmail', label: 'Gmail', connection_id: 'c1', address: 'sean@x.co' }] });
    render(<OutreachSettings />);
    expect(await screen.findByText('Sends from your connected Gmail: sean@x.co')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Set up sending from sean@x.co' }));
    expect(store.createSender).toHaveBeenCalledWith('u1', 'gmail', 'sean@x.co', expect.objectContaining({ commercial: true }));
  });

  it('previews the email with every header, and says a commercial email needs a postal address', async () => {
    store.senders = [sender];
    outreachMailbox.mockResolvedValue({ mailboxes: [{ toolkit: 'gmail', label: 'Gmail', connection_id: 'c1', address: 'sean@x.co' }] });
    render(<OutreachSettings />);
    await waitFor(() => expect(document.querySelector('[data-email-headers]')).toBeTruthy());
    const headers = document.querySelector('[data-email-headers]')!.textContent ?? '';
    expect(headers).toContain('Sean Moran <sean@x.co>');
    for (const h of ['From', 'To', 'Cc', 'Bcc', 'Subject', 'Links', 'Attachments', 'Signature']) expect(headers).toContain(h);
    expect(document.querySelector('[data-render-warning="compliance_missing"]')).toBeTruthy();
    const frame = document.querySelector('[data-preview-frame]') as HTMLIFrameElement;
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('srcdoc')).toContain('Reply &quot;unsubscribe&quot; to stop.');
  });

  it('saves a first-email signature for the sender', async () => {
    store.senders = [sender];
    outreachMailbox.mockResolvedValue({ mailboxes: [{ toolkit: 'gmail', label: 'Gmail', connection_id: 'c1', address: 'sean@x.co' }] });
    render(<OutreachSettings />);
    const name = await screen.findByLabelText('Name');
    await userEvent.type(name, 'Sean Moran');
    await userEvent.type(screen.getByLabelText('Company'), 'PromptMaster');
    await userEvent.click(screen.getByRole('button', { name: 'Save signature' }));
    expect(store.saveSignature).toHaveBeenCalledWith('u1', 's1', expect.objectContaining({ kind: 'first', name: 'Sean Moran', company: 'PromptMaster' }), undefined);
    // The preview follows what was typed, before it is saved.
    expect((document.querySelector('[data-preview-frame]') as HTMLIFrameElement).getAttribute('srcdoc')).toContain('PromptMaster');
  });
});
