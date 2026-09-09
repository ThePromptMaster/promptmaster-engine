/**
 * FR-20's deletion half.
 *
 * "Destructive deletion requires confirmation" is the acceptance criterion, and
 * the criterion has to hold at *both* destructive steps — the soft delete on
 * the list, which already confirmed, and the permanent one here, which had no
 * UI at all. A trash view whose Delete button fired immediately would satisfy
 * the letter of the requirement while breaking the thing it protects.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DeletedProjects, daysLeft } from './deleted-projects';

const listDeletedProjects = vi.fn();
const restoreProject = vi.fn();
const hardDeleteProject = vi.fn();

vi.mock('@/lib/supabase/projects', () => ({
  listDeletedProjects: (...a: unknown[]) => listDeletedProjects(...a),
  restoreProject: (...a: unknown[]) => restoreProject(...a),
  hardDeleteProject: (...a: unknown[]) => hardDeleteProject(...a),
}));

const ROW = {
  id: 'p1',
  title: 'Governing AI-assisted work',
  objective: 'A field guide.',
  mode: 'architect',
  workflow: 'book',
  stage: 'research',
  status: 'active',
  updated_at: '2026-09-04T00:00:00Z',
  created_at: '2026-09-01T00:00:00Z',
  deleted_at: '2026-09-06T00:00:00Z',
};

beforeEach(() => {
  // These are module-level fns, not spies, so restoreMocks does not clear them.
  vi.clearAllMocks();
  listDeletedProjects.mockResolvedValue([ROW]);
  restoreProject.mockResolvedValue(undefined);
  hardDeleteProject.mockResolvedValue(undefined);
});

async function openTrash() {
  render(<DeletedProjects />);
  await userEvent.click(screen.getByRole('button', { name: /recently deleted/i }));
  return screen.findByText('Governing AI-assisted work');
}

describe('the trash view', () => {
  it('stays closed until asked for', () => {
    render(<DeletedProjects />);
    expect(listDeletedProjects).not.toHaveBeenCalled();
    expect(screen.queryByText('Governing AI-assisted work')).toBeNull();
  });

  it('says how long is left rather than only that it is deleted', async () => {
    await openTrash();
    // A retention window nobody can see is indistinguishable from a promise
    // that the row is kept forever — which is what it used to be.
    expect(screen.getByText(/removed for good in \d+ days|due to be removed/i)).toBeTruthy();
    expect(screen.getByText(/kept for 30 days/i)).toBeTruthy();
  });

  it('restores a project', async () => {
    await openTrash();
    await userEvent.click(screen.getByRole('button', { name: /restore/i }));

    expect(restoreProject).toHaveBeenCalledWith('p1');
    await waitFor(() =>
      expect(screen.queryByText('Governing AI-assisted work')).toBeNull()
    );
  });

  it('requires confirmation before deleting permanently', async () => {
    await openTrash();

    await userEvent.click(screen.getByRole('button', { name: /delete now/i }));
    expect(hardDeleteProject).not.toHaveBeenCalled();
    expect(screen.getByText(/cannot be undone/i)).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: /delete permanently/i }));
    expect(hardDeleteProject).toHaveBeenCalledWith('p1');
  });

  it('lets a user back out of the confirmation', async () => {
    await openTrash();

    await userEvent.click(screen.getByRole('button', { name: /delete now/i }));
    await userEvent.click(screen.getByRole('button', { name: /^keep$/i }));

    expect(hardDeleteProject).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /delete now/i })).toBeTruthy();
  });

  it('surfaces a failed delete rather than pretending it worked', async () => {
    hardDeleteProject.mockRejectedValue(new Error('permission denied'));
    await openTrash();

    await userEvent.click(screen.getByRole('button', { name: /delete now/i }));
    await userEvent.click(screen.getByRole('button', { name: /delete permanently/i }));

    expect(await screen.findByText('permission denied')).toBeTruthy();
    expect(screen.getByText('Governing AI-assisted work')).toBeTruthy();
  });

  it('says so when there is nothing there', async () => {
    listDeletedProjects.mockResolvedValue([]);
    render(<DeletedProjects />);
    await userEvent.click(screen.getByRole('button', { name: /recently deleted/i }));
    expect(await screen.findByText('Nothing deleted.')).toBeTruthy();
  });
});

describe('the retention clock', () => {
  const deleted = '2026-09-01T00:00:00Z';

  it('counts down from thirty', () => {
    expect(daysLeft(deleted, Date.parse('2026-09-01T00:00:00Z'))).toBe(30);
    expect(daysLeft(deleted, Date.parse('2026-09-21T00:00:00Z'))).toBe(10);
  });

  it('never goes negative once the window has passed', () => {
    expect(daysLeft(deleted, Date.parse('2026-11-01T00:00:00Z'))).toBe(0);
  });
});
