import { describe, expect, it } from 'vitest';
import { asIteration } from './legacy';

describe('asIteration', () => {
  it('keeps a version number', () => {
    expect(asIteration('text', 3, 'architect').iteration_number).toBe(3);
  });

  it('never sends a number below 1, which the backend refuses', () => {
    expect(asIteration('text', 0, 'architect').iteration_number).toBe(1);
  });
});
