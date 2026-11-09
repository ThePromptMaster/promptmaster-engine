import { describe, expect, it } from 'vitest';

import { derivedValues, describeValue, factValues, leftoverMentions, leftoverValues, namedLeftovers, supersededValues } from './fact-values';
import { supersededFactValues } from './facts';
import type { ProjectFact } from '@/types/project';

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

/**
 * 2 Nov (Sean, photography workshop). The reserve moved from $400 to $800 and
 * the ticket from $40 to $30. Every repair failed with "the new version still
 * states $400": the plan's $400 was what is left to spend ($1,200 − $800), and
 * in the retest its $40 was the most Option C may cost ("c ≤ $40"). The lines
 * that recorded the old values as superseded were already read as history.
 */
describe('a figure worked out from current values may equal an old one (2 Nov, photography workshop)', () => {
  const fact = (id: string, statement: string): ProjectFact => ({
    id, project_id: 'p', user_id: 'u', statement, subject: null, kind: 'requirement', source_kind: 'user_edit', source_ref: {},
    accepted_by: 'user', agent_run_id: null, supersedes: null, retired_at: null, retired_reason: null, created_at: '2026-11-02T08:48:23Z',
  });
  const superseded = supersededFactValues([
    fact('r', 'The minimum unspent reserve is $800, replacing $400.'),
    fact('t', 'The ticket price is $30 per person, replacing $40.'),
  ]);
  const plan = [
    '## Reserve check',
    '| Spendable while keeping $800 | $1,200 − $800 = $400 |',
    '| Left for materials | $400 − $300 = $100 |',
    '| At 20 | $300 + 20 × $5 = $400 spent; $1,200 − $400 = $800 unspent |',
    'Spending up to $400 authorized.',
    'B reaches break-even (300 + 12×5 = $360) only if c ≤ $40, and cannot be funded if c exceeds $100.',
    '## History',
    '- Minimum reserve: $400, replaced by $800.',
    '| Ticket $40 | Superseded | Replaced by $30 per person (2 Nov) |',
  ].join('\n');
  /** The plan with one more line, above its history. */
  const planWith = (line: string) => plan.replace('## History', `${line}\n## History`);

  it('reads the values the text works out, not the ones it is told', () => {
    expect([...derivedValues('$1,200 − $800 = $400')]).toEqual(['400']);
    expect(derivedValues('(100 − c) ÷ 5 ≥ 12 requires c ≤ 40')).toEqual(new Set(['12', '40']));
    expect(derivedValues('only if c ≤ $40').has('40')).toBe(true);
    expect(derivedValues('$1,200 less the $800 reserve leaves $400').has('400')).toBe(true);
    expect(derivedValues('Price = $40').size).toBe(0);
    expect(derivedValues('The reserve is $400.').size).toBe(0);
  });

  it('the plan that failed every repair now passes', () => {
    expect(leftoverMentions(plan, superseded)).toEqual([]);
  });

  it('a derived figure is still the old value beside the words of what changed', () => {
    for (const line of ['| Minimum reserve | $400 |', 'Keep a $400 reserve unspent.', 'We hold $400 in reserve.']) {
      expect(leftoverValues(planWith(line), superseded).map(describeValue)).toEqual(['$400']);
    }
    expect(leftoverValues(planWith('Tickets are $40 per person.'), superseded).map(describeValue)).toEqual(['$40']);
    expect(leftoverValues(planWith('Budget: $1,200 − $400 reserve − $300 fixed costs = $500.'), superseded).map(describeValue)).toEqual(['$400']);
  });

  it('in a calculation, the words before it label the result, not the old value', () => {
    expect(leftoverValues(planWith('Maximum B attendees fundable with the reserve preserved: ($400 − $300) ÷ $5 = 20.'), superseded)).toEqual([]);
  });

  it('with nothing worked out, the old value is read strictly, as before', () => {
    expect(leftoverValues('Spending up to $400 authorized.', superseded).map(describeValue)).toEqual(['$400']);
    expect(leftoverValues('Revenue at 8 paid: 8 × $40 = $320.', superseded).map(describeValue)).toEqual(['$40']);
    expect(leftoverValues('Just $40 to join!', superseded).map(describeValue)).toEqual(['$40']);
  });

  it('a table row is read against the whole document it is part of', () => {
    const row = '{"finding":"Financial limit: ($400 − $300) ÷ $5 = 20.","status":"accepted"}';
    expect(leftoverValues(row, superseded)).toHaveLength(1);
    expect(leftoverValues(row, superseded, { derivedIn: `Spendable: $1,200 − $800 = $400.\n${row}` })).toHaveLength(0);
  });

  it('a message names the line that states it, not only the fact', () => {
    const named = namedLeftovers(leftoverMentions('{"finding":"Keep the $400 reserve.","why":"x"}', superseded));
    expect(named.map((n) => n.text)).toEqual(['$400 in "Keep the $400 reserve."']);
    expect(named[0].value.now).toBe('The minimum unspent reserve is $800, replacing $400.');
  });
});

