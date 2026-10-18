import { describe, expect, it } from 'vitest';

import { editsBetween, editsInstruction, readStamps, STAMP_NOTE, staleStamp, stampFor, withoutStamps } from './version-stamp';

const V3 = { version_number: 3, id: '1A2B3C4D-0000-4000-8000-000000000000' };

const exported = `## Status

As of November 5, 2026, spending to date is $18,000.
KES-T2 Build forecast finish: November 12.

_version 3 of 3 · model anthropic/claude-opus-5.5 · generate_

_${stampFor('output', V3)}_
`;

describe('version stamps on exports (17 Oct, Sean: revise in another assistant, paste back)', () => {
  it('prints and reads back the stage, the version and the reference', () => {
    expect(stampFor('output', V3)).toBe('[PromptMaster output v3 1a2b3c4d]');
    expect(readStamps(exported)).toEqual([{ stageId: 'output', version: 3, ref: '1a2b3c4d' }]);
  });

  it('a stamp older than the head is stale; the head itself, another stage or no stamp is not', () => {
    expect(staleStamp(exported, 'output', 5)).toEqual({ stageId: 'output', version: 3, ref: '1a2b3c4d' });
    expect(staleStamp(exported, 'output', 3)).toBeNull();
    expect(staleStamp(exported, 'review', 5)).toBeNull();
    expect(staleStamp('No stamp here.', 'output', 5)).toBeNull();
  });

  it('removes the stamps and the note, and nothing else', () => {
    const text = withoutStamps(`_${STAMP_NOTE}_\n\n${exported}`);
    expect(text).not.toMatch(/PromptMaster output|Keep the \[PromptMaster/);
    expect(text).toContain('As of November 5, 2026, spending to date is $18,000.');
    expect(text).toContain('_version 3 of 3 · model anthropic/claude-opus-5.5 · generate_');
  });
});

describe("only the user's own edits go to the current version", () => {
  const v3 = 'As of November 5, 2026, spending to date is $18,000.\nKES-T2 Build forecast finish: November 12.\nKES-T4 Training: not reported.';
  const revisedElsewhere = 'As of November 5, 2026, spending to date is $18,000.\nKES-T2 Build forecast finish: November 14.\nKES-T4 Training: not reported.\nKES-T6 Handover: scheduled November 26.';

  it('finds a replacement and an addition, and leaves unchanged lines alone', () => {
    expect(editsBetween(v3, revisedElsewhere)).toEqual([
      { removed: ['KES-T2 Build forecast finish: November 12.'], added: ['KES-T2 Build forecast finish: November 14.'], after: 'As of November 5, 2026, spending to date is $18,000.' },
      { removed: [], added: ['KES-T6 Handover: scheduled November 26.'], after: 'KES-T4 Training: not reported.' },
    ]);
  });

  it('finds a removal, and nothing when the text is unchanged', () => {
    expect(editsBetween(v3, 'As of November 5, 2026, spending to date is $18,000.\nKES-T2 Build forecast finish: November 12.')).toEqual([
      { removed: ['KES-T4 Training: not reported.'], added: [], after: 'KES-T2 Build forecast finish: November 12.' },
    ]);
    expect(editsBetween(v3, `${v3}\n\n`)).toEqual([]);
  });

  it('the instruction names the version it started from, keeps later changes, and lists only the edits', () => {
    const said = editsInstruction(editsBetween(v3, revisedElsewhere), 3, 5);
    expect(said).toMatch(/starting from version 3/);
    expect(said).toMatch(/keep every change made since version 3/);
    expect(said).toContain('November 14');
    expect(said).toContain('KES-T6 Handover');
    // The $18,000 line was not edited — corrected here since, it must not come back.
    expect(said).not.toContain('$18,000.\n  with');
    expect(said.match(/\$18,000/g)?.length ?? 0).toBeLessThanOrEqual(1);
  });
});
