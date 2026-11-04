import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { BriefChangeNotice } from './brief-change-notice';
import type { WorkflowEvent } from '@/lib/workflow/types';

const event = { type: 'brief_changed', stage_id: 'figures', created_at: '2026-11-04T12:00:00Z', payload: { field: 'facts', affected: [] } } as unknown as WorkflowEvent;
const label = (id: string) => ({ figures: 'Facts and calculations', draft: 'Draft memo', check: 'Check', final: 'Final memo' })[id] ?? id;

describe('the settled change says what became of each stage (4 Nov, Sean)', () => {
  it('lists each stage: its version and who made it, and what its check found', () => {
    render(
      <BriefChangeNotice
        change={null}
        stageLabel={label}
        onKeep={() => undefined}
        settled={{ event, stageIds: ['figures', 'draft', 'check', 'final'] }}
        outcomes={[
          { stageId: 'figures', version: 2, by: 'go', check: 'table', count: 0 },
          { stageId: 'draft', version: 3, by: 'you', check: 'clean', count: 0 },
          { stageId: 'check', version: null, by: null, check: 'table', count: 2 },
          { stageId: 'final', version: 4, by: 'go', check: 'not_checked', count: 0 },
        ]}
      />
    );
    expect(screen.getByText('Facts and calculations: updated to v2 by Go — every finding decided')).toBeTruthy();
    expect(screen.getByText('Draft memo: updated to v3 by you — checked, nothing noted')).toBeTruthy();
    expect(screen.getByText('Check: finished again as it was — 2 findings undecided')).toBeTruthy();
    expect(screen.getByText('Final memo: updated to v4 by Go — not checked since the change')).toBeTruthy();
  });
});
