import { describe, expect, it } from 'vitest';

import { CHAT_WIDTH, clampChatWidth, initialChatOpen } from './workflow-workspace';

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

describe('clampChatWidth (25 Oct, client: crunched on a laptop)', () => {
  it('reads what was stored and holds it between the bounds', () => {
    expect(clampChatWidth('480')).toBe(480);
    expect(clampChatWidth(100)).toBe(CHAT_WIDTH.min);
    expect(clampChatWidth(5000)).toBe(CHAT_WIDTH.max);
  });

  it('falls back to the default for anything unreadable', () => {
    expect(clampChatWidth(null)).toBe(CHAT_WIDTH.initial);
    expect(clampChatWidth('wide')).toBe(CHAT_WIDTH.initial);
  });
});
