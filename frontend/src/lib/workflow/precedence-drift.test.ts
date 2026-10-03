import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PRECEDENCE, recommendedControl } from './precedence';

const PY = readFileSync(join(process.cwd(), '..', 'backend', 'promptmaster', 'precedence.py'), 'utf8');

describe('the precedence order exists twice and agrees', () => {
  it('has the same keys in the same order as the backend', () => {
    const block = PY.slice(PY.indexOf('PRECEDENCE:'), PY.indexOf('PRECEDENCE_TEXT'));
    const py = [...block.matchAll(/\("([a-z]+)",/g)].map((m) => m[1]);
    expect(py.length).toBeGreaterThan(5);
    expect([...PRECEDENCE]).toEqual(py);
  });

  it('recommends keeping the objective and earlier decisions, and the new instruction over a constraint', () => {
    expect(recommendedControl('objective')).toBe('existing');
    expect(recommendedControl('decision')).toBe('existing');
    expect(recommendedControl('constraint')).toBe('new');
    expect(recommendedControl('instruction')).toBeNull();
  });
});
