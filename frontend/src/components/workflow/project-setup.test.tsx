import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ProjectBrief, ProjectSetup } from './project-setup';
import type { Project } from '@/types/project';

const project = (model: string) =>
  ({ objective: 'Status pack for HARBOR', audience: '', constraints: '', output_format: '', context: '', model }) as unknown as Project;

describe('the project brief sets the model (17 Oct, Sean: same-model comparison)', () => {
  it('offers GPT-5.4 and Claude Opus 5.5, and saves the choice on the project', async () => {
    const onPatch = vi.fn();
    render(<ProjectBrief project={project('openai/gpt-5.4')} onPatch={onPatch} readOnly={false} />);
    const select = screen.getByLabelText('Model') as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(['GPT-5.4 (default)', 'Claude Opus 5.5']);
    await userEvent.setup().selectOptions(select, 'anthropic/claude-opus-5.5');
    expect(onPatch).toHaveBeenCalledWith({ model: 'anthropic/claude-opus-5.5' });
  });

  it('keeps a model chosen elsewhere visible rather than showing the default', () => {
    render(<ProjectBrief project={project('google/gemini-3-pro')} onPatch={() => {}} readOnly={false} />);
    expect((screen.getByLabelText('Model') as HTMLSelectElement).value).toBe('google/gemini-3-pro');
  });
});

describe('the first stage sets the model too (18 Oct, pilot)', () => {
  it('the setup panel the first stage shows instead of the brief has the model choice', () => {
    const stage = { id: 'input', exit_criteria: [{ id: 'c', rule: { type: 'field_non_empty', field: 'objective' }, blocking: true }] } as never;
    render(<ProjectSetup project={project('openai/gpt-5.4')} stage={stage} onPatch={() => {}} readOnly={false} />);
    expect(screen.getByLabelText('Model')).toBeInTheDocument();
  });
});
