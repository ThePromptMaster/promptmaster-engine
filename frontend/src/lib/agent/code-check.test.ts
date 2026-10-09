import { describe, expect, it } from 'vitest';

import { checkGoal, codeToCheck } from './code-check';

const draft = 'Corrected:\n\n```python\ndef merge(a, b):\n    return sorted(a + b)\n```\n\nCases below.';

describe('code a deliverable asks to have checked (M3; Sean, 7 Oct, email 3)', () => {
  it('finds the Python when the objective asks for tests', () => {
    expect(codeToCheck(draft, 'Fix the function and check all nine cases')).toEqual({ language: 'python', code: 'def merge(a, b):\n    return sorted(a + b)' });
  });
  it('nothing when the objective asks for no checking, or there is no Python', () => {
    expect(codeToCheck(draft, 'Explain the function to a beginner')).toBeNull();
    expect(codeToCheck('No code here.', 'Test it')).toBeNull();
  });
  it('the run is told to keep the code as written and report each case', () => {
    const goal = checkGoal(codeToCheck(draft, 'test it')!, 'test it');
    expect(goal).toContain('EXACTLY as written');
    expect(goal).toContain('PASS or FAIL');
    expect(goal).toContain('    return sorted(a + b)');
  });
});
