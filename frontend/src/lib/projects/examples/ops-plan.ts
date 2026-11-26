import type { Example } from './index';

/**
 * One fact several pieces of work rely on (26 Nov, L-288). Sean, 25 Nov: "Say a
 * supplier changes a delivery date after the plan has gone out. That might affect
 * the staffing schedule and one customer commitment. Other parts of the plan are
 * still good. I want PromptMaster to recognize what that change affects, bring
 * related work up to date where it can, and flag anything that still needs
 * evidence or a decision."
 *
 * An invented food distributor opens a chilled room. The delivery date of the
 * cooling units is its own fact; the price is another, so a change to the date
 * is a change to that fact alone. What the work does with it:
 * - the timeline, the staffing schedule and the plan quote the date, so a change
 *   reopens them directly (`stagesUsingFacts`);
 * - the customer commitment gives the customer only the switch date, which is
 *   worked out from the delivery date: nothing in it quotes the old date, so it is
 *   reopened only when the timeline before it is redone, and then checked against
 *   that change (`keptAfterCheck`), which should find it relied on it;
 * - the budget holds no date and moving the crew booking is free with notice, so
 *   it should be checked and kept.
 *
 * Dates (all 2027, working days Monday to Friday). Delivery Wednesday March 3;
 * installation Thursday March 4 to Thursday March 11; commissioning Friday March 12
 * and Monday March 15; the customer switches Tuesday March 16. With the demo change
 * to Wednesday March 17: installation March 18 to 25, commissioning March 26 and 29,
 * switch Tuesday March 30. No new date equals an old one.
 *
 * Budget: units $38,400 (delivery included) + crew 4 × 6 × $360 = $8,640 +
 * commissioning 2 × $950 = $1,900, so $48,940; with 10% contingency $53,834, within
 * the $55,000 cap. The date change leaves every figure as it was.
 */
