/**
 * Sean, 23 Oct: "the number of my workflow presets are getting outrageous lol
 * maybe a way to delete or store them".
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { RemovedWorkflows, WorkflowPicker } from './workflow-picker';
import type { WorkflowTemplate } from '@/lib/workflow/types';

const T = [
  { id: 't-so', key: 'single_output', name: 'Single output', description: 'x', version: 5, outline_stage: 'none', stages: [] },
  { id: 't-mine', key: 'custom_abc', name: 'Vendor memo', description: 'Mine', version: 1, outline_stage: 'none', stages: [] },
] as unknown as (WorkflowTemplate & { id: string })[];

describe('presets you can tidy', () => {
  it('only a workflow you designed can be taken off the list', async () => {
    const onRemove = vi.fn();
    render(<WorkflowPicker templates={T} selectedId="t-so" onSelect={() => {}} onRemove={onRemove} />);
    expect(screen.queryByRole('button', { name: /Remove Single output/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove Vendor memo from this list' }));
    expect(onRemove).toHaveBeenCalledWith(T[1]);
  });

  it('removed ones are listed to put back, and nothing shows when there are none', async () => {
    const onRestore = vi.fn();
    const { container, rerender } = render(<RemovedWorkflows templates={[]} onRestore={onRestore} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<RemovedWorkflows templates={[T[1]]} onRestore={onRestore} />);
    await userEvent.click(screen.getByText('1 workflow removed from this list'));
    await userEvent.click(screen.getByRole('button', { name: 'Put back' }));
    expect(onRestore).toHaveBeenCalledWith(T[1]);
  });
});
