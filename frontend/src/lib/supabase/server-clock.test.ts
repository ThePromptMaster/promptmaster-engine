import { afterEach, describe, expect, it } from 'vitest';

import { noteServerTime, resetServerClock, serverNow } from './server-clock';

afterEach(resetServerClock);

describe('times this device writes are on the database\'s clock (13 Nov)', () => {
  it('is this device\'s time until the database has been heard from', () => {
    expect(serverNow(Date.parse('2026-11-13T16:30:00.000Z'))).toBe('2026-11-13T16:30:00.000Z');
  });

  it('takes a device 31 seconds fast back to the database\'s time', () => {
    // Sent at 16:31:07.000 and received at 16:31:07.400 by this device's clock; the database stamped 16:30:36.200.
    noteServerTime('2026-11-13T16:30:36.200Z', Date.parse('2026-11-13T16:31:07.000Z'), Date.parse('2026-11-13T16:31:07.400Z'));
    expect(serverNow(Date.parse('2026-11-13T16:31:26.200Z'))).toBe('2026-11-13T16:30:55.200Z');
  });

  it('brings a slow device forward, and ignores a time it cannot read', () => {
    noteServerTime('2026-11-13T16:30:10.000Z', Date.parse('2026-11-13T16:30:00.000Z'), Date.parse('2026-11-13T16:30:00.000Z'));
    expect(serverNow(Date.parse('2026-11-13T16:30:05.000Z'))).toBe('2026-11-13T16:30:15.000Z');
    noteServerTime('not a time', 0, 0);
    noteServerTime(null, 0, 0);
    expect(serverNow(Date.parse('2026-11-13T16:30:05.000Z'))).toBe('2026-11-13T16:30:15.000Z');
  });
});
