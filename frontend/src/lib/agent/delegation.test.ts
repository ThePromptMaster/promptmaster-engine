/**
 * 4 Nov (Sean, support-software memo): his delegation reached the setup as
 * "Handle drafting and arithmetic without asking"; checking and corrections
 * were dropped, and the planner saw only the "Routine decisions" flag.
 */
import { describe, expect, it } from 'vitest';

import { delegationSentences } from './delegation';

const context = [
  'Create a decision memo for choosing a customer-support software plan.',
  '',
  'No purchase, vendor contact or spending is authorized.',
  '',
  'Separate supplied facts, calculations and assumptions. Keep explanations about internal workflow outside the memo.',
  '',
  'Handle routine drafting, arithmetic, checking and corrections without asking me to decide each one. You may ask me to approve the finished document.',
  '',
  'This authorizes creating and revising the document only.',
].join('\n');
const constraints = 'Use only the supplied facts. No purchase, vendor contact or spending is authorized. Handle drafting and arithmetic without asking, and leave internal workflow notes out of the memo.';

describe('the user\'s delegation, in their words', () => {
  it('keeps every sentence that grants, reserves or limits authority, verbatim and once', () => {
    expect(delegationSentences({ context, constraints })).toEqual([
      'No purchase, vendor contact or spending is authorized.',
      'Handle routine drafting, arithmetic, checking and corrections without asking me to decide each one.',
      'You may ask me to approve the finished document.',
      'This authorizes creating and revising the document only.',
      'Handle drafting and arithmetic without asking, and leave internal workflow notes out of the memo.',
    ]);
  });

  it('reads nothing into a brief that delegates nothing', () => {
    expect(delegationSentences({ context: 'Write a memo about bikes. Use the facts below.', constraints: 'Under 300 words.' })).toEqual([]);
    expect(delegationSentences({})).toEqual([]);
  });
});
