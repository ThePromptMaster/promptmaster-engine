import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ManuscriptCutNotice, ObjectivePausedNotice } from './stage-status-panels';
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

describe('an objective with a next task that can be done now is open, not paused (26 Oct, production)', () => {
  it('says what can be done now and what waits only for other work, and offers no "I have added it"', () => {
    render(
      <ObjectivePausedNotice
        assessment={{
          ...assessment,
          blockers: [{ need: "The lab's benchmark dataset.", kind: 'data_missing' as const }],
          next_task: { title: 'Upper-row share test', kind: 'check', work: 'Count n per row.', needs: [] },
        }}
        onResume={() => undefined}
      />
    );
    expect(screen.getByText("The objective is still open — next, and it can be done now: Upper-row share test. Missing only for other work: The lab's benchmark dataset")).toBeInTheDocument();
    expect(screen.queryByText('Paused — the objective is not met')).not.toBeInTheDocument();
    expect(screen.queryByText('Waiting for')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume Go' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'I have added it — resume Go' })).not.toBeInTheDocument();
  });

  it('a next task that itself needs the missing item is still a pause', () => {
    render(
      <ObjectivePausedNotice
        assessment={{
          ...assessment,
          blockers: [{ need: "The lab's benchmark dataset.", kind: 'data_missing' as const }],
          next_task: { title: 'Compare with the benchmark', kind: 'check', work: 'Compare.', needs: ["The lab's benchmark dataset."] },
        }}
        onResume={() => undefined}
      />
    );
    expect(screen.getByText('Paused — the objective is not met')).toBeInTheDocument();
  });
});

describe('after two repairs the check stops offering another (5 Nov, a book test)', () => {
  const need = { kind: 'objective_check' as const, stageId: 'finished', finding: 'repair_limit' as const, tried: 2, items: ['The note describes an older draft'] };

  it("the Go card says what is still unmet and offers no further repair", () => {
    const d = describeNeed(need, () => 'Finished book');
    expect(d.message).toContain('tried to fix Finished book 2 times');
    expect(d.message).toContain('The note describes an older draft');
    expect(d.options?.map((o) => o.id)).toEqual(['open', 'finish', 'stop']);
    expect(d.options?.map((o) => o.label).join(' ')).not.toMatch(/Have Go fix/);
  });

  it('the notice takes how to fix it in the user\'s own words, and has no resume button', async () => {
    const onAnswer = vi.fn();
    render(<ObjectivePausedNotice assessment={assessment} onAnswer={onAnswer} answerPrompt="Tell Go how to fix it, in your own words:" />);
    expect(screen.queryByRole('button', { name: 'Resume Go' })).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Tell Go how to fix it, in your own words:'), 'Rewrite only the note');
    await user.click(screen.getByRole('button', { name: /Record it and continue/i }));
    expect(onAnswer).toHaveBeenCalledWith('Rewrite only the note');
  });
});

describe('the notice says which saved text the check read (5 Nov, a book test)', () => {
  const basis = { stage_id: 'finished', stage_label: 'Finished book', version_id: 'v9', version_number: 9, measured: [], assessed: [], not_checked: [] };

  it('the whole of it', () => {
    render(<ObjectivePausedNotice assessment={{ ...assessment, basis: { ...basis, read: { chars: 32246, total: 32246 } } }} />);
    expect(screen.getByText('The check read Finished book v9, all 32,246 characters.')).toBeInTheDocument();
  });

  it('or how much of it, when only part fitted', () => {
    render(<ObjectivePausedNotice assessment={{ ...assessment, basis: { ...basis, read: { chars: 120000, total: 360000 } } }} />);
    expect(screen.getByText(/read 120,000 of the 360,000 characters of Finished book v9/)).toBeInTheDocument();
  });

  it('says nothing on an older record that did not note it', () => {
    render(<ObjectivePausedNotice assessment={{ ...assessment, basis }} />);
    expect(screen.queryByText(/The check read/)).not.toBeInTheDocument();
  });
});

describe('a stage given part of the chapters says so (5 Nov, a book test)', () => {
  it('names what it read and how much, and that the ends were not read', () => {
    render(<ManuscriptCutNotice cut={{ chars: 119500, total: 250000 }} holder="Manuscript" />);
    const note = screen.getByRole('note');
    expect(note).toHaveTextContent('This stage is shown 119,500 of the 250,000 characters in Manuscript.');
    expect(note).toHaveTextContent('not their ends');
  });
});
