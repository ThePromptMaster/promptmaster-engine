import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ProjectTimeline } from './project-timeline';
import type { ArtifactVersion } from '@/types/project';

const version = (id: string, n: number, at: string) =>
  ({ id, version_number: n, source_operation: 'stage_generate', change_summary: n > 1 ? 'Shorter opening' : null, created_at: at }) as ArtifactVersion;

describe('ProjectTimeline (14 Oct call: look back at what was done)', () => {
  it('lists the versions and opens one on its stage', async () => {
    const onOpen = vi.fn();
    render(
      <ProjectTimeline
        template={{ stages: [{ id: 'draft', label: 'Draft' }] } as never}
        events={[]}
        stages={{ draft: { versions: [version('d1', 1, '2026-10-14T09:00:00Z'), version('d2', 2, '2026-10-14T10:00:00Z')] } }}
        onOpen={onOpen}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Timeline' }));
    const dialog = screen.getByRole('dialog', { name: 'Project timeline' });
    expect(dialog).toHaveTextContent('Shorter opening');
    expect(dialog).toHaveTextContent('(current)');
    await userEvent.click(screen.getByRole('button', { name: 'Open Draft v1' }));
    expect(onOpen).toHaveBeenCalledWith('draft', 'd1');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is not offered before anything exists', () => {
    render(<ProjectTimeline template={{ stages: [] } as never} events={[]} stages={{}} onOpen={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Timeline' })).toBeNull();
  });
});
