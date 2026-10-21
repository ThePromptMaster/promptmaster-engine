import { describe, expect, it } from 'vitest';

import { guestErrorMessage } from './guest';

describe('guestErrorMessage', () => {
  it('explains the per-network limit a phone network runs into', () => {
    expect(guestErrorMessage('Request rate limit reached')).toMatch(/Too many guest sessions/);
  });

  it('says when guest access is switched off', () => {
    expect(guestErrorMessage('Anonymous sign-ins are disabled')).toMatch(/turned off/);
  });

  it('passes any other message through, and never shows an empty one', () => {
    expect(guestErrorMessage('Network down')).toBe('Network down');
    expect(guestErrorMessage('')).toBe('Could not start a guest session.');
  });
});
