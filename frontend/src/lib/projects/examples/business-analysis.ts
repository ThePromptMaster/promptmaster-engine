import type { Example } from './index';

/**
 * A build-or-not decision for an invented company. The operations note says the
 * West is about 40% of orders and that a site would pay back inside two years;
 * the data says 32%, and on the note's own costs a site loses money at today's
 * volume. A third-party warehouse, which nobody asked about but the note
 * mentions, beats it until West volume is about three and a half times what it is now. So
 * the honest answer differs from the question, which is what a chat tends to miss.
 */
const WEST_ORDERS = `month,orders_total,orders_west,ship_cost_west_usd,avg_delivery_days_west,refund_rate_west_pct
2024-10,24431,7319,84350,6.2,4.4
2024-11,27252,8070,92449,6.3,4.1
2024-12,28216,8401,96710,6.3,4.1
2025-01,26359,7818,90060,6.3,4.4
2025-02,26930,8119,93287,6.2,4.2
2025-03,27036,8119,93568,6.1,4.1
2025-04,27645,8294,96535,6.1,4.0
2025-05,28084,8563,99867,6.2,4.2
2025-06,28901,8824,103661,6.2,4.0
2025-07,29324,9043,104868,6.2,4.1
2025-08,30051,9311,108185,6.3,3.9
2025-09,30688,9406,109524,6.3,4.0
2025-10,30899,9656,113086,6.3,4.0
2025-11,34906,10903,127840,6.1,4.2
2025-12,35440,11078,130248,6.0,4.1
2026-01,33091,10521,124224,6.1,4.0
2026-02,33415,10405,122080,6.0,3.8
2026-03,33680,10580,123818,6.2,3.9
2026-04,34688,10901,128128,6.1,4.1
2026-05,35180,11318,132702,6.0,3.9
2026-06,35689,11551,135219,6.0,3.8
2026-07,36098,11454,136090,6.0,3.8
2026-08,36569,11766,138634,6.1,4.0
2026-09,37507,12272,145585,6.1,3.8
`;

export const BUSINESS_ANALYSIS: Example = {
  key: 'business_analysis',
  slug: 'business-analysis',
  icon: 'query_stats',
  design: {
    name: 'Business analysis',
    description: 'From a question and a data file to a recommendation: options compared on the same basis, and what the data cannot say.',
    deliverable: 'recommendation',
    inquiry: true,
    execution: {
      kind: 'finite',
      success_criterion:
        'The recommendation answers the question first, every figure traces to the data file or a stated assumption, each option is compared on the same basis, and what the data cannot say is stated.',
      stop_conditions: [],
    },
    stages: [
      {
        label: 'The question',
        short_label: 'Question',
        kind: 'write',
        purpose: 'The decision to make, who makes it, and what would count as a good answer. Read it and change anything that is wrong.',
        instruction:
          'State the decision, who makes it, what would count as a good answer, the options on the table, the material on hand and what is out of scope. This is the framing, not the analysis: state no conclusions.',
        required: true,
        approval: 'I approve this framing',
        approval_kind: 'routine',
      },
      {
        label: 'Analysis',
        short_label: 'Analysis',
        kind: 'write',
        purpose: 'The numbers worked out from the data, each option compared on the same basis, and what the data cannot say. Go can compute these rather than estimate them.',
        instruction:
          'Work from the data file and the supplied notes. Establish the current volumes and costs from the data, and check every figure the notes claim against it, listing each one that does not hold with both numbers. ' +
          'Compare every option the material mentions on the same basis: annual cost, annual saving, net effect at today\'s volume and at a stated growth rate, payback, and the volume at which one option overtakes another. ' +
          'Say what the data cannot answer. Show the working. Compute; do not estimate. Label anything assumed.',
        required: true,
        approval: '',
      },
      {
        label: 'Recommendation',
        short_label: 'Recommendation',
        kind: 'write',
        purpose: 'The answer first, then why, what it costs, what could change it and what to do next.',
        instruction:
          'Write the recommendation in the requested format, the answer first, even if it is not one of the options the question asked about. Quote the numbers already established exactly. State where the data contradicts the notes. Say what would change the answer and what to do next.',
        required: true,
        approval: '',
      },
      {
        label: 'Final review',
        short_label: 'Review',
        kind: 'check',
        purpose: 'A hard read of the recommendation as the decision-maker would give it. Decide each finding, then sign off.',
        instruction:
          'Read the recommendation as a sceptical decision-maker. Raise a finding for each figure that does not trace to the analysis, each option compared unfairly, each claim the material does not support, and anything a reader would need before acting.',
        required: true,
        approval: 'I approve this recommendation to share',
      },
    ],
  },
  project: {
    title: 'Brackenfield Home Goods: a West Coast site? (example)',
    objective: 'Should Brackenfield Home Goods open its own West Coast fulfilment site in Reno next year?',
    audience: 'The CEO and CFO of Brackenfield Home Goods',
    constraints:
      'Use only the supplied notes and the data file. Where the notes and the data disagree, say so and use the data. Label anything we assume.',
    output_format: 'A decision memo: the answer first, then the reasons, the numbers, what could change it, and next steps.',
    mode: 'analyst',
    model: 'anthropic/claude-sonnet-5.5',
    context: `SAMPLE MATERIAL. Everything below is invented for this example: the company, the people and every number.

Brackenfield Home Goods sells homeware online across the US from one warehouse in Columbus, Ohio.

Note from the VP of Operations:
- "The West is about 40% of our orders now and it's the part of the business we serve worst. Six days to deliver, and refunds run high because of it."
- "A Reno site pays back inside two years. Carrier quotes put a West order shipped from Reno at about $7.60."
- Costs of our own site: lease and staff about $46,000 a month; extra inventory carrying cost about $68,000 a year; one-time setup about $480,000.
- "There's also a third-party warehouse in Reno that quoted us. $1.35 per order on top of what we pay now, $60,000 to onboard, no lease. I don't think we should give a third party our customers, but it's an option."
- West deliveries from Reno would take about 2 to 3 days. "We think that lifts conversion, but nobody has measured it."

Data file: brackenfield_west_orders.csv holds 24 months of orders and West Coast shipping. It has no East Coast costs or refund rates.`,
  },
  prepared: `**The decision.** Should Brackenfield Home Goods open its own West Coast fulfilment site in Reno next year?

**Who decides.** The CEO and CFO, on this memo.

**What would count as a good answer.** A clear yes or no, with the money worked out at today's volume and at a stated growth rate, and the point at which the answer would change.

**The options on the table.** Our own site in Reno, a third-party warehouse in Reno, or staying with Columbus alone.

**What we have.** A note from the VP of Operations, and 24 months of orders and West Coast shipping in brackenfield_west_orders.csv.

**Out of scope.** Moving the Columbus warehouse, and any change to the product range.`,
  files: [{ name: 'brackenfield_west_orders.csv', text: WEST_ORDERS }],
};
