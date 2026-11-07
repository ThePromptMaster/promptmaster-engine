import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ConnectFlow } from './connect-flow';

let auth: { user: { id: string; email: string } | null; isGuest: boolean; loading: boolean } = { user: null, isGuest: false, loading: false };
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => auth }));

const api = {
  listConnections: vi.fn(),
  previewConnections: vi.fn(),
  readConnections: vi.fn(),
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
    api.listConnections.mockResolvedValue({ accounts: [{ id: 'a1', toolkit: 'gmail', label: 'Gmail', status: 'ACTIVE', connected_at: '' }], toolkits: [] });
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

  it('reads nothing until asked, then lists without contents and ticks nothing', async () => {
    const ui = userEvent.setup();
    render(<ConnectFlow />);
    const look = await screen.findByRole('button', { name: "Show what's there" });
    expect(api.previewConnections).not.toHaveBeenCalled();
    await ui.click(look);
    expect(await screen.findByText('Board pack for Thursday')).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox').every((c) => !(c as HTMLInputElement).checked)).toBe(true);
    // A file that can't be read can't be ticked.
    expect(screen.getByRole('checkbox', { name: /Offsite\.mp4/ })).toBeDisabled();
    expect(api.readConnections).not.toHaveBeenCalled();
  });

  it('sends exactly the text shown, as the person left it', async () => {
    const ui = userEvent.setup();
    api.readConnections.mockResolvedValue({ items: [TEXT('m1', 'gmail', 'email', 'Board pack for Thursday', 'Revenue 4.2m against 4.6m.')], files: [], skipped: [] });
    api.suggestWorkflows.mockResolvedValue({ work_summary: '', suggestions: [], model_used: 'm' });
    render(<ConnectFlow />);
    await ui.click(await screen.findByRole('button', { name: "Show what's there" }));
    await ui.click(await screen.findByRole('checkbox', { name: /Board pack for Thursday/ }));
    await ui.click(screen.getByRole('button', { name: 'Read what I ticked' }));
    expect(api.readConnections).toHaveBeenCalledWith([{ id: 'm1', toolkit: 'gmail', kind: 'email', title: 'Board pack for Thursday', ref: {} }]);
    const box = await screen.findByRole('textbox', { name: 'Board pack for Thursday' });
    await ui.clear(box);
    await ui.type(box, 'Only this.');
    await ui.click(screen.getByRole('button', { name: 'Suggest work from these' }));
    await waitFor(() => expect(api.suggestWorkflows).toHaveBeenCalled());
    expect(api.suggestWorkflows.mock.calls[0][0].items).toEqual([{ kind: 'email', source: 'gmail · src', title: 'Board pack for Thursday', text: 'Only this.' }]);
  });

  it('briefs for a meeting with the emails around it, as other people’s words', async () => {
    const ui = userEvent.setup();
    api.readConnections.mockResolvedValue({
      items: [TEXT('m1', 'gmail', 'email', 'Board pack for Thursday', 'Q3 summary please.'), TEXT('e1', 'googlecalendar', 'calendar_event', 'Q3 board meeting', 'What: Q3 board meeting')],
      files: [],
      skipped: [],
    });
    render(<ConnectFlow />);
    await ui.click(await screen.findByRole('button', { name: "Show what's there" }));
    await ui.click(await screen.findByRole('button', { name: 'Brief me for this' }));
    // The meeting and the email from someone invited; not the unrelated lunch.
    await waitFor(() => expect(api.readConnections).toHaveBeenCalled());
    expect(api.readConnections.mock.calls[0][0].map((p: { id: string }) => p.id).sort()).toEqual(['e1', 'm1']);
    expect(await screen.findByText(/written from your brief, never from these/)).toBeInTheDocument();
    await ui.click(screen.getByRole('button', { name: 'Start the briefing' }));
    await waitFor(() => expect(startExample).toHaveBeenCalled());
    const [example, userId, options] = startExample.mock.calls[0] as unknown as [{ key: string }, string, { own: { third_party: unknown[]; objective: string } }];
    expect(example.key).toBe('meeting_briefing');
    expect(userId).toBe('u1');
    // The meeting leads, and both travel as third-party material, never as context.
    expect(options.own.third_party).toEqual([
      { kind: 'calendar_event', source: 'googlecalendar · src', title: 'Q3 board meeting', text: 'What: Q3 board meeting', when: '2026-11-10T14:00:00Z' },
      { kind: 'email', source: 'gmail · src', title: 'Board pack for Thursday', text: 'Q3 summary please.', when: '2026-11-06T09:00:00Z' },
    ]);
    expect(options.own.objective).toContain('Q3 board meeting');
    expect(goSignedIn).toHaveBeenCalledWith('/projects/project-1');
  });

  it('says what could not be read, and why', async () => {
    const ui = userEvent.setup();
    api.readConnections.mockResolvedValue({ items: [TEXT('m1', 'gmail', 'email', 'Board pack for Thursday', 'x')], files: [], skipped: [{ id: 'm2', title: 'Lunch', reason: 'It could not be read just now.' }] });
    render(<ConnectFlow />);
    await ui.click(await screen.findByRole('button', { name: "Show what's there" }));
    await ui.click(await screen.findByRole('checkbox', { name: /Board pack/ }));
    await ui.click(await screen.findByRole('checkbox', { name: /Lunch/ }));
    await ui.click(screen.getByRole('button', { name: 'Read what I ticked' }));
    expect(await screen.findByText('Lunch: It could not be read just now.')).toBeInTheDocument();
  });

  it('"Start this" carries the items the suggestion came from to the start screen', async () => {
    const ui = userEvent.setup();
    sessionStorage.clear();
    api.readConnections.mockResolvedValue({
      items: [TEXT('m1', 'gmail', 'email', 'Board pack for Thursday', 'Pack.'), TEXT('m2', 'gmail', 'email', 'Lunch', 'Noon?')],
      files: [],
      skipped: [],
    });
    api.suggestWorkflows.mockResolvedValue({
      work_summary: '',
      suggestions: [{ example_key: 'meeting_briefing', title: 'Board prep', why: '', objective: 'Prepare the board pack', based_on: [1] }],
      model_used: 'm',
    });
    render(<ConnectFlow />);
    await ui.click(await screen.findByRole('button', { name: "Show what's there" }));
    await ui.click(await screen.findByRole('checkbox', { name: /Board pack/ }));
    await ui.click(screen.getByRole('checkbox', { name: /Lunch/ }));
    await ui.click(screen.getByRole('button', { name: 'Read what I ticked' }));
    await ui.click(await screen.findByRole('button', { name: 'Suggest work from these' }));
    await ui.click(await screen.findByRole('button', { name: 'Start this' }));
    expect(goSignedIn).toHaveBeenCalledWith('/projects/new');
    expect(sessionStorage.getItem('pm.start.goal')).toBe('Prepare the board pack');
    expect(JSON.parse(sessionStorage.getItem('pm.start.items') ?? '[]')).toEqual([
      { kind: 'email', source: 'gmail · src', title: 'Board pack for Thursday', text: 'Pack.', when: '2026-11-06T09:00:00Z' },
    ]);
  });

  it('adds to the project it was opened from, up to the room it has, and goes back to it', async () => {
    const ui = userEvent.setup();
    const held = Array.from({ length: 19 }, (_x, i) => ({ kind: 'email', source: 's', title: `Held ${i}`, text: 't' }));
    projects.getProject.mockResolvedValue({ id: 'p1', title: 'Board prep', revision: 4, third_party: held });
    projects.updateProject.mockResolvedValue({});
    api.readConnections.mockResolvedValue({ items: [TEXT('m1', 'gmail', 'email', 'Board pack for Thursday', 'Pack.')], files: [], skipped: [] });
    render(<ConnectFlow into="p1" />);
    expect(await screen.findByText(/Tick what to add to "Board prep"\. It has room for 1 more\./)).toBeInTheDocument();
    await ui.click(await screen.findByRole('button', { name: "Show what's there" }));
    // No briefing from here: what is ticked goes into the project.
    expect(screen.queryByRole('button', { name: 'Brief me for this' })).not.toBeInTheDocument();
    await ui.click(await screen.findByRole('checkbox', { name: /Board pack/ }));
    expect(screen.getByRole('checkbox', { name: /Lunch/ })).toBeDisabled();
    await ui.click(screen.getByRole('button', { name: 'Read what I ticked' }));
    await ui.click(await screen.findByRole('button', { name: 'Add 1 to this project' }));
    await waitFor(() => expect(goSignedIn).toHaveBeenCalledWith('/projects/p1'));
    const [id, patch, revision] = projects.updateProject.mock.calls[0] as [string, { third_party: { title: string }[] }, number];
    expect(id).toBe('p1');
    expect(revision).toBe(4);
    expect(patch.third_party).toHaveLength(20);
    expect(patch.third_party[19]).toEqual({ kind: 'email', source: 'gmail · src', title: 'Board pack for Thursday', text: 'Pack.', when: '2026-11-06T09:00:00Z' });
  });

  it('says so when the project it was opened from is full', async () => {
    const held = Array.from({ length: 20 }, (_x, i) => ({ kind: 'email', source: 's', title: `Held ${i}`, text: 't' }));
    projects.getProject.mockResolvedValue({ id: 'p1', title: 'Board prep', revision: 1, third_party: held });
    render(<ConnectFlow into="p1" />);
    expect(await screen.findByText(/already holds 20/)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: "Show what's there" })).toBeDisabled();
  });
});
