import { describe, expect, it } from 'vitest';

import { referenceChange, referenceName, referenceText } from './reference-change';
import type { ReferenceSnapshot } from '@/types/project';

// 28 Nov (Sean, Harborlight; L-326): the source went from 24 to 18 seats per
// session, "Update from the original" stored the new copy, and the answer that
// computed 48 seats was never marked for a recheck.
const snap = (text: string, facts: string[] = []): ReferenceSnapshot => ({
  title: 'Harborlight Workshop — capacity source', objective: 'Seats per session', deliverable: 'Answer', text, facts, updatedAt: '',
});
const was = snap('Studio A seats 24 participants per session. Two sessions.', ['Two sessions are booked.']);
const now = snap('Studio A seats 18 participants per session. Two sessions.', ['Two sessions are booked.']);

describe('a linked project updated from its original (L-326)', () => {
  it('is a change when what it brings says something new', () => {
    expect(referenceChange(was, now, true)).toEqual({ before: referenceText(was, true), after: referenceText(now, true) });
    expect(referenceChange(was, now, true)!.after).toContain('18 participants');
  });

  it('a fact the reference sends counts; one it does not send does not', () => {
    const factOnly = snap(was.text, ['Three sessions are booked.']);
    expect(referenceChange(was, factOnly, true)).not.toBeNull();
    expect(referenceChange(was, factOnly, false)).toBeNull();
  });

  it('the same copy, a spacing or punctuation change, or no earlier copy is not', () => {
    expect(referenceChange(was, snap(was.text, was.facts), true)).toBeNull();
    expect(referenceChange(was, snap('Studio A seats 24 participants per session; two sessions', was.facts), true)).toBeNull();
    expect(referenceChange(null, now, true)).toBeNull();
    expect(referenceChange(undefined, now, true)).toBeNull();
  });

  it('names it as prompts do', () => {
    expect(referenceName(0, 'Harborlight Workshop — capacity source')).toBe('[R1] Harborlight Workshop — capacity source');
    expect(referenceName(2, ' ')).toBe('[R3] Untitled project');
  });
});
