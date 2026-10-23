import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SINGLE_OUTPUT_V1, projectState } from '@/lib/workflow';

vi.mock('@/lib/supabase/projects', () => ({
  listProjects: vi.fn(async () => [
    { id: 'p1', title: 'This one', objective: '', workflow: 'single_output', folder_id: null },
    { id: 'p2', title: 'The harbor study', objective: 'Costs', workflow: 'single_output', folder_id: null },
  ]),
}));
vi.mock('@/lib/supabase/folders', () => ({ listFolders: vi.fn(async () => []) }));
vi.mock('@/lib/supabase/reading', () => ({
  loadProjectForReading: vi.fn(async () => ({
    project: { id: 'p2', title: 'The harbor study' },
    template: SINGLE_OUTPUT_V1,
    state: projectState(SINGLE_OUTPUT_V1, [], 'output'),
    bundles: { output: { artifact: { stage_id: 'output' }, versions: [{ id: 'v', content: '## Costs\n\nThey rose.\n\n## Risks\n\nFew.' }] } },
  })),
}));

import { ProjectReaderPane } from './project-reader-pane';

const props = () => ({
  currentProjectId: 'p1',
  onChoose: vi.fn(),
  onClose: vi.fn(),
  onSendToChat: vi.fn(),
  onUseAsReference: vi.fn(async () => {}),
});

beforeEach(() => vi.clearAllMocks());

describe('the project read beside this one (client feedback, 21 Oct, email 4)', () => {
  it('offers the other projects, not this one', async () => {
    const p = props();
    render(<ProjectReaderPane {...p} readingId={null} />);
    await userEvent.setup().click(await screen.findByRole('button', { name: /The harbor study/ }));
    expect(screen.queryByRole('button', { name: /This one/ })).toBeNull();
    expect(p.onChoose).toHaveBeenCalledWith('p2');
  });

  it('shows its stage in sections, each sent to the chat as a quote with its source', async () => {
    const p = props();
    const user = userEvent.setup();
    render(<ProjectReaderPane {...p} readingId="p2" />);
    expect(await screen.findByText('Costs')).toBeInTheDocument();
    const sends = screen.getAllByRole('button', { name: 'Send this section to the side chat' });
    expect(sends).toHaveLength(2);
    await user.click(sends[1]);
    expect(p.onSendToChat).toHaveBeenCalledWith(expect.stringContaining('> **Risks**'));
    expect(p.onSendToChat.mock.calls[0][0]).toContain('From "The harbor study" — ');
  });

  it('uses it as a reference once, and says so when it already is one', async () => {
    const p = props();
    const user = userEvent.setup();
    const { rerender } = render(<ProjectReaderPane {...p} readingId="p2" />);
    await user.click(await screen.findByRole('button', { name: 'Use as reference in this project' }));
    expect(p.onUseAsReference).toHaveBeenCalledWith('p2');
    rerender(<ProjectReaderPane {...p} readingId="p2" referenced />);
    expect(screen.getByRole('button', { name: 'Used as a reference here' })).toBeDisabled();
  });
});
