import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { NeedsYouCard } from './needs-you-card';

describe('NeedsYouCard: carry on with other work first (Q2c, production 9 Oct)', () => {
  const need = { kind: 'tick_criterion', stageId: 'analysis', criterionId: 'ana.verdicts', label: 'I accept the verdicts', authority: 'reserved' } as const;

  it('an approval card offers to carry on with other work first, and asks again only if nothing can proceed', () => {
    const onCarryOn = vi.fn();
    render(<NeedsYouCard need={need} stageLabel={(id) => id} onAction={async () => undefined} onCarryOn={onCarryOn} />);
    fireEvent.click(screen.getByRole('button', { name: 'Carry on with other work first' }));
    expect(onCarryOn).toHaveBeenCalledTimes(1);
  });

  it('is not offered where nothing was passed for it', () => {
    render(<NeedsYouCard need={need} stageLabel={(id) => id} onAction={async () => undefined} />);
    expect(screen.queryByRole('button', { name: 'Carry on with other work first' })).toBeNull();
  });
});
