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
    api.searchConnections.mockReset();
    api.searchConnections.mockResolvedValue({ query: '', matches: 0, items: [], files: [], skipped: [], problems: [] });
    api.suggestWorkflows.mockReset();
    projects.getProject.mockReset();
    projects.updateProject.mockReset();
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

  const ADD = 'Add 1 to this project';

  it('reads by itself when the page opens, with nothing to type, tick or press, and goes straight on to suggestions', async () => {
    const ui = userEvent.setup();
    api.searchConnections.mockResolvedValue(FOUND(BOARD));
    api.suggestWorkflows.mockResolvedValue(SUGGESTED([1]));
    render(<ConnectFlow />);
    expect(await screen.findByText('Board prep')).toBeInTheDocument();
    expect(api.searchConnections).toHaveBeenCalledTimes(1);
    expect(api.searchConnections).toHaveBeenCalledWith({ words: '' });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /search/i })).not.toBeInTheDocument();
    expect(api.suggestWorkflows.mock.calls[0][0].items).toEqual([{ kind: 'email', source: 'gmail · src', title: 'Board pack for Thursday', text: 'Q3 summary please.' }]);
    const read = screen.getByRole('region', { name: 'What PromptMaster read' });
    expect(read).toHaveTextContent('Board pack for Thursday');
    expect(read).not.toHaveTextContent('Q3 summary please.');
    await ui.click(screen.getByRole('button', { name: 'Show text' }));
    expect(read).toHaveTextContent('Q3 summary please.');
  });

  it('reads nothing with no account connected', async () => {
    api.listConnections.mockResolvedValue({ accounts: [], toolkits: [] });
    render(<ConnectFlow />);
    expect(await screen.findByText('Connect an account first.')).toBeInTheDocument();
    expect(api.searchConnections).not.toHaveBeenCalled();
  });

  it('keeps the next meetings listed beside the suggestions, with only the meetings as titles', async () => {
    api.searchConnections.mockResolvedValue(FOUND(BOARD));
    api.suggestWorkflows.mockResolvedValue(SUGGESTED([1]));
    render(<ConnectFlow />);
    await screen.findByText('Board prep');
    expect(await screen.findByRole('button', { name: 'Brief me for this' })).toBeInTheDocument();
    expect(screen.getByText('Q3 board meeting')).toBeInTheDocument();
    expect(screen.queryByText('Lunch')).not.toBeInTheDocument();
  });

  it('says so when there is nothing to work from, and makes no suggestions', async () => {
    render(<ConnectFlow />);
    expect(await screen.findByText('Nothing in your accounts to work from yet.')).toBeInTheDocument();
    expect(api.suggestWorkflows).not.toHaveBeenCalled();
  });

  it('says what could not be read, and why', async () => {
    api.searchConnections.mockResolvedValue({ ...FOUND(BOARD), skipped: [{ id: 'm2', title: 'Lunch', reason: 'It could not be read just now.' }] });
    api.suggestWorkflows.mockResolvedValue(SUGGESTED([1]));
    render(<ConnectFlow />);
    expect(await screen.findByText('Lunch: It could not be read just now.')).toBeInTheDocument();
  });

  it('a failed read says so, and can be tried again', async () => {
    const ui = userEvent.setup();
    api.searchConnections.mockRejectedValueOnce(new Error('Nothing was read.'));
    api.searchConnections.mockResolvedValue(FOUND(BOARD));
    api.suggestWorkflows.mockResolvedValue(SUGGESTED([1]));
    render(<ConnectFlow />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Nothing was read.');
    await ui.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Board prep')).toBeInTheDocument();
    expect(api.searchConnections).toHaveBeenCalledTimes(2);
  });

  it('a press on a meeting searches for it and starts the briefing at once', async () => {
    const ui = userEvent.setup();
    render(<ConnectFlow />);
    await screen.findByText('Nothing in your accounts to work from yet.');
    api.searchConnections.mockResolvedValue(FOUND(TEXT('e1', 'googlecalendar', 'calendar_event', 'Q3 board meeting', 'What: Q3 board meeting'), BOARD));
    await ui.click(await screen.findByRole('button', { name: 'Brief me for this' }));
    await waitFor(() => expect(startExample).toHaveBeenCalled());
    const asked = api.searchConnections.mock.calls[1][0];
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

  it('a press on a meeting replaces the read still under way', async () => {
    const ui = userEvent.setup();
    let finish: (value: unknown) => void = () => undefined;
    api.searchConnections.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    api.searchConnections.mockResolvedValue(FOUND(TEXT('e1', 'googlecalendar', 'calendar_event', 'Q3 board meeting', 'What: Q3 board meeting')));
    render(<ConnectFlow />);
    await ui.click(await screen.findByRole('button', { name: 'Brief me for this' }));
    await waitFor(() => expect(startExample).toHaveBeenCalled());
    finish(FOUND(BOARD));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.suggestWorkflows).not.toHaveBeenCalled();
  });

  it('opened to prepare for a meeting, reads nothing until one is chosen', async () => {
    render(<ConnectFlow briefing />);
    expect(await screen.findByRole('button', { name: 'Brief me for this' })).toBeInTheDocument();
    expect(api.searchConnections).not.toHaveBeenCalled();
    expect(api.suggestWorkflows).not.toHaveBeenCalled();
  });

  it('opened to prepare for a meeting with none coming up, says so', async () => {
    api.previewConnections.mockResolvedValue({ items: [], problems: [] });
    render(<ConnectFlow briefing />);
    expect(await screen.findByText('No meetings coming up in your calendar.')).toBeInTheDocument();
  });

  it('"Start this" carries the items the suggestion came from to the start screen', async () => {
    const ui = userEvent.setup();
    sessionStorage.clear();
    api.searchConnections.mockResolvedValue(FOUND(BOARD, LUNCH));
    api.suggestWorkflows.mockResolvedValue(SUGGESTED([1]));
    render(<ConnectFlow />);
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
    await screen.findByText('Board prep');
    await ui.click(screen.getAllByRole('button', { name: 'Remove' })[1]);
    await ui.click(screen.getByRole('button', { name: 'Start this' }));
    expect(JSON.parse(sessionStorage.getItem('pm.start.items') ?? '[]').map((i: { title: string }) => i.title)).toEqual(['Board pack for Thursday']);
  });

  const HELD = (n: number) => Array.from({ length: n }, (_x, i) => ({ kind: 'email', source: 's', title: `Held ${i}`, text: 't' }));

  it('from a project, searches for its own words, adds what fits with no press, and goes back', async () => {
    projects.getProject.mockResolvedValue({ id: 'p1', title: 'Board prep', objective: 'A two-page Q3 summary', revision: 4, third_party: HELD(19) });
    projects.updateProject.mockResolvedValue({});
    api.searchConnections.mockResolvedValue(FOUND(BOARD, LUNCH));
    render(<ConnectFlow into="p1" />);
    expect(await screen.findByText(/It has room for 1 more\./)).toBeInTheDocument();
    await waitFor(() => expect(goSignedIn).toHaveBeenCalledWith('/projects/p1'));
    expect(api.searchConnections).toHaveBeenCalledTimes(1);
    expect(api.searchConnections).toHaveBeenCalledWith({ words: 'Board prep: A two-page Q3 summary' });
    expect(api.suggestWorkflows).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Brief me for this' })).not.toBeInTheDocument();
    const [id, patch, revision] = projects.updateProject.mock.calls[0] as [string, { third_party: { title: string }[] }, number];
    expect(id).toBe('p1');
    expect(revision).toBe(4);
    expect(patch.third_party).toHaveLength(20);
    expect(patch.third_party[19].title).toBe('Board pack for Thursday');
  });

  it('from a project, what it already holds does not use up its room', async () => {
    const heldBoard = { kind: 'email', source: 'gmail · src', title: 'Board pack for Thursday', text: 'Q3 summary please.' };
    projects.getProject.mockResolvedValue({ id: 'p1', title: 'Board prep', objective: '', revision: 2, third_party: [...HELD(18), heldBoard] });
    projects.updateProject.mockResolvedValue({});
    api.searchConnections.mockResolvedValue(FOUND(BOARD, LUNCH));
    render(<ConnectFlow into="p1" />);
    await waitFor(() => expect(projects.updateProject).toHaveBeenCalled());
    expect(api.searchConnections).toHaveBeenCalledWith({ words: 'Board prep' });
    const patch = projects.updateProject.mock.calls[0][1] as { third_party: { title: string }[] };
    expect(patch.third_party.map((i) => i.title).slice(-2)).toEqual(['Board pack for Thursday', 'Lunch']);
  });

  it('from a project, says so when there is nothing new, and changes nothing', async () => {
    const heldBoard = { kind: 'email', source: 'gmail · src', title: 'Board pack for Thursday', text: 'Q3 summary please.' };
    projects.getProject.mockResolvedValue({ id: 'p1', title: 'Board prep', objective: '', revision: 2, third_party: [heldBoard] });
    api.searchConnections.mockResolvedValue(FOUND(BOARD));
    render(<ConnectFlow into="p1" />);
    expect(await screen.findByText('Nothing new in your accounts for this project.')).toBeInTheDocument();
    expect(projects.updateProject).not.toHaveBeenCalled();
    expect(goSignedIn).not.toHaveBeenCalled();
  });

  it('from a project, a failed save says so and offers the exact count again', async () => {
    const ui = userEvent.setup();
    projects.getProject.mockResolvedValue({ id: 'p1', title: 'Board prep', objective: 'Q3', revision: 1, third_party: [] });
    projects.updateProject.mockRejectedValueOnce(new Error('Not saved.'));
    projects.updateProject.mockResolvedValue({});
    api.searchConnections.mockResolvedValue(FOUND(BOARD));
    render(<ConnectFlow into="p1" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Not saved.');
    await ui.click(screen.getByRole('button', { name: ADD }));
    await waitFor(() => expect(goSignedIn).toHaveBeenCalledWith('/projects/p1'));
    expect(api.searchConnections).toHaveBeenCalledTimes(1);
  });

  it('says so when the project it was opened from is full, and reads nothing', async () => {
    projects.getProject.mockResolvedValue({ id: 'p1', title: 'Board prep', objective: 'Q3', revision: 1, third_party: HELD(20) });
    render(<ConnectFlow into="p1" />);
    expect(await screen.findByText(/already holds 20/)).toBeInTheDocument();
    expect(api.searchConnections).not.toHaveBeenCalled();
  });
});
