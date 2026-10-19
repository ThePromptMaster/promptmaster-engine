import { describe, expect, it } from 'vitest';

import { initialChatOpen } from './workflow-workspace';

describe('initialChatOpen (19 Oct, production pass at 390px)', () => {
  it('starts closed on a narrow screen, whatever a wide screen remembered', () => {
    expect(initialChatOpen('1', false)).toBe(false);
    expect(initialChatOpen('0', false)).toBe(false);
    expect(initialChatOpen(null, false)).toBe(false);
  });

  it('on a wide screen is open by default and keeps the last choice', () => {
    expect(initialChatOpen(null, true)).toBe(true);
    expect(initialChatOpen('1', true)).toBe(true);
    expect(initialChatOpen('0', true)).toBe(false);
  });
});
