import { describe, expect, it } from 'vitest';

import { readerLag, readerLagNote } from './reader-lag';
import { SINGLE_OUTPUT_V1 } from './templates/single-output.v1';

const v = (created_at: string) => ({ versions: [{ created_at }] });

describe('readerLag — the full-work reader says what it shows (14 Oct call)', () => {
  it('is quiet while the deliverable holds the latest change', () => {
    expect(readerLag(SINGLE_OUTPUT_V1, { input: v('2026-10-14T10:00:00Z'), output: v('2026-10-14T11:00:00Z') })).toBeNull();
  });

  it('names an earlier stage changed after the deliverable, and how the change reaches it', () => {
    const lag = readerLag(SINGLE_OUTPUT_V1, { input: v('2026-10-14T12:00:00Z'), output: v('2026-10-14T11:00:00Z') });
    expect(lag).toEqual({ shows: 'Output and evaluation', changed: 'Objective and setup', feedsIt: true });
    expect(readerLagNote(lag!)).toMatch(/Apply and continue/);
  });

  it('says a later stage changed on its own is read there', () => {
    const lag = readerLag(SINGLE_OUTPUT_V1, { output: v('2026-10-14T11:00:00Z'), realign: v('2026-10-14T12:00:00Z') });
    expect(lag?.feedsIt).toBe(false);
    expect(readerLagNote(lag!)).toMatch(/own stage/);
  });

  it('is quiet before anything is written', () => {
    expect(readerLag(SINGLE_OUTPUT_V1, { input: v('2026-10-14T12:00:00Z') })).toBeNull();
  });
});
