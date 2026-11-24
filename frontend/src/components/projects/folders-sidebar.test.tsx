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
    expect(props.onCreate).toHaveBeenCalledWith('Research', null, null);
  });

  // 24 Nov, Sean: "how do I make the workspace folders?" Only the sample could.
  it('makes a workspace, a client inside it and a search inside the client', async () => {
    const tree: ProjectFolder[] = [
      { ...folder('w', 'Larchmere'), kind: 'workspace' },
      { ...folder('c', 'Quillfield', 'w'), kind: 'client' },
    ];
    const props = sidebar({ folders: tree, counts: {} });
    await userEvent.click(screen.getByRole('button', { name: 'New workspace' }));
    await userEvent.type(screen.getByLabelText('Workspace name'), 'Northgate{Enter}');
    expect(props.onCreate).toHaveBeenLastCalledWith('Northgate', null, 'workspace');

    await userEvent.click(screen.getByRole('button', { name: 'New client in Larchmere' }));
    await userEvent.type(screen.getByLabelText('Client name'), 'Acme{Enter}');
    expect(props.onCreate).toHaveBeenLastCalledWith('Acme', 'w', 'client');

    await userEvent.click(screen.getByRole('button', { name: 'New search in Quillfield' }));
    await userEvent.type(screen.getByLabelText('Search name'), 'CFO search{Enter}');
    expect(props.onCreate).toHaveBeenLastCalledWith('CFO search', 'c', 'search');
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
