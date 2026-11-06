import { describe, expect, it } from 'vitest';

import { isPilotEmail } from './pilot';

describe('the pilot list', () => {
  it('means no one when unset', () => {
    expect(isPilotEmail('a@example.org', undefined)).toBe(false);
    expect(isPilotEmail('a@example.org', ' , ')).toBe(false);
  });

  it('lets in who it lists, whatever the case or spacing', () => {
    expect(isPilotEmail('A@Example.org', 'b@example.org, a@example.org ')).toBe(true);
    expect(isPilotEmail('c@example.org', 'b@example.org,a@example.org')).toBe(false);
  });

  it('has no place for a guest, who has no address', () => {
    expect(isPilotEmail(null, 'a@example.org')).toBe(false);
    expect(isPilotEmail('', 'a@example.org')).toBe(false);
  });
});
