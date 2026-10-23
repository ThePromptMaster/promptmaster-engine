import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const addReference = vi.fn();
const removeReference = vi.fn();
const setReferenceFacts = vi.fn();
vi.mock('@/lib/supabase/references', () => ({
  addReference: (...a: unknown[]) => addReference(...a),
  removeReference: (...a: unknown[]) => removeReference(...a),
  setReferenceFacts: (...a: unknown[]) => setReferenceFacts(...a),
  listReferences: vi.fn().mockResolvedValue([]),
  loadReferenceMaterial: vi.fn(),
}));
vi.mock('@/lib/supabase/projects', () => ({
  listProjects: vi.fn().mockResolvedValue([
    { id: 'self', title: 'This one', objective: '', folder_id: null },
    { id: 'p2', title: 'Harbor survey', objective: 'What customers want', folder_id: 'f1' },
    { id: 'p3', title: 'Old memo', objective: '', folder_id: null },
  ]),
}));
vi.mock('@/lib/supabase/folders', () => ({
  listFolders: vi.fn().mockResolvedValue([{ id: 'f1', name: 'Clients', parent_id: null, position: 0, user_id: 'u', created_at: '', updated_at: '' }]),
}));

import { ProjectReferences } from './project-references';
import { useProjectStore } from '@/stores/project-store';

const reload = vi.fn().mockResolvedValue(undefined);

describe('Other projects, in the workspace (client, 21 Oct, email 5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProjectStore.setState({ references: [], referenceMaterial: [], reloadReferences: reload });
  });

  it('adds a project picked from the user\'s folders, never this one', async () => {
    addReference.mockResolvedValue({});
    render(<ProjectReferences project={{ id: 'self', user_id: 'u', references: [] }} />);
    await userEvent.click(screen.getByRole('button', { name: /Other projects/ }));
    await userEvent.click(screen.getByRole('button', { name: '+ Use another project' }));
    await waitFor(() => expect(screen.getByText('Clients')).toBeTruthy());
    expect(screen.queryByRole('button', { name: /This one/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Harbor survey/ }));
    expect(addReference).toHaveBeenCalledWith('u', 'self', 'p2');
    expect(reload).toHaveBeenCalled();
  });

  it('lists what each brings, says when one is in the trash, and can stop using it', async () => {
    useProjectStore.setState({
      references: [
        { id: 'r1', project_id: 'self', user_id: 'u', referenced_project_id: 'p2', include_facts: true, position: 0, created_at: '' },
        { id: 'r2', project_id: 'self', user_id: 'u', referenced_project_id: 'p3', include_facts: false, position: 1, created_at: '' },
      ],
    });
    removeReference.mockResolvedValue(undefined);
    render(
      <ProjectReferences
        project={{
          id: 'self', user_id: 'u',
          references: [
            { referenceId: 'r1', projectId: 'p2', title: 'Harbor survey', objective: '', deliverable: 'Final report', text: 'one two three', facts: ['312 responses'], deleted: false, updatedAt: '' },
            { referenceId: 'r2', projectId: 'p3', title: 'Old memo', objective: '', deliverable: '', text: '', facts: [], deleted: true, updatedAt: '' },
          ],
        }}
      />
    );
    expect(screen.getByText(/Final report · about 3 words · 1 fact/)).toBeTruthy();
    expect(screen.getByText(/In the trash/)).toBeTruthy();
    await userEvent.click(screen.getAllByRole('button', { name: 'Stop using' })[1]);
    expect(removeReference).toHaveBeenCalledWith('r2');
  });
});
