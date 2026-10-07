/**
 * The brief's limits exist twice — here, where the field stops taking text, and
 * in backend/promptmaster/limits.py, where a request is refused. If the
 * frontend's were higher, a saved field would fail every later stage with a
 * 422 (5 Oct); so the two are compared.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { INPUT_LIMITS, counterText, withinLimit } from './input-limits';

const PY = readFileSync(join(process.cwd(), '..', 'backend', 'promptmaster', 'limits.py'), 'utf8');

function py(name: string): number {
  const m = PY.match(new RegExp(`^${name} = ([\\d_]+)`, 'm'));
  if (!m) throw new Error(`${name} not found in limits.py`);
  return Number(m[1].replace(/_/g, ''));
}

describe('input limits', () => {
  it('match the backend', () => {
    expect(INPUT_LIMITS.objective).toBe(py('MAX_OBJECTIVE_CHARS'));
    expect(INPUT_LIMITS.audience).toBe(py('MAX_FIELD_CHARS'));
    expect(INPUT_LIMITS.constraints).toBe(py('MAX_FIELD_CHARS'));
    expect(INPUT_LIMITS.output_format).toBe(py('MAX_FIELD_CHARS'));
    expect(INPUT_LIMITS.context).toBe(py('MAX_CONTEXT_CHARS'));
    expect(INPUT_LIMITS.instruction).toBe(py('MAX_INSTRUCTION_CHARS'));
    expect(INPUT_LIMITS.message).toBe(py('MAX_CHAT_MESSAGE_CHARS'));
  });

  it('are far above the 4,000 a user hit on 5 Oct', () => {
    expect(INPUT_LIMITS.constraints).toBeGreaterThanOrEqual(60_000);
  });

  it('keeps a value within its field', () => {
    expect(withinLimit('constraints', 'x'.repeat(70_000))).toHaveLength(60_000);
    expect(withinLimit('constraints', 'short')).toBe('short');
  });

  it('shows a counter only once the limit is in sight', () => {
    expect(counterText(10_000, 60_000)).toBeNull();
    expect(counterText(50_000, 60_000)).toBe('50,000 / 60,000');
    expect(counterText(60_000, 60_000)).toMatch(/limit reached/);
  });
});
