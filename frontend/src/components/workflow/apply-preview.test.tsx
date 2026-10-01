import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ApplyPreview, type PreviewRecommendation } from './apply-preview';

const rec = (category: string, title: string, tags: string[]): PreviewRecommendation => ({
  category, title, tags, kind: 'fix', instruction: title, severity: 'minor',
  scope: { kind: 'document', described_as: 'the whole draft' },
});

const shorter = rec('a', 'Cut it to one page', ['length:shorter']);
const longer = rec('b', 'Add a worked example', ['length:longer']);

function setup() {
  const onApply = vi.fn();
  render(
    <ApplyPreview selected={[shorter, longer]} headVersionNumber={1} stageLabel="Drafting"
      applying={false} error={null} onRemove={vi.fn()} onApply={onApply} onCancel={vi.fn()} />
  );
  return onApply;
}

describe('PM-24: one instruction vs another — which should control?', () => {
  it('asks, defaults to letting the model balance them, and never blocks', async () => {
    const onApply = setup();
    expect(screen.getByRole('radio', { name: 'Let PromptMaster balance them' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Combine and apply' }));
    expect(onApply).toHaveBeenCalledWith({ showFirst: true, precedence: [] });
  });

  it('sends the choice with the fixes, and shows it in the instruction first', async () => {
    const onApply = setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: '"Cut it to one page" takes priority' }));
    const note = 'Where "Cut it to one page" and "Add a worked example" pull against each other, "Cut it to one page" takes precedence.';
    expect(screen.getByTestId('combined-instruction')).toHaveTextContent(note);
    await user.click(screen.getByRole('button', { name: 'Combine and apply' }));
    expect(onApply).toHaveBeenCalledWith({ showFirst: true, precedence: [note] });
  });
});
