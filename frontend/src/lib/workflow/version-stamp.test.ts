import { describe, expect, it } from 'vitest';

import { editsBetween, editsInstruction, readStamps, resolveInstruction, STAMP_NOTE, staleStamp, stampFor, withoutStamps } from './version-stamp';

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
      { removed: ['KES-T2 Build forecast finish: November 12.'], added: ['KES-T2 Build forecast finish: November 14.'], after: 'As of November 5, 2026, spending to date is $18,000.', heading: null, next: 'KES-T4 Training: not reported.' },
      { removed: [], added: ['KES-T6 Handover: scheduled November 26.'], after: 'KES-T4 Training: not reported.', heading: null, next: null },
    ]);
  });

  it('finds a removal, and nothing when the text is unchanged', () => {
    expect(editsBetween(v3, 'As of November 5, 2026, spending to date is $18,000.\nKES-T2 Build forecast finish: November 12.')).toEqual([
      { removed: ['KES-T4 Training: not reported.'], added: [], after: 'KES-T2 Build forecast finish: November 12.', heading: null, next: null },
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

describe('what is sent, and checked for conflicts, is the edits (18 Oct, production pass)', () => {
  // REEF Output v2 as exported, when spending still read $18,000; v6 says $16,000.
  const V2 = `## Status

As of November 5, 2026, Project REEF launch is November 20. The approved budget is \$40,000. Spending to date is \$18,000. Omar has proposed moving the launch to November 23 and raising the budget to \$46,000; Elena has not approved these changes. Only Elena may approve changes to the launch date or budget.

## Short History

As of November 5, 2026, the recorded facts for Project REEF are: launch November 20, approved budget \$40,000, spending to date \$18,000, and only Elena may approve changes to the launch date or budget. Omar proposed changing the launch date to November 23 and the budget to \$46,000, and those changes have not been approved by Elena.`;
  const pasted = V2.replace('\n\n## Short History', '\n\nNext review meeting: November 12, 2026, chaired by Elena.\n\n## Short History') + '\n\n_[PromptMaster output v2 0648aae1]_';
  const load = async (n: number) => (n === 2 ? { content: V2 } : undefined);
  const at = (head: number, wholeDocument = true) => ({ wholeDocument, stageId: 'output', head: { version_number: head }, loadVersion: load });

  it('a paste from v2 onto v6 sends only the added line, never the old $18,000 it did not touch', async () => {
    const r = await resolveInstruction(pasted, at(6));
    if ('error' in r) throw new Error(r.error);
    expect(r.revisedFrom).toEqual({ version: 2, head: 6, edits: 1 });
    expect(r.ask).toContain('Next review meeting: November 12, 2026, chaired by Elena.');
    expect(r.ask).not.toContain('$18,000');
    expect(r.ask).not.toContain('[PromptMaster');
    expect(r.ask).toContain('under "## Status", just before "## Short History"');
  });

  it('a stamp at the head, a section, or no stamp: the text as typed, stamps removed', async () => {
    expect(await resolveInstruction(pasted, at(2))).toEqual({ ask: withoutStamps(pasted) });
    expect(await resolveInstruction(pasted, at(6, false))).toEqual({ ask: withoutStamps(pasted) });
    expect(await resolveInstruction('Cut the second paragraph.', at(6))).toEqual({ ask: 'Cut the second paragraph.' });
  });

  it('an old version pasted back unchanged is refused with a reason; a version that cannot be found is sent as typed', async () => {
    const same = await resolveInstruction(`${V2}\n\n_[PromptMaster output v2 0648aae1]_`, at(6));
    expect(same).toEqual({ error: 'This is version 2 unchanged — there is nothing to apply. The current version is 6.' });
    const lost = await resolveInstruction(pasted.replace('output v2', 'output v1'), at(6));
    expect(lost).toEqual({ ask: withoutStamps(pasted) });
  });
});
