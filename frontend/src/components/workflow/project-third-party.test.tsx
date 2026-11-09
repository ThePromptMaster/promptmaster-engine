import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ProjectThirdParty } from './project-third-party';

let auth = { isGuest: false };
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => auth }));

let connected = true;
vi.mock('@/lib/connections/account-found', () => ({ hasConnectedAccount: async () => connected }));

const MAIL = { kind: 'email' as const, source: 'Gmail · Dana', title: 'Pricing for Q1', text: 'Our price rises 4% in January.', when: '2026-11-03T09:00:00Z' };
const EVENT = { kind: 'calendar_event' as const, source: 'Google Calendar', title: 'Supplier review', text: 'Agenda: prices.' };

describe('the "From your accounts" panel', () => {
  beforeEach(() => {
    auth = { isGuest: false };
    connected = true;
  });
  afterEach(() => vi.clearAllMocks());

  it('lists what the project holds as [T1]…, and shows the exact text on request', async () => {
    const ui = userEvent.setup();
    render(<ProjectThirdParty project={{ id: 'p1', third_party: [MAIL, EVENT] }} onSave={vi.fn()} onAdd={vi.fn()} />);
    expect(screen.getByText('2 of 20')).toBeInTheDocument();
    expect(screen.getByText('[T1]')).toBeInTheDocument();
    expect(screen.getByText('Pricing for Q1')).toBeInTheDocument();
    expect(screen.getByText('[T2]')).toBeInTheDocument();
    expect(screen.queryByText('Our price rises 4% in January.')).not.toBeInTheDocument();
    await ui.click(screen.getAllByRole('button', { name: 'Show text' })[0]);
    expect(screen.getByText('Our price rises 4% in January.')).toBeInTheDocument();
    expect(screen.getByText(/written from your brief, never from these/)).toBeInTheDocument();
  });

  it('removes one by saving the rest', async () => {
    const ui = userEvent.setup();
    const onSave = vi.fn(async () => undefined);
    render(<ProjectThirdParty project={{ id: 'p1', third_party: [MAIL, EVENT] }} onSave={onSave} onAdd={vi.fn()} />);
    await ui.click(screen.getAllByRole('button', { name: 'Remove' })[0]);
    await waitFor(() => expect(onSave).toHaveBeenCalledWith([EVENT]));
  });

  it('opens the accounts to add more', async () => {
    const ui = userEvent.setup();
    const onAdd = vi.fn(async () => undefined);
    render(<ProjectThirdParty project={{ id: 'p1', third_party: [] }} onSave={vi.fn()} onAdd={onAdd} />);
    // Nothing held: closed until opened.
    await ui.click(screen.getByRole('button', { name: /From your accounts/ }));
    await ui.click(screen.getByRole('button', { name: 'Add from my accounts' }));
    expect(onAdd).toHaveBeenCalled();
  });

  it('says why a change was not saved', async () => {
    const ui = userEvent.setup();
    const onSave = vi.fn(async () => {
      throw new Error('offline');
    });
    render(<ProjectThirdParty project={{ id: 'p1', third_party: [MAIL] }} onSave={onSave} onAdd={vi.fn()} />);
    await ui.click(screen.getByRole('button', { name: 'Remove' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That change was not saved. offline');
  });

  it('read-only: can be read, not changed', async () => {
    render(<ProjectThirdParty project={{ id: 'p1', third_party: [MAIL] }} readOnly onSave={vi.fn()} onAdd={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Show text' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add from my accounts' })).not.toBeInTheDocument();
  });

  it('is not shown to a guest with nothing held, and a full project cannot add', () => {
    auth = { isGuest: true };
    const { container } = render(<ProjectThirdParty project={{ id: 'p1', third_party: [] }} onSave={vi.fn()} onAdd={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    auth = { isGuest: false };
    const full = Array.from({ length: 20 }, (_x, i) => ({ ...MAIL, title: `m${i}` }));
    render(<ProjectThirdParty project={{ id: 'p2', third_party: full }} onSave={vi.fn()} onAdd={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'At most 20' })).toBeDisabled();
  });

  it('has a switch for searching the accounts, only once something is connected', async () => {
    const ui = userEvent.setup();
    const onAccountSearch = vi.fn(async () => undefined);
    render(<ProjectThirdParty project={{ id: 'p1', third_party: [MAIL], account_search: 'on' }} onSave={vi.fn()} onAdd={vi.fn()} onAccountSearch={onAccountSearch} />);
    const toggle = await screen.findByRole('switch', { name: 'Search my accounts for this project' });
    expect(toggle).toBeChecked();
    await ui.click(toggle);
    await waitFor(() => expect(onAccountSearch).toHaveBeenCalledWith('off'));
  });

  it('shows no switch with nothing connected', async () => {
    connected = false;
    render(<ProjectThirdParty project={{ id: 'p1', third_party: [MAIL], account_search: 'on' }} onSave={vi.fn()} onAdd={vi.fn()} onAccountSearch={vi.fn()} />);
    await screen.findByText('Pricing for Q1');
    await waitFor(() => expect(screen.queryByRole('switch')).not.toBeInTheDocument());
  });

  it('read-only: the switch can be seen, not changed', async () => {
    render(<ProjectThirdParty project={{ id: 'p1', third_party: [MAIL], account_search: 'off' }} readOnly onSave={vi.fn()} onAdd={vi.fn()} onAccountSearch={vi.fn()} />);
    expect(await screen.findByRole('switch')).toBeDisabled();
  });
});
