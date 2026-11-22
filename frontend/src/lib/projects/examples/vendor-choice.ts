import type { Example } from './index';

/**
 * A decision that changes halfway (22 Nov, Sean: "make a change midway through a
 * project and immediately see which parts of the plan they can still use, which need
 * to be redone, and what genuinely needs their judgment"; L-277). An invented
 * community theatre chooses a box-office system from three quotes, against a hard
 * budget cap and an on-sale date. Option C is the cheapest but misses the date, so B
 * is the lowest-cost option that meets both. The user chooses on the approval stage.
 *
 * The demo change: Option B's card readers rise from $1,975 to $3,100. B is then
 * $21,750, still under the cap but above A's $21,450, so the choice is a real one
 * again: the decision is set aside, the stages that used B's quote are redone, the
 * brief stands, and the choice comes back to the user. Each quote is its own fact,
 * labelled "Option B (…)", so a change to one option is read as that option's.
 */
export const VENDOR_CHOICE: Example = {
  key: 'vendor_choice',
  slug: 'vendor-choice',
  icon: 'balance',
  design: {
    name: 'Vendor decision memo',
    description: 'From three quotes to a decision the board can read: each option costed against the budget and the deadline, your choice recorded, and a memo that follows it.',
    deliverable: 'decision memo',
    inquiry: false,
    fixed_stages: true,
    execution: {
      kind: 'finite',
      success_criterion:
        'The memo records the option the user chose and its all-in cost, every option is costed with its sum shown and tested against the budget cap and the on-sale date, the recommendation is the lowest-cost option that meets both, and nothing in it rests on a figure the quotes do not give.',
      stop_conditions: [],
    },
    stages: [
      {
        label: 'Brief',
        short_label: 'Brief',
        kind: 'write',
        purpose: 'What is being decided, by whom and by when, and the two requirements every option must meet. Read it and change anything that is wrong.',
        instruction:
          'State the decision, who makes it and by when, the requirements every option must meet, and the quotes on hand. Use only what the brief and the quotes say.',
        required: true,
        approval: 'I approve this brief',
        approval_kind: 'routine',
      },
      {
        label: 'Costs and eligibility',
        short_label: 'Costs',
        kind: 'write',
        purpose: 'Each option costed all-in with its sum shown, and tested against the budget cap and the on-sale date.',
        instruction:
          'For each option, add its quoted parts to an all-in year-one cost and show the sum. Test each against the budget cap and the on-sale date, and say which options meet both. Call the options Option A, Option B and Option C, as the quotes do. Use only the quoted figures.',
        required: true,
        approval: '',
      },
      {
        label: 'Draft memo',
        short_label: 'Draft',
        kind: 'write',
        purpose: 'The one-page memo for the board, recommending the lowest-cost option that meets both requirements.',
        instruction:
          'Write the one-page memo: the recommendation and its reason, the options side by side with each total, which fail which requirement, and the next step. Mark it as a draft awaiting the decision.',
        required: true,
        approval: '',
      },
      {
        label: 'Check',
        short_label: 'Check',
        kind: 'check',
        purpose: 'A hard read of the draft: every figure against the quotes, every sum, and the recommendation against the requirements. Decide each finding.',
        instruction:
          'Check the draft memo: each figure against the quotes, each sum, each option against the cap and the on-sale date, and that the recommendation is the lowest-cost option that meets both. Raise a finding for each error and say what to change.',
        required: true,
        approval: '',
      },
      {
        label: 'Approve an option',
        short_label: 'Approve',
        kind: 'write',
        purpose:
          "Choose an option. Then change a quote in Facts, for example Option B's card readers from $1,975 to $3,100 (B is then $21,750, still under the cap but above A), and see what still stands, what is redone and what needs you.",
        instruction:
          'Set the options side by side for the decision: Option A, Option B and Option C, each with its all-in cost, its go-live date, and whether it meets the budget cap and the on-sale date. Say which one the checked draft recommends, and that the choice is the user\'s. Do not record a choice the user has not made.',
        required: true,
        approval: 'I choose the box-office system to buy',
        approval_kind: 'decision',
      },
      {
        label: 'Final memo',
        short_label: 'Final',
        kind: 'write',
        purpose: 'The memo the board receives, recording the option you chose and its all-in cost.',
        instruction:
          'Write the final one-page memo. It records the option the user chose and its all-in cost, shows every option with its total, and says which requirements each meets. If the chosen option is not the recommended one, say so plainly. No draft markings.',
        required: true,
        approval: 'I approve this memo to send to the board',
      },
    ],
  },
  project: {
    title: 'Riverside Players: box-office system (example)',
    objective:
      "Choose a box-office system for the Riverside Players' spring season: compare the three quotes against our budget and on-sale date, recommend one, and record the one I approve in a one-page memo for the board.",
    audience: 'The Riverside Players board, deciding at its December meeting',
    constraints:
      'Hard cap of $24,000 all-in for the first year. Tickets must be on sale by March 2, 2027. Recommend the lowest-cost option that meets both. Use only the quotes supplied. One page.',
    output_format:
      'A one-page memo: the decision, the options side by side with each total worked out, why the recommended option, and the next step.',
    mode: 'analyst',
    context: `SAMPLE MATERIAL. Everything below is invented for this example: the theatre, the vendors and every figure.

The Riverside Players, a community theatre, is replacing its box office before the spring season. Three vendors quoted for the first year.

Option A (Curtain Call Ticketing): setup $6,500; year-one licence $11,400; card readers $2,350; training $1,200. Tickets on sale February 16, 2027.
Option B (Marquee Box Office): setup $4,800; year-one licence $12,900; card readers $1,975; training $950. Tickets on sale February 23, 2027.
Option C (Footlights POS): setup $3,900; year-one licence $9,600; card readers $2,100; training $800. Tickets on sale March 15, 2027.

From the treasurer: the board will not go above $24,000 all-in for the first year, and the spring season's tickets must be on sale by March 2, 2027.`,
  },
  facts: [
    { statement: 'Hard cap of $24,000 all-in for the first year.', kind: 'requirement' },
    { statement: 'Tickets must be on sale by March 2, 2027.', kind: 'requirement' },
    { statement: 'Option A (Curtain Call Ticketing): setup $6,500; year-one licence $11,400; card readers $2,350; training $1,200; tickets on sale February 16, 2027.', kind: 'fact' },
    { statement: 'Option B (Marquee Box Office): setup $4,800; year-one licence $12,900; card readers $1,975; training $950; tickets on sale February 23, 2027.', kind: 'fact' },
    { statement: 'Option C (Footlights POS): setup $3,900; year-one licence $9,600; card readers $2,100; training $800; tickets on sale March 15, 2027.', kind: 'fact' },
  ],
  prepared: `**The decision.** Which box-office system the Riverside Players buy for the spring season. The board decides at its December meeting; the choice is mine to put to it.

**What every option must meet.**
- A hard cap of $24,000 all-in for the first year.
- Tickets on sale by March 2, 2027.

**How to choose.** The lowest-cost option that meets both.

**What we have.** Three first-year quotes: Option A (Curtain Call Ticketing), Option B (Marquee Box Office) and Option C (Footlights POS), each with setup, licence, card readers, training and an on-sale date.

**Out of scope.** Ticket prices, the season's programme, and anything beyond the first year.`,
};
