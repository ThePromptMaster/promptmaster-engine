import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const outreachSentCheck = vi.fn();
vi.mock('@/lib/api/client', () => ({ api: { outreachSentCheck: (r: unknown) => outreachSentCheck(r) } }));
const history = { list: [] as unknown[], suppressed: [] as unknown[], record: vi.fn(), suppress: vi.fn() };
vi.mock('@/lib/supabase/outreach-contacts', async (orig) => {
  const real = await orig<typeof import('@/lib/supabase/outreach-contacts')>();
  return {
    ...real,
    listHistory: async () => history.list,
    listSuppressions: async () => history.suppressed,
    recordContact: (...a: unknown[]) => history.record(...a),
    suppress: (...a: unknown[]) => history.suppress(...a),
  };
});

import { ContactsPart } from './contacts-part';
import type { OutreachContext } from '@/components/workflow/renderers/types';
import type { ContactsDocument } from '@/lib/outreach/contacts';

// Sean's first test, in short: rows from Clay, one already emailed, a duplicate, a public inbox, a gap.
const CLAY = [
  'First Name,Last Name,Job Title,Company Name,Company Domain,Work Email',
  'Jamie,Park,COO,Northwind,northwind-holdings.example,jamie.park@northwind-holdings.example',
  'Jamie,Park,COO,Northwind,northwind-holdings.example,Jamie.Park@Northwind-Holdings.example',
  ',,,Quillfield,quillfield.example,info@quillfield.example',
  'Alex,Rivera,Head of Ops,Bayview,bayview.example,',
  'Morgan,Lee,VP Operations,Harbourline,harbourline.example,morgan@harbourline.example',
].join('\n');

function setup(content: string | null = null) {
  const save = vi.fn().mockResolvedValue(undefined);
  const context: OutreachContext = {
    project: { id: 'p1', user_id: 'u1' } as OutreachContext['project'],
    parts: { contacts: { stageId: 'contacts', content } },
    briefText: '',
    save,
  };
  render(<ContactsPart context={context} stageId="contacts" readOnly={false} />);
  return save;
}

beforeEach(() => {
  history.list = [];
  history.suppressed = [];
  outreachSentCheck.mockReset().mockResolvedValue({
    checked: true,
    sent: [{ address: 'jamie.park@northwind-holdings.example', on: '2026-10-27T09:00:00Z', subject: 'A quick look', thread_url: 'https://mail.google.com/mail/#all/t1' }],
    colleagues: [],
  });
});

describe('importing a contact list (Sean, 26 Nov)', () => {
  it('maps Clay\'s columns, keeps the rows as given, and marks the duplicate, the earlier contact, the general inbox and the gap', async () => {
    const save = setup();
    fireEvent.change(screen.getByLabelText('Your list'), { target: { value: CLAY } });
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect((document.querySelector('[data-map-field="email"]') as HTMLSelectElement).value).toBe('Work Email');
    expect((document.querySelector('[data-map-field="company"]') as HTMLSelectElement).value).toBe('Company Name');
    await userEvent.click(screen.getByRole('button', { name: 'Add to the contacts' }));
    await waitFor(() => expect(save).toHaveBeenCalled());

    const [stageId, content, operation] = save.mock.calls[0];
    expect(stageId).toBe('contacts');
    expect(operation).toBe('outreach_import');
    const doc = JSON.parse(content) as ContactsDocument;
    expect(doc.imports).toHaveLength(1);
    const byCompany = (c: string) => doc.items.filter((r) => r.company === c);
    const [jamie, again] = byCompany('Northwind');
    expect(jamie.status).toBe('decide');
    expect(JSON.parse(jamie.contacted)).toMatchObject({ source: 'mailbox', thread_url: 'https://mail.google.com/mail/#all/t1' });
    expect(again).toMatchObject({ status: 'skip', duplicate_of: jamie.id });
    expect(byCompany('Quillfield')[0]).toMatchObject({ email_kind: 'general', status: 'decide' });
    expect(byCompany('Bayview')[0]).toMatchObject({ status: '', email: '' });
    expect(byCompany('Harbourline')[0].status).toBe('ready');
    // What came in is kept exactly, header by header.
    expect(JSON.parse(byCompany('Harbourline')[0].given)).toMatchObject({ 'Job Title': 'VP Operations', 'Work Email': 'morgan@harbourline.example' });
    // The Sent-mail check asked about these addresses and companies only.
    expect(outreachSentCheck.mock.calls[0][0].addresses).toContain('morgan@harbourline.example');
  });

  it('protects someone on the do-not-contact list, whatever the import says', async () => {
    history.suppressed = [{ id: 's1', address: 'morgan@harbourline.example', domain: null, reason: 'manual', note: '', created_at: '' }];
    const save = setup();
    fireEvent.change(screen.getByLabelText('Your list'), { target: { value: CLAY } });
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add to the contacts' }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    const doc = JSON.parse(save.mock.calls[0][1]) as ContactsDocument;
    expect(doc.items.find((r) => r.company === 'Harbourline')).toMatchObject({ status: 'skip', reason: 'On your do-not-contact list.' });
  });

  it('takes a list of companies and websites as rows to research', async () => {
    const save = setup();
    fireEvent.change(screen.getByLabelText('Your list'), { target: { value: 'Acme, acme.example\nBeta Co - https://beta.example' } });
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText(/2 companies, one per line/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Add to the contacts' }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    const doc = JSON.parse(save.mock.calls[0][1]) as ContactsDocument;
    expect(doc.items.map((r) => [r.company, r.domain, r.status])).toEqual([['Acme', 'acme.example', ''], ['Beta Co', 'beta.example', '']]);
  });
});
