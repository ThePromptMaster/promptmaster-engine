import { describe, expect, it } from 'vitest';

import { drivingHere, onePress } from './one-press';

describe('one press at a time (12 Nov, production: a choice pressed twice ended the run failed)', () => {
  it('drops a second press while the first is still in hand', async () => {
    const press = onePress();
    let done = 0;
    let release: () => void = () => {};
    const first = press.run(() => new Promise<void>((resolve) => {
      release = () => {
        done += 1;
        resolve();
      };
    }));
    expect(press.busy).toBe(true);
    const second = await press.run(async () => {
      done += 1;
    });
    expect(second).toBe(false);
    release();
    expect(await first).toBe(true);
    expect(done).toBe(1);
    expect(press.busy).toBe(false);
  });

  it('takes the next press once the first has finished, and after one that threw', async () => {
    const press = onePress();
    await expect(press.run(async () => {
      throw new Error('refused');
    })).rejects.toThrow('refused');
    expect(press.busy).toBe(false);
    expect(await press.run(async () => {})).toBe(true);
  });
});

describe('a run this tab is driving is not adopted over itself', () => {
  it('is this tab’s own only while its loop is active on that run', () => {
    expect(drivingHere({ id: 'r1' }, { id: 'r1' }, true)).toBe(true);
    expect(drivingHere({ id: 'r1' }, { id: 'r1' }, false)).toBe(false);
    expect(drivingHere({ id: 'r2' }, { id: 'r1' }, true)).toBe(false);
    expect(drivingHere({ id: 'r1' }, null, true)).toBe(false);
  });
});