describe('a superseded price is caught only where it applies (7 Nov, production, a rollout plan)', () => {
  const fact = (id: string, statement: string, supersedes: string | null, retired: string | null = null): ProjectFact => ({
    id, project_id: 'p', user_id: 'u', statement, subject: null, kind: 'fact', source_kind: 'user_edit', source_ref: {},
    accepted_by: 'user', agent_run_id: null, supersedes, retired_at: retired, retired_reason: null, created_at: '2026-11-07T23:24:00Z',
  });
  const superseded = supersededFactValues([
    fact('old', 'Data migration: $8,000 fixed.', null, '2026-11-07T23:24:00Z'),
    fact('new', 'Data migration: $13,000 fixed, including data-quality assessment and all required cleansing.', 'old'),
  ]);
  // The lines the repair of the plan was refused for, as saved.
  const plan = [
    '| Training, 8 sessions × $1,000 | 8 × $1,000 = **$8,000** | Conditional booking after G2 |',
    '| **Committed** | $43,000 + $8,000 = **$51,000** | |',
    'The $8,000 training line now shows its working from current values.',
  ].join('\n');

  it('passes the worked-out training cost, bold or not', () => {
    expect(superseded.map(describeValue)).toEqual(['$8000']);
    expect(leftoverMentions(plan, superseded)).toEqual([]);
    expect(derivedValues('8 × $1,000 = **$8,000**').has('8000')).toBe(true);
    expect(derivedValues('8 × $1,000 = __$8,000__').has('8000')).toBe(true);
  });

  it('still catches the old migration price, labelled or in a sentence, beside the same training line', () => {
    for (const line of ['Data migration: $8,000', '| Data migration | $8,000 | Fixed |', '| **Data migration** | **$8,000** | Fixed |', 'Migration costs $8,000.']) {
      expect(leftoverValues(`${plan}\n${line}`, superseded).map(describeValue)).toEqual(['$8000']);
    }
  });

  it('a row labelled as something else is not the migration price, even with nothing worked out', () => {
    expect(leftoverValues('| Training | $8,000 |', superseded)).toEqual([]);
    expect(leftoverValues('Training: $8,000 for the eight sessions.', superseded)).toEqual([]);
  });

  it('a sentence with no label of its own is read strictly', () => {
    expect(leftoverValues('We spend $8,000 in Week 5.', superseded).map(describeValue)).toEqual(['$8000']);
  });

  it('an old figure with no label of its own is read strictly: a row called Price is still the old price', () => {
    const s = supersededValues('TeamNotes launches November 12, 2026 at $12 per user per month', 'TeamNotes launches November 12, 2026 at $15 per user per month');
    expect(leftoverValues('| Price | $12 |', s).map(describeValue)).toEqual(['$12']);
  });

  it('never exempts an operand, or a key in serialised rows', () => {
    const labelled = supersededValues('Ticket price: $40', 'Ticket price: $30');
    expect(leftoverValues('Revenue at 8 paid: 8 × $40 = $320.', labelled).map(describeValue)).toEqual(['$40']);
    expect(leftoverValues('{"finding":"Keep the $40 ticket."}', labelled).map(describeValue)).toEqual(['$40']);
    expect(leftoverValues('{"item":"Training: $40"}', labelled).map(describeValue)).toEqual(['$40']);
  });

  describe('the old price was one of a list (9 Nov, production, the same plan again)', () => {
    const fromList = supersededFactValues([
      fact('old', 'Fixed prices: process mapping $6,000; configuration $18,000; migration $8,000; launch support $6,000.', null, '2026-11-07T23:24:00Z'),
      fact('new', 'Fixed prices: process mapping $6,000; configuration $18,000; migration $13,000 (including the data-quality assessment and all required cleansing); launch support $6,000.', 'old'),
    ]);
    // The lines both repairs of the plan were refused for, as saved.
    const saved = [
      '| Training, eight sessions | $8,000 | 8 × $1,000 |',
      '| **Planned total** | **$51,000** | $43,000 + $8,000 |',
      '| Training, eight sessions | $8,000 | 8 × $1,000, current session count and price |',
      'I also added a worked headroom check showing that the $8,000 training line and the $51,000 total are derived from current values: 8 sessions × $1,000, and $43,000 + $8,000.',
    ].join('\n');

    it('passes the training line, with its sum written after the result', () => {
      expect(fromList.map(describeValue)).toEqual(['$8000']);
      expect(leftoverMentions(saved, fromList)).toEqual([]);
    });

    it('still catches the old migration price, however it is written', () => {
      for (const line of ['| Migration | $8,000 | Fixed |', 'Migration: $8,000', 'Process mapping $6,000; configuration $18,000; migration $8,000.', 'Migration costs $8,000.', 'The $8,000 migration fee is fixed.']) {
        expect(leftoverValues(`${saved}\n${line}`, fromList).map(describeValue), line).toEqual(['$8000']);
      }
    });

    it('a row that names migration in another cell is still caught', () => {
      expect(leftoverValues('| Cost | $8,000 | migration fee |', fromList).map(describeValue)).toEqual(['$8000']);
    });

    it('a sentence naming something else, with nothing worked out, is not the old price', () => {
      expect(leftoverValues('Training costs $8,000.', fromList)).toEqual([]);
    });

    it('a label that names nothing is read strictly', () => {
      expect(leftoverValues('| Amount | $8,000 |', fromList).map(describeValue)).toEqual(['$8000']);
      expect(leftoverValues('The fee is $8,000.', fromList).map(describeValue)).toEqual(['$8000']);
    });
  });

  it('a sum counts as worked out wherever its result is', () => {
    expect(derivedValues('| Training | $8,000 | 8 × $1,000 |').has('8000')).toBe(true);
    expect(derivedValues('Eight sessions at $1,000 each.').has('8000')).toBe(true);
    expect(derivedValues('8 sessions × $1,000').has('8000')).toBe(true);
    expect(derivedValues('$43,000 + $8,000').has('51000')).toBe(true);
    expect(derivedValues('$6,000 + 8 × $1,000').has('14000')).toBe(true);
  });

  it('words beside a figure are not a sum', () => {
    expect([...derivedValues('Budget $58,000, with at least $7,000 always uncommitted.')]).toEqual([]);
    expect([...derivedValues('Weeks 2-4 and Weeks 5–6.')]).toEqual([]);
    expect([...derivedValues('Launch at 9 on Tuesday.')]).toEqual([]);
  });

  it('a multiplication sign is not taken for emphasis', () => {
    expect([...derivedValues('2 * $4 * 5 = $40')]).toEqual(['40']);
  });

  it('the message quotes the line as it is written', () => {
    const named = namedLeftovers(leftoverMentions('**Data migration:** $8,000 this year.', superseded));
    expect(named[0].text).toContain('**Data migration:**');
  });
});

describe('a paragraph that sets old choices aside (9 Nov, production)', () => {
  const superseded = supersededValues('Budget $60,000, with $6,000 uncommitted.', 'Budget $58,000, with $7,000 uncommitted.');
  const saved = 'Earlier planning choices no longer apply. These include six sessions of 12, the $60,000 budget with a $6,000 minimum. All of them were superseded by the sponsor revision of 8 Nov.';

  it('reports them, as the sponsor asked', () => {
    expect(leftoverMentions(saved, superseded)).toEqual([]);
  });

  it('carries through several sentences that carry on', () => {
    expect(leftoverMentions('Earlier choices no longer apply. These include the $60,000 budget. They also include the $6,000 minimum.', superseded)).toEqual([]);
  });

  it('a "these" with nothing set aside before it still states the value', () => {
    expect(leftoverValues('The plan is settled. These include the $60,000 budget.', superseded)).toHaveLength(1);
  });

  it('the set-aside ends with its paragraph', () => {
    expect(leftoverValues('Earlier choices no longer apply.\n\nThese include the $60,000 budget.', superseded)).toHaveLength(1);
  });
});
