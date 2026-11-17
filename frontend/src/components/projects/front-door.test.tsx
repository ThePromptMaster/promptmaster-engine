/**
 * 14 Oct call: start like a normal chat, with an outline beside it, and move
 * to project-level work when ready.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { FrontDoor, itemsRead, sourcesFound } from './front-door';

const frontDoor = vi.fn();
vi.mock('@/lib/api/client', () => ({ api: { frontDoor: (...a: unknown[]) => frontDoor(...a) } }));

const reply = (objective: string, requirements: string[] = []) => ({
  reply: 'Who is it for?',
  brief: { objective, audience: '', requirements, evidence: [], deliverables: [], stages: [], approvals: [] },
  ready: false,
});

beforeEach(() => frontDoor.mockReset());

describe('FrontDoor', () => {
  it('sends the opening message at once, as a chat would', async () => {
    frontDoor.mockResolvedValue(reply('Plan the offsite'));
    render(<FrontDoor opening="Plan the offsite" onReady={vi.fn()} onBack={vi.fn()} />);
    await screen.findByText('Who is it for?');
    expect(frontDoor).toHaveBeenCalledTimes(1);
    expect(frontDoor.mock.calls[0][0].turns).toEqual([{ role: 'user', content: 'Plan the offsite' }]);
  });

  it('sends what the user changed in the outline, and the attached material', async () => {
    frontDoor.mockResolvedValue(reply('Plan the offsite'));
    render(<FrontDoor opening="Plan the offsite" onReady={vi.fn()} onBack={vi.fn()} material="Venue list" />);
    await screen.findByText('Who is it for?');
    const add = screen.getByLabelText('Add a requirement');
    await userEvent.type(add, 'Under $5,000{Enter}');
    await userEvent.type(screen.getByLabelText('Your message'), 'For the leadership team');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(frontDoor).toHaveBeenCalledTimes(2));
    const sent = frontDoor.mock.calls[1][0];
    expect(sent.brief.requirements).toEqual(['Under $5,000']);
    expect(sent.edited).toEqual(['requirements']);
    expect(sent.material).toBe('Venue list');
  });

  it('makes the project in one press, counting outline edits as the user\'s own words', async () => {
    frontDoor.mockResolvedValue(reply('Plan the offsite'));
    const onReady = vi.fn();
    render(<FrontDoor opening="Plan the offsite" onReady={onReady} onBack={vi.fn()} />);
    await screen.findByText('Who is it for?');
    await userEvent.type(screen.getByLabelText('Add a requirement'), 'Under $5,000{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Make it a project' }));
    const [brief, , said, turns] = onReady.mock.calls[0];
    expect(brief.requirements).toEqual(['Under $5,000']);
    expect(said).toContain('Under $5,000');
    expect(turns.map((t: { role: string }) => t.role)).toEqual(['user', 'assistant']);
  });

  it('searches the web (22 Oct), shows what it found, and numbers the next search after it', async () => {
    const source = (n: number) => ({ url: `https://example.org/${n}`, title: `Source ${n}`, excerpt: '' });
    frontDoor
      .mockResolvedValueOnce({ ...reply('A guide to Portugal'), reply: 'About 10.7 million [S1].', web_query: 'Portugal population', web_sources: [source(1)] })
      .mockResolvedValueOnce({ ...reply('A guide to Portugal'), reply: 'Lisbon [S2].', web_query: 'Portugal capital', web_sources: [source(2)] });
    const onReady = vi.fn();
    render(<FrontDoor opening="How many people live in Portugal?" onReady={onReady} onBack={vi.fn()} />);
    await screen.findByText(/Searched the web for “Portugal population”/);
    expect(screen.getByRole('link', { name: 'Source 1' })).toHaveAttribute('href', 'https://example.org/1');
    expect(frontDoor.mock.calls[0][0]).toMatchObject({ web_access: 'on', sources: [] });

    await userEvent.type(screen.getByLabelText('Your message'), 'And its capital?');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText(/Searched the web for “Portugal capital”/);
    expect(frontDoor.mock.calls[1][0].sources).toEqual([source(1)]);
    expect(screen.getByRole('link', { name: 'Source 2' }).closest('li')).toHaveTextContent('[S2] Source 2');

    await userEvent.click(screen.getByRole('button', { name: 'Make it a project' }));
    const turns = onReady.mock.calls[0][3];
    expect(sourcesFound(turns).map((s) => s.url)).toEqual(['https://example.org/1', 'https://example.org/2']);
  });
});

describe('the start conversation reads connected accounts (17 Nov, Sean: Drive and Salesforce)', () => {
  const item = { kind: 'file' as const, source: 'Google Drive', title: 'Q3 board pack', text: 'Revenue grew 12%.', when: '2 Nov' };
  it('asks for an account search, shows what was read, and sends it back with the next turn', async () => {
    frontDoor.mockResolvedValueOnce({ ...reply('A Q3 summary'), reply: 'Your board pack says revenue grew 12% [T1].', account_query: 'Q3 board pack', account_items: [item] });
    frontDoor.mockResolvedValueOnce(reply('A Q3 summary'));
    render(<FrontDoor opening="Summarise my Q3 board pack from Drive" onReady={vi.fn()} onBack={vi.fn()} />);
    await screen.findByText('Your board pack says revenue grew 12% [T1].');
    expect(frontDoor.mock.calls[0][0].account_search).toBe('on');
    expect(screen.getByText(/Read from your accounts: 1 item/)).toBeTruthy();
    expect(screen.getByText(/\[T1\] Google Drive · Q3 board pack/)).toBeTruthy();
    await userEvent.type(screen.getByLabelText('Your message'), 'Keep it to one page');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(frontDoor).toHaveBeenCalledTimes(2));
    expect(frontDoor.mock.calls[1][0].account_items).toEqual([item]);
  });

  it('what was read is listed for the project', () => {
    expect(itemsRead([{ role: 'user', content: 'x' }, { role: 'assistant', content: 'y', accounts: { query: 'q', items: [item] } }])).toEqual([item]);
  });
});
