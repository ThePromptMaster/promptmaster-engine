import type { Example } from './index';

/**
 * A committee memo on an invented company. The financials contradict the
 * seller's teaser on purpose, in three places a careful reader would catch:
 * the top customer is 34% of revenue rather than "roughly 18%", add-backs are
 * over a quarter of adjusted EBITDA rather than "modest", and capex is about 7%
 * of revenue rather than "under 3%". On reported EBITDA the proposed debt
 * cannot be serviced. So a check has something real to find, which is the point
 * of the example.
 *
 * Revenue less COGS less SG&A is reported EBITDA, and reported plus add-backs is
 * adjusted, in every year (`examples.test.ts`).
 */
const FINANCIALS = `fiscal_year,revenue,cogs,sga,reported_ebitda,addbacks,adjusted_ebitda,capex,top_customer_revenue
2021,56.1,41.5,7.6,7.0,0.9,7.9,2.4,13.2
2022,63.4,47.2,8.4,7.8,1.1,8.9,3.1,16.4
2023,70.2,52.3,9.4,8.5,1.6,10.1,3.9,20.1
2024,77.8,57.7,10.6,9.5,2.6,12.1,4.6,24.6
2025,84.0,61.9,11.3,10.8,3.9,14.7,5.8,28.6
`;

export const INVESTMENT_MEMO: Example = {
  key: 'investment_memo',
  slug: 'investment-memo',
  icon: 'request_quote',
  design: {
    name: 'Investment memo',
    description: 'From a teaser and a data file to a committee memo: numbers worked out, claims checked, a price named.',
    deliverable: 'investment memo',
    inquiry: true,
    execution: {
      kind: 'finite',
      success_criterion:
        'The memo names a recommendation and a price, every figure in it traces to the data file or a stated assumption, and every teaser claim the data contradicts is stated with both numbers.',
      stop_conditions: [],
    },
    stages: [
      {
        label: 'Deal brief',
        short_label: 'Brief',
        kind: 'write',
        purpose: 'What the committee has to decide and what the memo must answer. Read it and change anything that is wrong.',
        instruction:
          'State the decision the committee faces, who decides, what would make it a yes, the questions the memo must answer, the material on hand and what is out of scope. This is the brief, not the analysis: state no conclusions.',
        required: true,
        approval: 'I approve this brief',
        approval_kind: 'routine',
      },
      {
        label: 'Financial analysis',
        short_label: 'Analysis',
        kind: 'write',
        purpose: 'The numbers worked out from the data, and each claim in the material checked against them. Go can compute these rather than estimate them.',
        instruction:
          'Work from the data file and the supplied material. Give revenue growth; reported and adjusted EBITDA and their margins by year; add-backs as a share of adjusted EBITDA; capex as a share of revenue; the top customer as a share of revenue by year. ' +
          'Check every claim in the seller\'s material against the data and list each one that does not hold, with both figures. ' +
          'Then the debt at the proposed multiple, the annual interest, and cash flow after capex and interest on both the adjusted and the reported figures. ' +
          'Then returns at the asking price on the stated hold and exit, naming your growth assumption, and the entry price that clears the hurdle. Show the working. Compute; do not estimate. Label anything assumed.',
        required: true,
        approval: '',
      },
      {
        label: 'Risks and open questions',
        short_label: 'Risks',
        kind: 'write',
        purpose: 'What could change the decision, ranked, and what diligence would have to settle.',
        instruction:
          'Rank the risks that could change the decision. For each: the evidence with its numbers, what could go wrong, how much it would matter to returns, and the specific diligence request that would settle it. Include only risks the material supports, and say what the material does not cover.',
        required: true,
        approval: '',
      },
      {
        label: 'Investment memo',
        short_label: 'Memo',
        kind: 'write',
        purpose: 'The memo itself, recommendation first, using the numbers already established. Try changing something afterwards, such as a lower price, and see which parts update.',
        instruction:
          'Write the memo in the requested format, recommendation first: go ahead at the asking price, at a lower price you name, or pass, with the reasons. Quote the numbers already established exactly. State every seller claim the data contradicts. Mark assumptions as assumptions. Write for a reader who will not open the data file.',
        required: true,
        approval: '',
      },
      {
        label: 'Final review',
        short_label: 'Review',
        kind: 'check',
        purpose: 'A hard read of the memo as the committee would give it. Decide each finding, then sign off.',
        instruction:
          'Read the memo as the committee\'s toughest reader. Raise a finding for each figure that does not trace to the analysis, each contradiction left out, each claim the material does not support, and any recommendation its own numbers do not carry.',
        required: true,
        approval: 'I approve this memo for the investment committee',
      },
    ],
  },
  project: {
    title: 'Harrowgate Cold Chain: committee memo (example)',
    objective:
      'Write an investment committee memo on Harrowgate Cold Chain Services: should we move to a letter of intent at the asking price, at a lower price we name, or pass?',
    audience: "Fernhollow Capital Partners' investment committee",
    constraints:
      'Use only the supplied material and the data file. Where the teaser and the data disagree, say so and use the data. Label anything we assume.',
    output_format: 'A memo: recommendation first, then the business, the numbers, the risks, what diligence must settle, and the price.',
    mode: 'analyst',
    context: `SAMPLE MATERIAL. Everything below is invented for this example: the company, the people and every number.

Seller's teaser, Project Harrow (Harrowgate Cold Chain Services):
- Refrigerated distribution for regional grocers and food-service operators across Ohio, Indiana and Michigan. 11 cross-dock sites, 240 trucks. Founded 2004, founder-owned.
- FY2025 revenue $84.0M, adjusted EBITDA $14.7M (17.5% margin). Revenue growing about 11% a year since 2021.
- "Diversified base: no customer is above roughly 18% of revenue." 92% logo retention.
- "Modest owner add-backs."
- "Capex-light: maintenance capex under 3% of revenue."
- Asking price: $118M enterprise value, 8.0x FY2025 adjusted EBITDA.

Our proposed structure (Fernhollow Capital Partners, Fund III):
- Senior debt at 5.0x adjusted EBITDA, about 10.5% all-in. Sponsor equity for the balance.
- Five-year hold, exit at the entry multiple.
- Our hurdle: 20% gross IRR and 2.5x MOIC.

Our associate's notes from the management call:
- The founder retires at close. The COO has run operations for six years and wants to stay.
- The largest customer is Brightmeadow Markets. Its contract renews in June of next year. Management calls the relationship solid but has not shared the contract.
- Diesel and refrigerant swings are passed through on about 70% of contracts.
- Two sites opened in 2024 are "still ramping".

Data file: harrowgate_financials.csv holds five fiscal years from the seller's data room, in USD millions.`,
  },
  prepared: `**The decision.** Should Fernhollow Capital Partners (Fund III) move to a letter of intent on Harrowgate Cold Chain Services at the $118M asking price, at a lower price we name, or pass?

**Who decides.** The investment committee, on this memo, without opening the data room.

**What would make it a yes.** At least a 20% gross IRR and 2.5x MOIC on a five-year hold, exiting at the entry multiple, with debt the business can actually service.

**What the memo has to answer.**
1. What the business really earns, and how much of that depends on add-backs.
2. Whether the seller's teaser holds up against the data room.
3. What we can pay, and what has to be true for that price to work.
4. What diligence must settle before we sign anything.

**What we have.** The seller's teaser, our associate's notes from the management call, and five fiscal years of financials in harrowgate_financials.csv.

**Out of scope.** Legal structure, tax, and financing terms beyond the senior debt assumption.`,
  files: [{ name: 'harrowgate_financials.csv', text: FINANCIALS }],
};
