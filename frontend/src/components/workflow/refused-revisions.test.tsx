import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RefusedRevisions, refusedSince } from './refused-revisions';
import type { WorkflowEvent } from '@/lib/workflow/types';
import type { ArtifactVersion } from '@/types/project';

const head = { id: 'v3', version_number: 3, created_at: '2026-10-06T10:00:00Z' } as ArtifactVersion;
const refused = (at: string, extra: Partial<WorkflowEvent> = {}): WorkflowEvent => ({
  type: 'revision_refused', stage_id: 'options', actor: 'system', created_at: at,
  reason: 'The revised table came back with no rows, so the current version was kept', ...extra,
});

describe('refused revisions (G1)', () => {
  it('lists only refusals on this stage since the current version was saved', () => {
    const events = [
      refused('2026-10-06T09:00:00Z'),
      refused('2026-10-06T11:00:00Z'),
      refused('2026-10-06T11:05:00Z', { stage_id: 'other' }),
    ];
    expect(refusedSince(events, 'options', head)).toHaveLength(1);
  });

  it("says Go's revision was refused, why, and which version stays current", () => {
    render(<RefusedRevisions refused={[refused('2026-10-06T11:00:00Z')]} head={head} />);
    expect(screen.getByRole('status', { name: 'Refused revision' })).toHaveTextContent(
      'Go mode’s revision was refused: The revised table came back with no rows, so the current version was kept. v3 stays current.'
    );
  });

  it('draws nothing when nothing was refused', () => {
    const { container } = render(<RefusedRevisions refused={[]} head={head} />);
    expect(container).toBeEmptyDOMElement();
  });
});
