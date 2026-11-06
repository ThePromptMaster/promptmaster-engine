import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { takeStartGoal } from '@/lib/projects/example-goals';

import { ConnectFlow } from './connect-flow';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));

const savePreferences = vi.fn(async () => {});
vi.mock('@/lib/supabase/preferences', () => ({
  loadPreferences: async () => null,
  savePreferences: (...args: unknown[]) => (savePreferences as (...a: unknown[]) => Promise<void>)(...args),
}));

const suggestWorkflows = vi.fn();
vi.mock('@/lib/api/client', () => ({ api: { suggestWorkflows: (req: unknown) => suggestWorkflows(req) } }));

const connectGoogle = vi.fn(async () => {});
const readGoogleCalendar = vi.fn();
const readGoogleMail = vi.fn();
vi.mock('@/lib/connections/google', () => ({
  GoogleRefused: class extends Error {},
  googleConfigured: () => true,
  connectGoogle: () => connectGoogle(),
  readGoogleCalendar: () => readGoogleCalendar(),
  readGoogleMail: () => readGoogleMail(),
  pickGoogleFiles: async () => [],
}));

const MEETING = { id: 'gcal:e1', kind: 'calendar_event', source: 'dana@example.org', title: 'Q4 budget review', text: 'When: Tuesday\nBring the forecast.', startsAt: '2026-11-10' };
const EMAIL = { id: 'gmail:t1', kind: 'email', source: 'sam@example.org', title: 'Forecast draft', text: 'Date: Mon, 2 Nov' };

async function connected() {
  const ui = userEvent.setup();
  render(<ConnectFlow />);
  await ui.click(screen.getByRole('button', { name: 'Connect Google' }));
  await screen.findByRole('heading', { name: 'Upcoming meetings' });
  return ui;
}

describe('connecting an account', () => {
  beforeEach(() => {
    readGoogleCalendar.mockResolvedValue([MEETING]);
    readGoogleMail.mockResolvedValue([EMAIL]);
    suggestWorkflows.mockResolvedValue({
      work_summary: 'Budget work.',
      suggestions: [{ example_key: 'investment_memo', title: 'A Q4 briefing', why: 'The review on Tuesday.', objective: 'Write my Q4 briefing.', based_on: [1] }],
    });
  });
  afterEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it('says what will happen before Google does, and reads nothing yet', () => {
    render(<ConnectFlow />);
    expect(screen.getByText(/never reads the body of an email/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing leaves it until you tick an item/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /privacy/i })).toHaveAttribute('href', '/privacy');
    expect(connectGoogle).not.toHaveBeenCalled();
    expect(readGoogleCalendar).not.toHaveBeenCalled();
  });

  it('starts with nothing ticked, and sends nothing until asked', async () => {
    const ui = await connected();
    for (const box of screen.getAllByRole('checkbox')) expect(box).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Review what will be sent' })).toBeDisabled();
    await ui.click(screen.getByRole('checkbox', { name: /Q4 budget review/ }));
    await ui.click(screen.getByRole('button', { name: 'Review what will be sent' }));
    expect(screen.getByRole('heading', { name: 'This exact text is what will be sent' })).toBeInTheDocument();
    expect(suggestWorkflows).not.toHaveBeenCalled();
  });

  it('records that an account was connected, and never a token', async () => {
    await connected();
    expect(savePreferences).toHaveBeenCalledTimes(1);
    const [, saved] = savePreferences.mock.calls[0] as unknown as [string, { connections: { google: Record<string, unknown> } }];
    expect(Object.keys(saved.connections.google)).toEqual(['connected_at']);
  });

  it('sends exactly what the preview shows, edits and removals included', async () => {
    const ui = await connected();
    await ui.click(screen.getByRole('checkbox', { name: /Q4 budget review/ }));
    await ui.click(screen.getByRole('checkbox', { name: /Forecast draft/ }));
    await ui.click(screen.getByRole('button', { name: 'Review what will be sent' }));

    const box = screen.getByRole('textbox', { name: 'Q4 budget review' });
    await ui.clear(box);
    await ui.type(box, 'Just the budget.');
    const email = screen.getByText('Forecast draft').closest('li')!;
    await ui.click(within(email).getByRole('button', { name: 'Remove' }));
    await ui.click(screen.getByRole('button', { name: 'Send and get suggestions' }));

    await screen.findByRole('heading', { name: 'What you could start with' });
    const [request] = suggestWorkflows.mock.calls[0] as [{ items: unknown[] }];
    expect(request.items).toEqual([{ kind: 'calendar_event', source: 'dana@example.org', title: 'Q4 budget review', text: 'Just the budget.' }]);
  });

  it('shows what each suggestion came from, and starts it through the start box', async () => {
    const ui = await connected();
    await ui.click(screen.getByRole('checkbox', { name: /Q4 budget review/ }));
    await ui.click(screen.getByRole('button', { name: 'Review what will be sent' }));
    await ui.click(screen.getByRole('button', { name: 'Send and get suggestions' }));
    await screen.findByText('A Q4 briefing');
    expect(screen.getByText('Based on: Q4 budget review')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See the example workflow' })).toHaveAttribute('href', '/examples/investment-memo');
    await ui.click(screen.getByRole('button', { name: 'Start this' }));
    expect(push).toHaveBeenCalledWith('/projects/new');
    expect(takeStartGoal()).toBe('Write my Q4 briefing.');
  });

  it('carries on with what it could read when one part is refused', async () => {
    readGoogleMail.mockRejectedValue(new Error('Google did not give access to this.'));
    await connected();
    expect(screen.getByRole('checkbox', { name: /Q4 budget review/ })).toBeInTheDocument();
    expect(screen.getByText(/Could not read Recent email/)).toBeInTheDocument();
  });

  it('offers the questions to someone who would rather not', async () => {
    const ui = userEvent.setup();
    render(<ConnectFlow />);
    await ui.click(screen.getByRole('button', { name: /No thanks/ }));
    expect(screen.getByRole('region', { name: 'Three quick questions' })).toBeInTheDocument();
    expect(connectGoogle).not.toHaveBeenCalled();
    await waitFor(() => expect(savePreferences).toHaveBeenCalledWith('u1', { personalization: 'declined' }));
  });
});
