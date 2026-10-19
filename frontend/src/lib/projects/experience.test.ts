import { afterEach, describe, expect, it, vi } from 'vitest';

import { EXPERIENCE_STORAGE_KEY, readExperience, writeExperience } from './experience';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('experience preference', () => {
  it('is simple for everyone until they choose advanced', () => {
    expect(readExperience()).toBe('simple');
    writeExperience('advanced');
    expect(localStorage.getItem(EXPERIENCE_STORAGE_KEY)).toBe('advanced');
    expect(readExperience()).toBe('advanced');
    writeExperience('simple');
    expect(localStorage.getItem(EXPERIENCE_STORAGE_KEY)).toBeNull();
    expect(readExperience()).toBe('simple');
  });

  it('ignores a value it does not know', () => {
    localStorage.setItem(EXPERIENCE_STORAGE_KEY, 'expert');
    expect(readExperience()).toBe('simple');
  });

  it('falls back to simple when storage throws (a private window)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(readExperience()).toBe('simple');
    expect(() => writeExperience('advanced')).not.toThrow();
  });
});
