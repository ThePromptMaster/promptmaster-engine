import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ConnectFlow } from './connect-flow';

let auth: { user: { id: string; email: string } | null; isGuest: boolean; loading: boolean } = { user: null, isGuest: false, loading: false };
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => auth }));

const api = {
  listConnections: vi.fn(),
  previewConnections: vi.fn(),
  searchConnections: vi.fn(),
  suggestWorkflows: vi.fn(),
  linkConnection: vi.fn(),
  disconnect: vi.fn(),
};
vi.mock('@/lib/api/client', () => ({
  api: new Proxy({}, { get: (_t, name: string) => (...args: unknown[]) => (api as Record<string, (...a: unknown[]) => unknown>)[name](...args) }),
}));
vi.mock('@/lib/api/language', () => ({ setRequestLanguage: vi.fn() }));
const goSignedIn = vi.fn();
vi.mock('@/lib/auth/sign-in', () => ({ goSignedIn: (to: string) => goSignedIn(to) }));
const startExample = vi.fn(async () => 'project-1');
const projects = { getProject: vi.fn(), updateProject: vi.fn() };
vi.mock('@/lib/supabase/projects', () => ({
  getProject: (...args: unknown[]) => projects.getProject(...args),
  updateProject: (...args: unknown[]) => projects.updateProject(...args),
}));
vi.mock('@/lib/projects/examples/start-example', () => ({ startExample: (...args: unknown[]) => (startExample as (...a: unknown[]) => unknown)(...args) }));

const ITEMS = [
  { id: 'e1', toolkit: 'googlecalendar', kind: 'calendar_event', title: 'Q3 board meeting', when: '2026-11-10T14:00:00Z', who: 'Dana <dana@northwind.example>', people: ['dana@northwind.example'], detail: '', ref: {}, readable: true, note: '' },
  { id: 'm1', toolkit: 'gmail', kind: 'email', title: 'Board pack for Thursday', when: '2026-11-06T09:00:00Z', who: 'Dana <dana@northwind.example>', people: [], detail: '', ref: {}, readable: true, note: '' },
  { id: 'm2', toolkit: 'gmail', kind: 'email', title: 'Lunch', when: '2026-11-05T09:00:00Z', who: 'Sam <sam@x.example>', people: [], detail: '', ref: {}, readable: true, note: '' },
  { id: 'f1', toolkit: 'googledrive', kind: 'file', title: 'Offsite.mp4', when: '', who: '', people: [], detail: 'video/mp4', ref: { mime: 'video/mp4' }, readable: false, note: "This kind of file can't be read here yet." },
];

const TEXT = (id: string, toolkit: string, kind: string, title: string, text: string) => ({ id, toolkit, kind, source: `${toolkit} · src`, title, text });

