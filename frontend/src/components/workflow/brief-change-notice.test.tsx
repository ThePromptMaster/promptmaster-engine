import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

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
          { stageId: 'figures', version: 2, by: 'go', check: 'none', count: 0 },
          { stageId: 'draft', version: 3, by: 'you', check: 'clean', count: 0 },
          { stageId: 'check', version: null, by: null, check: 'table', count: 2 },
          { stageId: 'final', version: 4, by: 'go', check: 'not_checked', count: 0 },
        ]}
      />
    );
    expect(screen.getByText('Facts and calculations: updated to v2 by Go')).toBeTruthy();
    expect(screen.getByText('Draft memo: updated to v3 by you — checked, nothing noted')).toBeTruthy();
    expect(screen.getByText('Check: finished again as it was — 2 findings undecided')).toBeTruthy();
    expect(screen.getByText('Final memo: updated to v4 by Go — not checked since the change')).toBeTruthy();
  });
});

describe('after a change: still usable, being redone, needs you (L-277, 22 Nov, Sean)', () => {
  const label = (id: string) => ({ brief: 'Brief', costs: 'Costs and eligibility', draft: 'Draft memo', approve: 'Approve an option', final: 'Final memo' })[id] ?? id;
  const event = { type: 'brief_changed', stage_id: 'final', actor: 'user', created_at: '2026-11-22T20:00:00Z', payload: { field: 'facts', kind: 'fact', affected: [{ stage_id: 'costs', reason: 'raw' }] } } as never;

  it('names each group, says the choice waits for the update, and opens the stage once it can be made', () => {
    const onOpen = vi.fn();
    const { rerender } = render(
      <BriefChangeNotice
        change={{ event, stageIds: ['costs'] }}
        stageLabel={label}
        onKeep={() => undefined}
        onOpenStage={onOpen}
        summary={{
          usable: [{ stageId: 'brief' }],
          redoing: [{ stageId: 'costs', state: 'waiting', reason: 'It uses “Option B: card readers $1,975”, which has changed.' }],
          needsYou: [{ kind: 'decision', stageId: 'approve', choice: 'Option B', because: 'Option B: card readers $1,975', waitingOn: ['costs'] }],
        }}
      />
    );
    const usable = document.querySelector('[data-group="usable"]')!;
    expect(usable.textContent).toContain('Still usable');
    expect(usable.textContent).toContain('Brief');
    const redo = document.querySelector('[data-group="redo"]')!;
    expect(redo.textContent).toContain('Being redone');
    expect(redo.textContent).toContain('Costs and eligibility: It uses “Option B: card readers $1,975”, which has changed.');
    // The raw reason from the event is not listed beside it.
    expect(screen.queryByText(/: raw$/)).toBeNull();
    const you = document.querySelector('[data-group="you"]')!;
    expect(you.textContent).toContain('You chose Option B on Approve an option.');
    expect(you.textContent).toContain('You can choose once Costs and eligibility is updated.');
    expect(screen.queryByRole('button', { name: 'Choose again' })).toBeNull();

    rerender(
      <BriefChangeNotice
        change={null}
        settled={{ event, stageIds: ['costs'] }}
        stageLabel={label}
        onKeep={() => undefined}
        onOpenStage={onOpen}
        summary={{
          usable: [{ stageId: 'brief' }, { stageId: 'draft', kept: 'checked' }],
          redoing: [{ stageId: 'costs', state: 'updated', version: 3, by: 'go' }],
          needsYou: [{ kind: 'decision', stageId: 'approve', choice: 'Option B', because: 'x', waitingOn: [] }],
        }}
      />
    );
    expect(document.querySelector('[data-group="usable"]')!.textContent).toContain('Draft memo: checked against the change and kept as it was');
    expect(document.querySelector('[data-group="redo"]')!.textContent).toContain('Redone');
    expect(document.querySelector('[data-group="redo"]')!.textContent).toContain('updated to v3 by Go');
    fireEvent.click(screen.getByRole('button', { name: 'Choose again' }));
    expect(onOpen).toHaveBeenCalledWith('approve');
  });

  it('says so when nothing needs the user', () => {
    render(
      <BriefChangeNotice change={null} settled={{ event, stageIds: ['costs'] }} stageLabel={label} onKeep={() => undefined}
        summary={{ usable: [{ stageId: 'brief' }], redoing: [{ stageId: 'costs', state: 'updated', version: 2, by: 'go' }], needsYou: [] }} />
    );
    expect(document.querySelector('[data-group="you"]')!.textContent).toContain('nothing needs your judgment.');
  });
});
