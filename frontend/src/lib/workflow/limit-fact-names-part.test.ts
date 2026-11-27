import { describe, expect, it } from 'vitest';

import { projectRequirements } from './context';
import type { ProjectFact } from '@/types/project';

/**
 * 28 Nov, production pass (bakery launch pack, john@ a6d5d161): "The 60-word limit applies only to the SMS
 * reminder." typed in the Facts panel as a fact changed nothing; the whole pack was still held to 60 words.
 */
const fact = (statement: string, kind: ProjectFact['kind'] = 'fact') =>
  ({ id: statement.slice(0, 8), statement, kind, subject: null, retired_at: null, supersedes: null, created_at: '2026-11-27T22:20:00Z' }) as ProjectFact;
const project = {
  objective: "Write the launch pack for our bakery's new Saturday market stall: an announcement email to our 400 subscribers, an SMS reminder, and an Instagram caption.",
  constraints: 'Keep it under 60 words.',
  output_format: 'Launch pack with an announcement email, an SMS reminder and an Instagram caption, kept under 60 words',
};
const limits = (facts: ProjectFact[]) => projectRequirements({ ...project, facts }).map((r) => `${r.subject ?? 'whole'}:${r.max ?? ''}`);

describe('a fact that says which part a limit is for', () => {
  it("moves the limit to that part, and the brief's same figure elsewhere goes", () => {
    // The brief's "kept under 60 words" was read as the email's.
    expect(limits([])).toEqual(['email:60']);
    expect(limits([fact('The 60-word limit applies only to the SMS reminder.')])).toEqual(['sms reminder:60']);
  });

  it('retires the same figure recorded earlier as a requirement of the whole', () => {
    expect(limits([fact('Keep it under 60 words', 'requirement'), fact('The 60-word limit applies only to the SMS reminder.')])).toEqual(['sms reminder:60']);
  });

  it('without "only", the part gains a limit and the rest stand', () => {
    expect(limits([fact('Requirement: the SMS reminder must be under 60 words.', 'requirement')])).toEqual(['email:60', 'sms reminder:60']);
  });

  it('a fact about something else changes nothing', () => {
    expect(limits([fact('The stall has moved from B7 to C3 (market office notice MO-2).')])).toEqual(limits([]));
  });
});
