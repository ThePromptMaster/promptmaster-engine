import { describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/react';

import { ToolkitLogo } from './toolkit-logo';

describe('a connected account’s logo', () => {
  it('is the account’s own mark, served by Composio, and decorative', () => {
    const { container } = render(<ToolkitLogo slug="gmail" size={24} />);
    const img = container.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('https://logos.composio.dev/api/gmail');
    expect(img.getAttribute('alt')).toBe('');
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(img.getAttribute('width')).toBe('24');
  });

  it('falls back to the account’s icon when the logo can’t be loaded', () => {
    const { container } = render(<ToolkitLogo slug="one_drive" />);
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[data-logo-fallback]')?.textContent).toBe('cloud');
  });

  it('shows the given icon for an item whose account isn’t known', () => {
    const { container } = render(<ToolkitLogo slug={null} fallback="mail" />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[data-logo-fallback]')?.textContent).toBe('mail');
  });
});
