import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { BETA_NOTICE_STORAGE_KEY } from '@/components/shared/beta-notice';
import { PROMPTY_STORAGE_KEY, PromptyHelp } from './prompty-help';

vi.mock('next/navigation', () => ({ usePathname: () => '/projects/new' }));

let user: { id: string } | null = null;
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user }) }));

const loadAnswers = vi.fn(async (): Promise<unknown> => null);
vi.mock('@/lib/supabase/preferences', () => ({
  loadAnswers: (...args: unknown[]) => (loadAnswers as (...a: unknown[]) => Promise<unknown>)(...args),
}));

describe('Prompty', () => {
  beforeEach(() => localStorage.setItem(BETA_NOTICE_STORAGE_KEY, 'dismissed'));
  afterEach(() => {
    localStorage.clear();
    user = null;
    vi.clearAllMocks();
  });

  it('waits for the beta notice, so the two never sit on each other', () => {
    localStorage.removeItem(BETA_NOTICE_STORAGE_KEY);
    render(<PromptyHelp place="list" />);
    expect(screen.queryByRole('button', { name: 'Help' })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens once on a first visit with a way in for each kind of visitor', async () => {
    render(<PromptyHelp place="list" />);
    const dialog = await screen.findByRole('dialog', { name: 'Prompty' });
    expect(dialog).toHaveTextContent('Want to see an example, or start with your own project?');
    expect(screen.getByRole('link', { name: /Deal screening/ })).toHaveAttribute('href', '/examples/deal-screening');
    expect(screen.getByRole('link', { name: 'See all examples' })).toHaveAttribute('href', '/examples');
    expect(screen.getByRole('link', { name: 'Help me start mine' })).toHaveAttribute('href', '/projects/new');

    await userEvent.setup().click(screen.getByRole('button', { name: 'Explore on my own' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(localStorage.getItem(PROMPTY_STORAGE_KEY)).toBe('seen');
    // Still there to ask.
    expect(screen.getByRole('button', { name: 'Help' })).toBeInTheDocument();
  });

  it('does not repeat, and reopens from Help', async () => {
    localStorage.setItem(PROMPTY_STORAGE_KEY, 'seen');
    render(<PromptyHelp place="list" />);
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Help' }));
    expect(screen.getByRole('dialog', { name: 'Prompty' })).toBeInTheDocument();
  });

  it('stays closed where it was not asked to open', () => {
    render(<PromptyHelp place="list" autoOpen={false} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Help' })).toBeInTheDocument();
  });

  it('offers the two ways in on the start screen, and the section on the landing page', async () => {
    const { unmount } = render(<PromptyHelp place="start" />);
    const dialog = await screen.findByRole('dialog', { name: 'Prompty' });
    expect(dialog).toHaveTextContent('Want to work out your approach together, or get a first draft?');
    expect(screen.queryByRole('link', { name: 'Help me start mine' })).toBeNull();
    unmount();

    render(<PromptyHelp place="landing" />);
    expect(await screen.findByRole('link', { name: 'See all examples' })).toHaveAttribute('href', '#examples');
  });

  it('names only three examples, and asks for nothing while closed or signed out', async () => {
    const { container } = render(<PromptyHelp place="list" />);
    await screen.findByRole('dialog', { name: 'Prompty' });
    expect(container.querySelectorAll('a[href^="/examples/"]')).toHaveLength(3);
    expect(loadAnswers).not.toHaveBeenCalled();
  });

  it('leads with what suits their saved answers', async () => {
    user = { id: 'u1' };
    loadAnswers.mockResolvedValueOnce({ work: 'consulting', need: 'slides' });
    const { container } = render(<PromptyHelp place="list" />);
    await waitFor(() => expect(container.querySelector('a[href^="/examples/"]')).toHaveAttribute('href', '/examples/slide-deck'));
    expect(loadAnswers).toHaveBeenCalledWith('u1');
  });
});
