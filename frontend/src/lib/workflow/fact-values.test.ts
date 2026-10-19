import { describe, expect, it } from 'vitest';

import { describeValue, factValues, leftoverValues, supersededValues } from './fact-values';

describe('the values a fact states (8 Oct; Sean, 7 Oct, TeamNotes)', () => {
  it('reads one date however it is written, without the year', () => {
    for (const t of ['November 12, 2026', 'Nov 12', 'Nov. 12th', '12 November 2026', 'the 12th of November', '11/12/2026']) {
      expect(factValues(t).dates).toEqual(['11-12']);
    }
  });

  it('reads money however it is written, and leaves years out of the numbers', () => {
    expect(factValues('$12 per user per month').money).toEqual(['12']);
    expect(factValues('$12.00 a seat').money).toEqual(['12']);
    expect(factValues('12 USD').money).toEqual(['12']);
    expect(factValues('Launch on November 12, 2026 for $1,200 with 5 seats').numbers).toEqual(['5']);
  });

  it('a changed fact supersedes only the values it no longer states', () => {
    const s = supersededValues('TeamNotes launches November 12, 2026 at $12 per user per month', 'TeamNotes launches November 19, 2026 at $15 per user per month');
    expect(s.map((v) => `${v.kind}:${v.value}`)).toEqual(['dates:11-12', 'money:12']);
    expect(s.map(describeValue)).toEqual(['November 12', '$12']);
  });

  it('finds a superseded value a repaired text still states', () => {
    const s = supersededValues('Launch: November 12', 'Launch: November 19');
    expect(leftoverValues('TeamNotes is available from Nov 12th.', s)).toHaveLength(1);
    expect(leftoverValues('TeamNotes is available from November 19.', s)).toHaveLength(0);
  });

  it('a sentence describing the change, or the "What changed:" line, is not a value left behind', () => {
    const s = supersededValues('Launch: November 12', 'Launch: November 19');
    expect(leftoverValues('What changed: the launch date, Nov 12.\nTeamNotes launches November 19.', s)).toHaveLength(0);
    expect(leftoverValues('The launch moved from November 12 to November 19.', s)).toHaveLength(0);
    expect(leftoverValues('{"items":[{"claim":"Launch is November 12","status":"matches"}]}', s)).toHaveLength(1);
  });

  it('a value the text says was not adopted is history, not left behind (19 Oct, Ridgeway copy)', () => {
    const s = supersededValues(
      'The quality director proposes a process-improvement initiative requiring 100 staff hours over five weeks.',
      'The CEO authorized the process-improvement initiative for up to 75 staff hours over five weeks.',
    );
    expect(leftoverValues('Its capacity condition was also tied to the 100 hours, which were not adopted.', s)).toHaveLength(0);
    expect(leftoverValues('The initiative uses 100 staff hours over five weeks.', s)).toHaveLength(1);
  });
});

describe('superseded values from a recorded answer (8 Oct, production)', () => {
  const asked = 'Decided by the user — asked "Which launch date — December 3 or December 10 — and price — $18 or $24?", answered: Use December 10 and $18 per user per month.';
  it('only the answer is the user\'s value; the alternatives in the question are not', () => {
    const s = supersededValues(asked, 'Launch date: December 10. Price: $15 per user per month.');
    expect(s.map((v) => `${v.kind}:${v.value}`)).toEqual(['money:18']);
  });
  it('a sentence attributing the old value to a source is not a leftover', () => {
    const s = supersededValues(asked, 'Price: $15 per user per month.');
    expect(leftoverValues('Source A says $18 per user per month. Use $15.', s)).toHaveLength(0);
    expect(leftoverValues('Do not use $18.', s)).toHaveLength(0);
    expect(leftoverValues('TaskBoard costs $18 per user per month.', s)).toHaveLength(1);
  });
});

describe('a list of excluded values (8 Oct, production)', () => {
  it('items under a line that sets values aside are not leftovers', () => {
    const s = supersededValues('Price: $18 per user per month', 'Price: $15 per user per month');
    const prompt = 'Price: $15 per user per month\n\nThe following alternatives are excluded because they conflict with the accepted project facts:\n\n- December 3 launch date\n- $18 per user per month price\n- $24 per user per month price\n\nRequirements:\n- State the price.';
    expect(leftoverValues(prompt, s)).toHaveLength(0);
    expect(leftoverValues('Requirements:\n- Charge $18 per user per month.', s)).toHaveLength(1);
  });
});

describe('history is not a value left behind (Sean, 14 Oct: SUMMIT change log, JUNIPER review)', () => {
  const launch = supersededValues('Elena approved a November 20, 2026 launch date.', 'Elena explicitly approved changing the launch date to November 23, 2026.');

  it('a change-log section keeps the earlier value', () => {
    const pack = [
      '## 1. Executive status report',
      'The approved launch date is November 23, 2026.',
      '## 4. Decision and change log',
      '| Type | Item | Detail | Date / status |',
      '|---|---|---|---|',
      '| Approval | Launch date | Elena approved November 20, 2026. | Superseded |',
      '- The launch was set for November 20.',
    ].join('\n');
    expect(leftoverValues(pack, launch)).toHaveLength(0);
  });

  it('the same value in the current status is still found', () => {
    expect(leftoverValues('## Status\nLaunch is on November 20, 2026.\n## Change log\n- November 20 replaced.', launch)).toHaveLength(1);
  });

  it('a table headed as history keeps its rows, under any heading', () => {
    const table = '| History | Earlier value | Now |\n|---|---|---|\n| Launch | Nov 20 | Nov 23 |';
    expect(leftoverValues(table, launch)).toHaveLength(0);
  });

  it('a quotation of an earlier version reports it; a declined request is not current', () => {
    expect(leftoverValues('Fact check against v1: the memo says "the approved November 20, 2026 launch date is achievable".', launch)).toHaveLength(0);
    expect(leftoverValues('{"items":[{"text":"The memo says \\"launch November 20\\" and is fine."}]}', launch)).toHaveLength(0);
    expect(leftoverValues('Luis asks to keep the November 20 launch.', launch)).toHaveLength(0);
  });

  it('a task window ending on that day is not the launch date', () => {
    expect(leftoverValues('- Testing — November 16 to November 20, 2026 — Owner: Luis', launch)).toHaveLength(0);
    expect(leftoverValues('Testing runs Nov 16–20.', launch)).toHaveLength(0);
    expect(leftoverValues('Launch: November 20, 2026.', launch)).toHaveLength(1);
  });
});