describe('using connected accounts', () => {
  beforeEach(() => {
    auth = { user: { id: 'u1', email: 'me@example.com' }, isGuest: false, loading: false };
    api.listConnections.mockResolvedValue({ accounts: [{ id: 'a1', toolkit: 'gmail', label: 'Gmail', status: 'ACTIVE', connected_at: '' }, { id: 'a2', toolkit: 'googlecalendar', label: 'Google Calendar', status: 'ACTIVE', connected_at: '' }], toolkits: [] });
    api.previewConnections.mockResolvedValue({ items: ITEMS, problems: [] });
  });
  afterEach(() => vi.clearAllMocks());

  it('asks a guest to make an account, and reads nothing', async () => {
    auth = { user: { id: 'g', email: '' }, isGuest: true, loading: false };
    render(<ConnectFlow />);
    expect(await screen.findByText(/Create an account to connect/)).toBeInTheDocument();
    expect(api.listConnections).not.toHaveBeenCalled();
    expect(api.previewConnections).not.toHaveBeenCalled();
  });

  const FOUND = (...items: unknown[]) => ({ query: 'q', matches: items.length, items, files: [], skipped: [], problems: [] });
  const SUGGESTED = (based_on: number[]) => ({
    work_summary: 'You are preparing for the board.',
    suggestions: [{ example_key: 'meeting_briefing', title: 'Board prep', why: 'They asked.', objective: 'Prepare the board pack', based_on }],
    model_used: 'm',
  });
  const BOARD = TEXT('m1', 'gmail', 'email', 'Board pack for Thursday', 'Q3 summary please.');
  const LUNCH = TEXT('m2', 'gmail', 'email', 'Lunch', 'Noon?');

  it('is one box with nothing to tick, and lists only the next meetings until asked', async () => {
    render(<ConnectFlow />);
    expect(await screen.findByRole('textbox', { name: 'What are you working on, or looking for?' })).toBeInTheDocument();
    expect(await screen.findByText('Q3 board meeting')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByText('Board pack for Thursday')).not.toBeInTheDocument();
    expect(api.searchConnections).not.toHaveBeenCalled();
    expect(api.suggestWorkflows).not.toHaveBeenCalled();
  });

  it('searches for what was typed and goes straight on to suggestions, listing what it read', async () => {
    const ui = userEvent.setup();
    api.searchConnections.mockResolvedValue(FOUND(BOARD));
    api.suggestWorkflows.mockResolvedValue(SUGGESTED([1]));
    render(<ConnectFlow />);
    await ui.type(await screen.findByRole('textbox'), 'the board pack');
    await ui.click(screen.getByRole('button', { name: 'Search my accounts' }));
    expect(await screen.findByText('Board prep')).toBeInTheDocument();
    expect(api.searchConnections).toHaveBeenCalledWith({ words: 'the board pack' });
    expect(api.suggestWorkflows.mock.calls[0][0].items).toEqual([{ kind: 'email', source: 'gmail · src', title: 'Board pack for Thursday', text: 'Q3 summary please.' }]);
    const read = screen.getByRole('region', { name: 'What PromptMaster read' });
    expect(read).toHaveTextContent('Board pack for Thursday');
    expect(read).not.toHaveTextContent('Q3 summary please.');
    await ui.click(screen.getByRole('button', { name: 'Show text' }));
    expect(read).toHaveTextContent('Q3 summary please.');
  });

  it('searches for what is going on now when nothing is typed', async () => {
    const ui = userEvent.setup();
    api.searchConnections.mockResolvedValue(FOUND(BOARD));
    api.suggestWorkflows.mockResolvedValue(SUGGESTED([1]));
    render(<ConnectFlow />);
    await ui.click(await screen.findByRole('button', { name: 'Search my accounts' }));
    await waitFor(() => expect(api.searchConnections).toHaveBeenCalledWith({ words: '' }));
  });

  it('says so when nothing matched, and makes no suggestions', async () => {
    const ui = userEvent.setup();
    api.searchConnections.mockResolvedValue(FOUND());
    render(<ConnectFlow />);
    await ui.click(await screen.findByRole('button', { name: 'Search my accounts' }));
    expect(await screen.findByText(/Nothing matched/)).toBeInTheDocument();
    expect(api.suggestWorkflows).not.toHaveBeenCalled();
  });

  it('says what could not be read, and why', async () => {
    const ui = userEvent.setup();
    api.searchConnections.mockResolvedValue({ ...FOUND(BOARD), skipped: [{ id: 'm2', title: 'Lunch', reason: 'It could not be read just now.' }] });
    api.suggestWorkflows.mockResolvedValue(SUGGESTED([1]));
    render(<ConnectFlow />);
    await ui.click(await screen.findByRole('button', { name: 'Search my accounts' }));
    expect(await screen.findByText('Lunch: It could not be read just now.')).toBeInTheDocument();
  });

  it('a failed search says so and keeps what was typed', async () => {
    const ui = userEvent.setup();
    api.searchConnections.mockRejectedValue(new Error('Nothing was read.'));
    render(<ConnectFlow />);
    await ui.type(await screen.findByRole('textbox'), 'board');
    await ui.click(screen.getByRole('button', { name: 'Search my accounts' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Nothing was read.');
    expect(screen.getByRole('textbox')).toHaveValue('board');
  });

  it('a press on a meeting searches for it and starts the briefing at once', async () => {
    const ui = userEvent.setup();
    api.searchConnections.mockResolvedValue(FOUND(TEXT('e1', 'googlecalendar', 'calendar_event', 'Q3 board meeting', 'What: Q3 board meeting'), BOARD));
    render(<ConnectFlow />);
    await ui.click(await screen.findByRole('button', { name: 'Brief me for this' }));
    await waitFor(() => expect(startExample).toHaveBeenCalled());
    const asked = api.searchConnections.mock.calls[0][0];
    expect(asked.meeting.id).toBe('e1');
    expect(asked.people[0]).toContain('Da');
    const [example, userId, options] = startExample.mock.calls[0] as unknown as [{ key: string }, string, { own: { third_party: { title: string; when?: string }[]; objective: string } }];
    expect(example.key).toBe('meeting_briefing');
    expect(userId).toBe('u1');
    expect(options.own.third_party.map((i) => i.title)).toEqual(['Q3 board meeting', 'Board pack for Thursday']);
    expect(options.own.third_party[0].when).toBe('2026-11-10T14:00:00Z');
    expect(options.own.objective).toContain('Q3 board meeting');
    expect(goSignedIn).toHaveBeenCalledWith('/projects/project-1');
  });

  it('"Start this" carries the items the suggestion came from to the start screen', async () => {
    const ui = userEvent.setup();
    sessionStorage.clear();
    api.searchConnections.mockResolvedValue(FOUND(BOARD, LUNCH));
    api.suggestWorkflows.mockResolvedValue(SUGGESTED([1]));
    render(<ConnectFlow />);
    await ui.click(await screen.findByRole('button', { name: 'Search my accounts' }));
    await ui.click(await screen.findByRole('button', { name: 'Start this' }));
    expect(goSignedIn).toHaveBeenCalledWith('/projects/new');
    expect(sessionStorage.getItem('pm.start.goal')).toBe('Prepare the board pack');
    expect(JSON.parse(sessionStorage.getItem('pm.start.items') ?? '[]').map((i: { title: string }) => i.title)).toEqual(['Board pack for Thursday']);
  });

  it('what was removed from the list is not carried', async () => {
    const ui = userEvent.setup();
    sessionStorage.clear();
    api.searchConnections.mockResolvedValue(FOUND(BOARD, LUNCH));
    api.suggestWorkflows.mockResolvedValue(SUGGESTED([1, 2]));
    render(<ConnectFlow />);
    await ui.click(await screen.findByRole('button', { name: 'Search my accounts' }));
    await screen.findByText('Board prep');
    await ui.click(screen.getAllByRole('button', { name: 'Remove' })[1]);
    await ui.click(screen.getByRole('button', { name: 'Start this' }));
    expect(JSON.parse(sessionStorage.getItem('pm.start.items') ?? '[]').map((i: { title: string }) => i.title)).toEqual(['Board pack for Thursday']);
  });

  it('adds to the project it was opened from, up to the room it has, and goes back to it', async () => {
    const ui = userEvent.setup();
    const held = Array.from({ length: 19 }, (_x, i) => ({ kind: 'email', source: 's', title: `Held ${i}`, text: 't' }));
    projects.getProject.mockResolvedValue({ id: 'p1', title: 'Board prep', revision: 4, third_party: held });
    projects.updateProject.mockResolvedValue({});
    api.searchConnections.mockResolvedValue(FOUND(BOARD, LUNCH));
    render(<ConnectFlow into="p1" />);
    expect(await screen.findByText(/Say what to add to "Board prep"\. It has room for 1 more\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Brief me for this' })).not.toBeInTheDocument();
    await ui.click(await screen.findByRole('button', { name: 'Search my accounts' }));
    await ui.click(await screen.findByRole('button', { name: 'Add 1 to this project' }));
    await waitFor(() => expect(goSignedIn).toHaveBeenCalledWith('/projects/p1'));
    expect(api.suggestWorkflows).not.toHaveBeenCalled();
    const [id, patch, revision] = projects.updateProject.mock.calls[0] as [string, { third_party: { title: string }[] }, number];
    expect(id).toBe('p1');
    expect(revision).toBe(4);
    expect(patch.third_party).toHaveLength(20);
    expect(patch.third_party[19].title).toBe('Board pack for Thursday');
  });

  it('says so when the project it was opened from is full', async () => {
    const held = Array.from({ length: 20 }, (_x, i) => ({ kind: 'email', source: 's', title: `Held ${i}`, text: 't' }));
    projects.getProject.mockResolvedValue({ id: 'p1', title: 'Board prep', revision: 1, third_party: held });
    render(<ConnectFlow into="p1" />);
    expect(await screen.findByText(/already holds 20/)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Search my accounts' })).toBeDisabled();
  });
});
