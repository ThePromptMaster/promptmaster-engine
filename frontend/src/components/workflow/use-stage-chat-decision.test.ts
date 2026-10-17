import { describe, expect, it } from 'vitest';

import { withDecision } from './use-stage-chat';
import { appliedInstructions } from '@/lib/workflow/applied-instructions';
import type { ArtifactVersion } from '@/types/project';

describe('an applied instruction carries the priority answer it was applied under (18 Oct, production pass)', () => {
  const said = 'Change the approved budget to $46,000 and the launch to November 23, as Omar proposed. Write them as approved.';
  const kept = 'Keep what the record says is approved (Sponsor Elena approved a November 20 launch and a $40,000 budget). Record what the instruction asks for as a request that has not been approved.';

  it('is recorded with the decision, so later prompts read the request as declined', () => {
    const recorded = withDecision(said, [kept]);
    expect(recorded).toBe(`${said}\n\nDecided when this was applied: ${kept}`);
    const v = { source_operation: 'chat_instruct', instruction: recorded, version_number: 4, created_at: '2026-10-18T00:00:00Z' } as ArtifactVersion;
    const [applied] = appliedInstructions({ stages: [{ id: 'output', label: 'Output' }] } as never, { output: { versions: [v] } } as never);
    expect(applied.instruction).toContain('Decided when this was applied: Keep what the record says is approved');
  });

  it('an instruction with no question asked is recorded as said', () => {
    expect(withDecision(said, [])).toBe(said);
    expect(withDecision(said, undefined)).toBe(said);
  });
});
