import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ObjectivePausedNotice } from './stage-status-panels';
import { describeNeed } from '@/lib/agent/needs';

const assessment = {
  outcome: 'not_met' as const,
  reason: 'The deliverable: at most 500 words — measured 2254 words.',
  basis_quote: '',
  blockers: [],
  performed: [],
  proposed_next: [],
};

describe('the objective pause offers the same action as the Go panel (17 Oct, FIELDGUIDE)', () => {
  it('says what Go is waiting on, in the Go panel\'s words, and does it', async () => {
    const need = { kind: 'objective_check' as const, stageId: 'output', finding: 'unmet' as const, items: ['at most 500 words'] };
    const label = describeNeed(need, () => 'Output').action!;
    expect(label).toBe('Have Go fix Output and check again');
    const onResume = vi.fn();
    render(<ObjectivePausedNotice assessment={assessment} onResume={onResume} resumeLabel={label} />);
    await userEvent.setup().click(screen.getByRole('button', { name: label }));
    expect(onResume).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Resume Go' })).not.toBeInTheDocument();
  });

  it('says "Resume Go" when Go is not waiting on the check', () => {
    render(<ObjectivePausedNotice assessment={assessment} onResume={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Resume Go' })).toBeInTheDocument();
  });
});

describe('gaps the brief allows are carried, not waited for (19 Oct, HARBOR)', () => {
  it('lists them apart from what Go is waiting for, with the words that allow them', () => {
    render(
      <ObjectivePausedNotice
        assessment={{
          ...assessment,
          blockers: [{ need: 'Whether Northbridge pursues at all.', kind: 'needs_decision' as const }],
          limitations: [{ item: 'Who set the $60m EV and on what EBITDA base.', allowed_by: 'Missing diligence evidence may remain as limitations.' }],
        }}
      />
    );
    expect(screen.getByText('Waiting for')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Carried as limitations' })).toHaveTextContent('Who set the $60m EV');
    expect(screen.getByText(/Allowed by: “Missing diligence evidence may remain as limitations.”/)).toBeInTheDocument();
  });
});
