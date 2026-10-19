import { describe, expect, it } from 'vitest';

import type { InstructionConflict } from './instruction-conflicts';
import { keepWithoutAsking, keptConflictsOf, routinePrecedenceNote } from './routine-conflicts';

// Ridgeway (Sean, 18 Oct): the COO's order against the record that the board has not approved it.
const COO: InstructionConflict = {
  kind: 'fact', with_id: 'F1', with_text: 'The board has issued no capital approval for the $900,000 inspection system.',
  explanation: 'No board approval.', source: 'model', protects_approval: true,
  from_request: true, request_quote: 'The COO asks purchasing to order the $900,000 inspection system immediately',
};
const handled = { routineHandled: true, origin: 'user' as const };

describe('L-93: an accepted record kept against a request, without asking', () => {
  it('keeps the record when every conflict is someone else’s request and routine decisions are handled', () => {
    const r = keepWithoutAsking([COO], handled);
    expect(r.keep).toBe(true);
    if (r.keep) {
      expect(r.note).toContain('Kept the approval status on record');
      expect(r.note).toContain('The COO asks purchasing');
      expect(r.note).toContain('a request nobody with authority has approved');
    }
  });

  it('asks when routine decisions are set to "Ask me"', () => {
    expect(keepWithoutAsking([COO], { ...handled, routineHandled: false })).toMatchObject({ keep: false });
  });

  it('asks when the instruction records an approval', () => {
    expect(keepWithoutAsking([{ ...COO, instruction_authorised: true, authority_quote: 'The board approved the order' }], handled)).toMatchObject({ keep: false });
  });

  it('asks when the user’s own instruction conflicts, or a request comes from someone who may approve', () => {
    // The backend leaves `from_request` unset for both.
    expect(keepWithoutAsking([{ ...COO, from_request: false }], handled)).toMatchObject({ keep: false });
    expect(keepWithoutAsking([COO, { ...COO, kind: 'constraint', from_request: undefined }], handled)).toMatchObject({ keep: false });
  });

  it('asks when two instructions conflict', () => {
    expect(keepWithoutAsking([{ ...COO, kind: 'instruction' }], handled)).toMatchObject({ keep: false });
  });

  it('keeps the record against Go’s own proposal, which carries no authority', () => {
    const goProposal: InstructionConflict = { ...COO, from_request: false, request_quote: undefined };
    const r = keepWithoutAsking([goProposal], { routineHandled: true, origin: 'go' });
    expect(r.keep).toBe(true);
    if (r.keep) expect(r.note).toContain('Go’s own proposal does not override it');
    // …but never an approval the proposal itself records, and never under "Ask me".
    expect(keepWithoutAsking([{ ...goProposal, instruction_authorised: true }], { routineHandled: true, origin: 'go' })).toMatchObject({ keep: false });
    expect(keepWithoutAsking([goProposal], { routineHandled: false, origin: 'go' })).toMatchObject({ keep: false });
  });

  it('asks about nothing when nothing conflicts', () => {
    expect(keepWithoutAsking([], handled)).toMatchObject({ keep: false });
  });

  it('tells the model it was the policy, not the user, that kept the record', () => {
    const note = routinePrecedenceNote(COO);
    expect(note).toMatch(/^Under the user's routine-decision policy, keep the recorded approval/);
    expect(note).not.toContain('The user has decided');
  });

  it('reads the kept conflicts back from a step, for "Apply it anyway"', () => {
    expect(keptConflictsOf({ routine_conflict_kept: { instruction: 'Order it', conflicts: [COO], note: 'n' } })).toEqual({ instruction: 'Order it', conflicts: [COO], note: 'n' });
    expect(keptConflictsOf({})).toBeNull();
    expect(keptConflictsOf({ routine_conflict_kept: { instruction: 'x', conflicts: [] } })).toBeNull();
  });
});
