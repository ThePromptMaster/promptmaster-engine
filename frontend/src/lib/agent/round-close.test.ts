import { describe, expect, it } from 'vitest';
import { lastOutsideInput, MAX_AUTO_ROUNDS, roundClose } from './round-close';

const update = { id: 'update_round', transitions: { default_next: 'screening_package', loop_to: 'sources', allow_skip: false, allow_return_to: [] } };
const label = (id: string) => ({ screening_package: 'Screening package', sources: 'Sources' })[id] ?? id;
const goRound = (at: string) => ({ type: 'stage_returned' as const, stage_id: 'update_round', actor: 'system' as const, payload: { next_round: true }, created_at: at });

describe('roundClose', () => {
  it('starts rounds while Go has started fewer than the limit since the last outside input', () => {
    expect(roundClose({ stage: update, label, events: [] })).toBeNull();
    expect(roundClose({ stage: update, label, events: [goRound('2026-10-19T10:00:00Z')] })).toBeNull();
  });

  // 19 Oct, HARBOR: nine rounds with nothing new between them.
  it('moves on to the stage after the round once Go has run the limit with nothing new', () => {
    const events = [goRound('2026-10-19T10:00:00Z'), goRound('2026-10-19T11:00:00Z')];
    const close = roundClose({ stage: update, label, events });
    expect(MAX_AUTO_ROUNDS).toBe(2);
    expect(close).toMatchObject({ to: 'screening_package', rounds: 2 });
    expect(close!.reason).toContain('moving on to Screening package');
  });

  it('counts only rounds started after a new file, fact or the user’s own round', () => {
    const events = [goRound('2026-10-19T10:00:00Z'), goRound('2026-10-19T11:00:00Z')];
    expect(roundClose({ stage: update, label, events, files: [{ created_at: '2026-10-19T10:30:00Z' }] })).toBeNull();
    expect(roundClose({ stage: update, label, events, facts: [{ source_kind: 'chat', created_at: '2026-10-19T10:30:00Z' }] })).toBeNull();
    const userRound = { type: 'stage_returned' as const, stage_id: 'update_round', actor: 'user' as const, payload: { next_round: true }, created_at: '2026-10-19T10:30:00Z' };
    expect(roundClose({ stage: update, label, events: [...events, userRound] })).toBeNull();
  });

  it('does not count facts Go’s own stages recorded as new material', () => {
    const events = [goRound('2026-10-19T10:00:00Z'), goRound('2026-10-19T11:00:00Z')];
    expect(roundClose({ stage: update, label, events, facts: [{ source_kind: 'stage', created_at: '2026-10-19T10:30:00Z' }] })).not.toBeNull();
  });

  it('does nothing on a stage that does not loop, or that has nothing after the round', () => {
    const events = [goRound('2026-10-19T10:00:00Z'), goRound('2026-10-19T11:00:00Z')];
    expect(roundClose({ stage: { id: 'update_round', transitions: { ...update.transitions, loop_to: undefined } }, label, events })).toBeNull();
    expect(roundClose({ stage: { id: 'update_round', transitions: { ...update.transitions, default_next: null } }, label, events })).toBeNull();
  });
});

describe('lastOutsideInput', () => {
  it('is the latest of files, outside facts and user rounds', () => {
    expect(lastOutsideInput({ events: [], files: [{ created_at: 'b' }], facts: [{ source_kind: 'brief', created_at: 'c' }, { source_kind: 'stage', created_at: 'z' }] })).toBe('c');
    expect(lastOutsideInput({ events: [] })).toBe('');
  });
});
