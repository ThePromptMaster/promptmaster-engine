import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { FoldersSidebar } from './folders-sidebar';
import { MoveToMenu } from './move-to-menu';
import type { ProjectFolder } from '@/types/project';

const folder = (id: string, name: string, parent_id: string | null = null): ProjectFolder => ({
  id, name, parent_id, position: 0, user_id: 'u', created_at: '', updated_at: '',
});
const FOLDERS = [folder('a', 'Clients'), folder('b', 'Acme', 'a')];

function sidebar(overrides: Partial<Parameters<typeof FoldersSidebar>[0]> = {}) {
  const props = {
    folders: FOLDERS,
    counts: { '': 2, a: 1, b: 3 },
    selected: 'all',
    onSelect: vi.fn(),
    onCreate: vi.fn().mockResolvedValue(undefined),
    onRename: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
    onDropProject: vi.fn(),
    ...overrides,
  };
  render(<FoldersSidebar {...props} />);
  return props;
}

describe('the folders sidebar (client, 21 Oct, email 5)', () => {
  it('shows all projects, Unfiled and the nested folders with their counts', async () => {
    const props = sidebar();
    expect(screen.getByRole('button', { name: /All projects\s*6/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Unfiled\s*2/ })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /Acme\s*3/ }));
    expect(props.onSelect).toHaveBeenCalledWith('b');
  });

  it('makes a folder from its name', async () => {
    const props = sidebar();
    await userEvent.click(screen.getByRole('button', { name: 'New folder' }));
    await userEvent.type(screen.getByLabelText('Folder name'), 'Research{Enter}');
    expect(props.onCreate).toHaveBeenCalledWith('Research', null, null, null);
  });

  // 24 Nov, Sean: "how do I make the workspace folders?" Only the sample could.
  it('makes a workspace, a client inside it and a search inside the client', async () => {
    const tree: ProjectFolder[] = [
      { ...folder('w', 'Larchmere'), kind: 'workspace' },
      { ...folder('c', 'Quillfield', 'w'), kind: 'client' },
    ];
    const props = sidebar({ folders: tree, counts: {} });
    await userEvent.click(screen.getByRole('button', { name: 'New workspace' }));
    await userEvent.click(screen.getByRole('button', { name: /^Executive search/ }));
    await userEvent.type(screen.getByLabelText('Workspace name'), 'Northgate{Enter}');
    expect(props.onCreate).toHaveBeenLastCalledWith('Northgate', null, 'workspace', 'executive_search');

    await userEvent.click(screen.getByRole('button', { name: 'New client in Larchmere' }));
    await userEvent.type(screen.getByLabelText('Client name'), 'Acme{Enter}');
    expect(props.onCreate).toHaveBeenLastCalledWith('Acme', 'w', 'client', null);

    await userEvent.click(screen.getByRole('button', { name: 'New search in Quillfield' }));
    await userEvent.type(screen.getByLabelText('Search name'), 'CFO search{Enter}');
    expect(props.onCreate).toHaveBeenLastCalledWith('CFO search', 'c', 'search', null);
  });

  // 26 Nov, Sean: "a blank workspace with regular folders and subfolders … like location or department".
  it('makes a blank workspace, with plain folders inside it at every level', async () => {
    const tree: ProjectFolder[] = [
      { ...folder('b', 'Harbor Foods'), kind: 'workspace', layout: 'blank' },
      { ...folder('l', 'London', 'b'), kind: 'folder' },
    ];
    const props = sidebar({ folders: tree, counts: {} });
    await userEvent.click(screen.getByRole('button', { name: 'New workspace' }));
    expect(screen.getByRole('group', { name: 'What kind of workspace?' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Blank workspace/ }));
    await userEvent.type(screen.getByLabelText('Workspace name'), 'Retail{Enter}');
    expect(props.onCreate).toHaveBeenLastCalledWith('Retail', null, 'workspace', 'blank');

    await userEvent.click(screen.getByRole('button', { name: 'New folder in Harbor Foods' }));
    await userEvent.type(screen.getByLabelText('Folder name'), 'Leeds{Enter}');
    expect(props.onCreate).toHaveBeenLastCalledWith('Leeds', 'b', 'folder', null);

    await userEvent.click(screen.getByRole('button', { name: 'New folder in London' }));
    await userEvent.type(screen.getByLabelText('Folder name'), 'Finance{Enter}');
    expect(props.onCreate).toHaveBeenLastCalledWith('Finance', 'l', 'folder', null);
  });

  it('asks before deleting, and says the projects are kept', async () => {
    const props = sidebar();
    await userEvent.click(screen.getByRole('button', { name: 'Delete Clients' }));
    expect(screen.getByRole('alert').textContent).toMatch(/projects go to Unfiled .* No project is deleted/);
    expect(props.onDelete).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Delete folder' }));
    expect(props.onDelete).toHaveBeenCalledWith('a');
  });
});

