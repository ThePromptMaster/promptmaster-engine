import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { NeedsUser } from '@/lib/agent/needs';
import { openMajorFindings, type OutstandingItem } from '@/lib/workflow/engine';
import type { CriterionResult } from '@/lib/workflow/types';

import { NeedsYouCard } from './agent/needs-you-card';
import { ExitCriteriaChecklist } from './exit-criteria-checklist';

const major = { id: 'i14', text: 'Document 4 disagrees with the Core plan.', severity: 'major' };
const minor = { id: 'i2', text: 'A typo.', severity: 'minor' };
const approval: CriterionResult = { id: 'a', label: 'I approve this package', satisfied: false, blocking: true, manual: true } as CriterionResult;

describe('a major finding open asks why before approving (8 Nov)', () => {
  it('finds major findings in any table, optional or not, and no others', () => {
    const items = [
      { kind: 'open_findings', stageId: 's', label: 'Check', count: 2, optional: true, rows: [major, minor] },
      { kind: 'stale_stage', stageId: 't', label: 'Plan', reason: 'x' },
    ] as OutstandingItem[];
    expect(openMajorFindings(items).map((r) => r.id)).toEqual(['i14']);
  });

  it('the checklist holds the tick until a reason is given, and passes it on', () => {
    const onToggle = vi.fn();
    render(<ExitCriteriaChecklist criteria={[approval]} onToggleManual={onToggle} openMajors={[major]} headVersion={7} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onToggle).not.toHaveBeenCalled();
    expect(screen.getByText(/Document 4 disagrees/)).toBeTruthy();
    const send = screen.getByRole('button', { name: 'Approve with this reason' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(document.querySelector('[data-major-open] textarea') as HTMLTextAreaElement, { target: { value: 'The sponsor accepted this risk.' } });
    fireEvent.click(send);
    expect(onToggle).toHaveBeenCalledWith('a', true, 'The sponsor accepted this risk.');
  });

  it('with no major finding the tick goes through, and says which version it is for', () => {
    const onToggle = vi.fn();
    render(<ExitCriteriaChecklist criteria={[approval]} onToggleManual={onToggle} headVersion={7} />);
    expect(screen.getByText('Ticking records your approval on version 7.')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onToggle).toHaveBeenCalledWith('a', true);
  });

  it('a routine approval is not asked why', () => {
    const onToggle = vi.fn();
    render(<ExitCriteriaChecklist criteria={[{ ...approval, authority: 'delegable' } as CriterionResult]} onToggleManual={onToggle} openMajors={[major]} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onToggle).toHaveBeenCalledWith('a', true);
  });

  it('Go’s approval card waits for the reason too', () => {
    const onAction = vi.fn(async () => undefined);
    const need = { kind: 'tick_criterion', stageId: 's', criterionId: 'a', label: 'I approve this package', authority: 'reserved', openRows: [{ ...major, stageId: 'c', stageLabel: 'Check' }, { ...minor, stageId: 'c', stageLabel: 'Check' }] } as unknown as NeedsUser;
    render(<NeedsYouCard need={need} stageLabel={() => 'Stage'} onAction={onAction} />);
    const approve = screen.getByRole('button', { name: /Approve and resume/ }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    fireEvent.change(document.querySelector('[data-approve-why]') as HTMLTextAreaElement, { target: { value: 'Accepted for now.' } });
    fireEvent.click(approve);
    expect(onAction).toHaveBeenCalledWith(undefined, 'Accepted for now.');
  });
});