export const OPS_PLAN: Example = {
  key: 'ops_plan',
  slug: 'ops-plan',
  icon: 'local_shipping',
  design: {
    name: 'Operations plan with a customer commitment',
    description: 'From supplier, crew and customer facts to a timeline, a staffing schedule, a budget, a customer commitment and the plan the operations team works from.',
    deliverable: 'operations plan',
    inquiry: false,
    fixed_stages: true,
    execution: {
      kind: 'finite',
      success_criterion:
        'Every date follows from the delivery date and the working-day rules in the facts, every cost is worked out with its sum shown and stays within the approved cap, the customer is told only the switch date and what they must do, and the plan the operations team receives agrees with all of it.',
      stop_conditions: [],
    },
    stages: [
      {
        label: 'Brief',
        short_label: 'Brief',
        kind: 'write',
        purpose: 'What is being opened, who does what, and the limits the plan must keep to. Read it and change anything that is wrong.',
        instruction:
          'State what is being opened, the suppliers and the customer involved, what each does, and the cost cap. Use only the facts. Name no dates here: the timeline works them out.',
        required: true,
        approval: 'I approve this brief',
        approval_kind: 'routine',
        mode: 'architect',
        mode_reason: 'It frames the work and its limits',
      },
      {
        label: 'Delivery timeline',
        short_label: 'Timeline',
        kind: 'write',
        purpose: 'Every date worked out from the delivery date: installation, commissioning and the day the customer moves.',
        instruction:
          'Work out the timeline from the facts, counting working days Monday to Friday: the delivery date, installation start and end, commissioning days, and the first day the customer\'s orders move. Show how each date follows from the one before. State the delivery date as the facts give it.',
        required: true,
        approval: '',
        mode: 'analyst',
        mode_reason: 'It works each date out from the delivery date',
      },
      {
        label: 'Staffing schedule',
        short_label: 'Staffing',
        kind: 'write',
        purpose: 'Who is on site on which days, for installation and commissioning.',
        instruction:
          'Open with the day the units are delivered and the day the installation crew starts. Then list, day by day, who is on site: the installation crew (how many people) and the commissioning engineer. Use the dates in the timeline.',
        required: true,
        approval: '',
        mode: 'architect',
        mode_reason: 'It lays out who is where on each day',
      },
      {
        label: 'Budget',
        short_label: 'Budget',
        kind: 'write',
        purpose: 'Every cost worked out with its sum shown, against the approved cap.',
        instruction:
          'Cost the cooling units, the installation crew (people × days × day rate) and commissioning (days × day rate), add 10% contingency, and show each sum. Say whether the total is within the cap. State no dates: costs only.',
        required: true,
        approval: '',
        mode: 'analyst',
        mode_reason: 'It works out and checks every cost',
      },
      {
        label: 'Customer commitment',
        short_label: 'Commitment',
        kind: 'write',
        purpose: 'The note to the customer: the day their orders move to the new room, and what they need to do before it.',
        instruction:
          'Write a short note to Bayview Grocers: the date their chilled orders move to the new room, and what they must do before then (confirm a receiving contact for that day; their delivery address does not change, since the room is in our existing warehouse). Give them that one date only: no delivery, installation or commissioning dates.',
        required: true,
        approval: 'I approve this commitment to send to Bayview Grocers',
        approval_kind: 'decision',
        mode: 'clarity',
        mode_reason: 'It writes plainly for the customer',
      },
      {
        label: 'Operations plan',
        short_label: 'Plan',
        kind: 'write',
        purpose: 'The plan the operations team works from: key dates, who is on site, the budget and what the customer has been told.',
        instruction:
          'Write the operations plan: a key-dates table (delivery, installation start and end, commissioning, the customer\'s switch date), who is on site and when, the budget total against the cap, and what the customer has been told. Everything must agree with the earlier stages.',
        required: true,
        approval: 'I approve this plan to send to the operations team',
        approval_kind: 'decision',
        mode: 'clarity',
        mode_reason: 'It writes the plan for the team that works from it',
      },
    ],
  },
  project: {
    title: 'Lakeside Provisions: chilled room opening (example)',
    objective:
      'Plan the opening of our new chilled room: the delivery and installation timeline, the staffing schedule, the budget, the commitment we send Bayview Grocers, and the plan the operations team works from, all consistent with the supplier, crew and customer facts.',
    audience: 'The Lakeside Provisions operations team, and Bayview Grocers for the commitment',
    constraints:
      'Total cost within the approved $55,000. Count working days Monday to Friday. Use only the facts supplied. Tell the customer only the switch date and what they must do.',
    output_format:
      'An operations plan with a key-dates table, who is on site when, the budget against the cap, and what the customer has been told.',
    mode: 'architect',
    context: `SAMPLE MATERIAL. Everything below is invented for this example: the companies, the people and every figure.

Lakeside Provisions, a food distributor, is opening a new chilled room in its warehouse.

Northwind Refrigeration supplies and delivers the two cooling units for $38,400, delivery included. The delivery date Northwind has confirmed is kept in Facts, where a change to it is made.

Harbor Crew Hire installs the units: 4 people for 6 working days, starting the first working day after delivery, at $360 per person per day. Harbor moves a booking free of charge with 7 days' notice.

Coldline Services commissions the room: 2 working days, starting the first working day after installation ends, at $950 a day.

Bayview Grocers, our largest chilled customer, moves its chilled orders to the new room on the first working day after commissioning. The room is in our existing warehouse, so Bayview's delivery address does not change.

The finance director approved a total of $55,000, contingency included.`,
  },
  facts: [
    { statement: 'Total cost within the approved $55,000, contingency included.', kind: 'requirement' },
    { statement: 'Northwind Refrigeration delivers the two cooling units on March 3, 2027.', kind: 'fact' },
    { statement: "Northwind Refrigeration's price for the two cooling units is $38,400, delivery included.", kind: 'fact' },
    { statement: 'Installation takes Harbor Crew Hire 4 people for 6 working days, starting the first working day after delivery.', kind: 'fact' },
    { statement: "Harbor Crew Hire charges $360 per person per day and moves a booking free with 7 days' notice.", kind: 'fact' },
    { statement: 'Coldline Services commissions the room in 2 working days at $950 a day, starting the first working day after installation ends.', kind: 'fact' },
    { statement: "Bayview Grocers' chilled orders move to the new room on the first working day after commissioning.", kind: 'fact' },
  ],
  prepared: `**What we are opening.** A new chilled room in the Lakeside Provisions warehouse, so that our chilled stock and our largest chilled customer's orders can move into it.

**Who does what.**
- Northwind Refrigeration supplies and delivers the two cooling units.
- Harbor Crew Hire installs them, with a crew of four.
- Coldline Services commissions the room.
- Bayview Grocers, our largest chilled customer, moves its chilled orders to the new room once it is commissioned.

**The limits.** The finance director approved $55,000 in total, contingency included. Working days are Monday to Friday.

**What this plan has to produce.** A timeline worked out from the delivery date, a staffing schedule, a budget against the cap, the commitment we send Bayview Grocers, and the plan the operations team works from.

**Out of scope.** Moving our own stock, and anything after Bayview's orders have moved.`,
};
