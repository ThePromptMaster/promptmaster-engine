import { describe, expect, it } from 'vitest';

import { isWaiting, localTimes } from './send-words';

// Seen on production, 27 Nov: "Scheduled for 27/11/2026, 00:21:20. Waiting: today's limit is
// reached; it goes at 2026-11-28T00:13:33.712Z." The time it really goes is the one to show.
describe('a waiting send says when it goes, in the reader\'s time', () => {
  it('formats every instant in a reason and leaves the rest alone', () => {
    const fmt = (d: Date) => `<${d.getTime()}>`;
    expect(localTimes("Waiting: today's limit is reached; it goes at 2026-11-28T00:13:33.712Z.", fmt)).toBe(
      `Waiting: today's limit is reached; it goes at <${Date.parse('2026-11-28T00:13:33.712Z')}>.`
    );
    expect(localTimes('Changed after it was approved: the text.', fmt)).toBe('Changed after it was approved: the text.');
  });

  it('knows a waiting reason from a hold', () => {
    expect(isWaiting('Waiting: all outreach is paused in Settings.')).toBe(true);
    expect(isWaiting('')).toBe(false);
    expect(isWaiting('Changed after it was approved: the text.')).toBe(false);
  });
});
