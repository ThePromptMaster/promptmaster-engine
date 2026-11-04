/** 4 Nov (Sean): a sample of what good looks like reaches every prompt, only when given. */
import { describe, expect, it } from 'vitest';

import { inputsFrom } from './stage-requests';
import type { Project } from '@/types/project';

const base = { objective: 'A talk on cryo-EM', audience: 'Lab', constraints: '', output_format: '', context: '', facts: [] } as unknown as Project;

describe('the sample of what good looks like', () => {
  it('goes with every request when the project has one, and not otherwise', () => {
    expect(inputsFrom(base).sample_output).toBeUndefined();
    expect(inputsFrom({ ...base, sample_output: '   ' }).sample_output).toBeUndefined();
    expect(inputsFrom({ ...base, sample_output: 'Resolution is local, not global.' }).sample_output).toBe('Resolution is local, not global.');
  });
});