describe('Move to, from a project card', () => {
  it('files the project in the chosen folder, or Unfiled', async () => {
    const onMove = vi.fn();
    render(<MoveToMenu projectTitle="Survey" folderId="a" folders={FOLDERS} onMove={onMove} />);
    await userEvent.click(screen.getByRole('button', { name: 'Move Survey to a folder' }));
    expect(screen.getByRole('menuitemradio', { name: /Clients/ }).getAttribute('aria-checked')).toBe('true');
    await userEvent.click(screen.getByRole('menuitemradio', { name: /Acme/ }));
    expect(onMove).toHaveBeenCalledWith('b');
  });

  it('does nothing when the current folder is picked again', async () => {
    const onMove = vi.fn();
    render(<MoveToMenu projectTitle="Survey" folderId={null} folders={FOLDERS} onMove={onMove} />);
    await userEvent.click(screen.getByRole('button', { name: 'Move Survey to a folder' }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: /Unfiled/ }));
    expect(onMove).not.toHaveBeenCalled();
  });
});

// 26 Nov, Sean: "It says you're allowed to drag the projects into the folders, but I don't think it's working."
describe('dropping a project on a folder (26 Nov)', () => {
  const transfer = (types: string[], data: Record<string, string> = {}) => ({
    types,
    getData: (k: string) => data[k] ?? '',
    setData: () => undefined,
    dropEffect: 'none',
    effectAllowed: 'all',
  });

  it('takes a drop anywhere on the folder row, its action icons included, once', async () => {
    const { fireEvent } = await import('@testing-library/react');
    const { PROJECT_DRAG_TYPE } = await import('@/lib/projects/project-drag');
    const props = sidebar();
    const rowWrapper = document.querySelector('[data-drop-target="b"]') as HTMLElement;
    const icon = screen.getByRole('button', { name: 'Rename Acme' });
    const dt = transfer([PROJECT_DRAG_TYPE], { [PROJECT_DRAG_TYPE]: 'p1' });
    fireEvent.dragOver(icon, { dataTransfer: dt });
    fireEvent.drop(icon, { dataTransfer: dt });
    expect(rowWrapper.contains(icon)).toBe(true);
    expect(props.onDropProject).toHaveBeenCalledTimes(1);
    expect(props.onDropProject).toHaveBeenCalledWith('p1', 'b');
  });

  it('takes the drop when the browser hides the custom type during the drag', async () => {
    const { fireEvent } = await import('@testing-library/react');
    const { beginProjectDrag, endProjectDrag } = await import('@/lib/projects/project-drag');
    const props = sidebar();
    beginProjectDrag(null, 'p2');
    const dt = transfer(['text/uri-list']);
    const unfiled = screen.getByRole('button', { name: /Unfiled/ });
    const over = fireEvent.dragOver(unfiled, { dataTransfer: dt });
    expect(over).toBe(false); // preventDefault: the drop is allowed
    fireEvent.drop(unfiled, { dataTransfer: dt });
    endProjectDrag();
    expect(props.onDropProject).toHaveBeenCalledWith('p2', null);
  });

  it('refuses anything that is not a project card', async () => {
    const { fireEvent } = await import('@testing-library/react');
    const props = sidebar();
    const unfiled = screen.getByRole('button', { name: /Unfiled/ });
    const over = fireEvent.dragOver(unfiled, { dataTransfer: transfer(['Files']) });
    expect(over).toBe(true);
    fireEvent.drop(unfiled, { dataTransfer: transfer(['Files']) });
    expect(props.onDropProject).not.toHaveBeenCalled();
  });

  // 26 Nov pass: a hint above the rows pushed them down mid-drag, and a card aimed at one
  // folder landed in the one above it.
  it('adds nothing above the rows while a card is dragged, and hides the folder actions', () => {
    sidebar({ dragging: 'Board note' });
    expect(screen.queryByRole('status')).toBeNull();
    const nav = screen.getByRole('navigation');
    expect(nav.firstElementChild?.textContent).toMatch(/All projects/);
    expect(screen.queryByRole('button', { name: 'Rename Acme' })?.parentElement?.className).not.toMatch(/group-hover:flex/);
  });
});
