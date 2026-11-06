import { afterEach, describe, expect, it, vi } from 'vitest';

import { rememberNext, safeNext, takeRememberedNext } from './next-path';

describe('safeNext', () => {
  it('keeps a same-origin path, with its query', () => {
    expect(safeNext('/projects/abc?x=1')).toBe('/projects/abc?x=1');
    expect(safeNext('/auth/reset')).toBe('/auth/reset');
  });

  it('refuses anything that could leave the site, and loops back into login', () => {
    for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', 'projects', '/auth/login', '', null, undefined]) {
      expect(safeNext(bad)).toBeNull();
    }
  });
});

describe('rememberNext', () => {
  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('hands back where they were going, once', () => {
    rememberNext('/examples/investment-memo?from=landing');
    expect(takeRememberedNext()).toBe('/examples/investment-memo?from=landing');
    expect(takeRememberedNext()).toBeNull();
  });

  it('never remembers a place outside the site', () => {
    rememberNext('https://evil.example');
    expect(takeRememberedNext()).toBeNull();
  });

  it('clears an abandoned sign-in when the next one is going nowhere in particular', () => {
    rememberNext('/projects/abc');
    rememberNext(null);
    expect(takeRememberedNext()).toBeNull();
  });

  it('forgets after an hour', () => {
    vi.useFakeTimers();
    rememberNext('/projects/abc');
    vi.advanceTimersByTime(60 * 60 * 1000 + 1);
    expect(takeRememberedNext()).toBeNull();
  });

  it('survives something unreadable in storage', () => {
    localStorage.setItem('pm-next-after-sign-in', 'not json');
    expect(takeRememberedNext()).toBeNull();
  });
});
