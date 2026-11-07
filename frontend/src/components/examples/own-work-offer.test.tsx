import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { OwnWorkOffer } from './own-work-offer';

describe('OwnWorkOffer', () => {
  it('leads to the own-work section of the example that just finished', () => {
    render(<OwnWorkOffer exampleKey="investment_memo" />);
    expect(screen.getByRole('heading', { name: 'Now do this on your own work' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Use it on my own work/ })).toHaveAttribute('href', '/examples/investment-memo#own');
  });

  it('shows nothing on a project that is not an example, or an example that has gone', () => {
    const { container, rerender } = render(<OwnWorkOffer />);
    expect(container).toBeEmptyDOMElement();
    rerender(<OwnWorkOffer exampleKey={null} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<OwnWorkOffer exampleKey="retired_example" />);
    expect(container).toBeEmptyDOMElement();
  });
});
