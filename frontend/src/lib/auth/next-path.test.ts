import { describe, expect, it } from 'vitest';

import { safeNext } from './next-path';

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
