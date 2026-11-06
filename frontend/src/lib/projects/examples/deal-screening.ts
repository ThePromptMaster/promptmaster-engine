import type { Example } from './index';

/**
 * Screening inbound deals against a fund's mandate: the Assessment workflow's
 * shape (criteria once, then batches judged against them, then a shortlist) with
 * a private equity brief. Six invented teasers, built to land differently:
 * two clear fits; two close calls (one silent on a must-have, one that clears the
 * EBITDA floor only on its adjusted figure); two out (customer concentration, and
 * a minority stake). None of it depends on knowing the companies, because they do
 * not exist.
 */
const TEASERS = `Tamarack Ridge Fasteners (Wisconsin). Family-owned maker of specialty fasteners for agricultural equipment manufacturers. Revenue $62M, EBITDA $9.1M (14.7% margin). Largest customer is 19% of revenue. Second-generation owners want to retire; the plant manager and CFO will stay. Asking about $75M.

Bluewater Compliance Group (Texas). Founder-owned environmental testing and compliance reporting for mid-size refiners, on three-year contracts; 70% of revenue recurs. Revenue $38M, EBITDA $8.4M (22% margin). Largest customer is 14% of revenue. A fragmented market: the owner has a list of 12 add-on targets. Asking $92M.

Ironbark Field Services (Alberta). Family-owned maintenance crews for wind and solar sites. Revenue $47M, EBITDA $6.2M (13.2% margin). "Long-standing relationships with major operators"; the teaser gives no customer breakdown. Asking $68M.

Larkspur Dental Labs (Pennsylvania). Founder-owned dental prosthetics lab selling to about 900 practices; the largest is 3% of revenue. Revenue $29M, reported EBITDA $3.8M (13.1% margin), "adjusted EBITDA $5.2M" after add-backs. Asking $58M.

Kestrel Route Logistics (Georgia). Founder-owned last-mile delivery for furniture retailers. Revenue $110M, adjusted EBITDA $13.2M (12% margin). Largest customer is 31% of revenue, on a contract that renews annually. Asking $125M.

Silverpine Packaging Holdings (Ontario). A 30% minority stake in a sponsor-backed corrugated packaging group. Revenue $210M, EBITDA $31M. Asking $64M for the stake.`;

export const DEAL_SCREENING: Example = {
  key: 'deal_screening',
  slug: 'deal-screening',
  icon: 'filter_alt',
  design: {
    name: 'Deal screening',
    description: 'Set the criteria once, then judge every deal against them on a traffic light, and shortlist what to take forward.',
    deliverable: 'deal shortlist',
    inquiry: false,
    execution: {
      kind: 'finite',
      success_criterion:
        'Every deal has a verdict that names the criteria it meets and misses from what its teaser states, anything the teaser is silent on is said, and the shortlist names what to ask next.',
      stop_conditions: [],
    },
    stages: [
      {
        label: 'Mandate and criteria',
        short_label: 'Criteria',
        kind: 'write',
        purpose: 'What the fund buys, written as criteria a teaser can meet or miss. Every deal is judged against them.',
        instruction:
          'Write the criteria every deal will be judged against, from the fund\'s mandate: the must-haves (a deal missing one cannot get the best verdict), the strong positives and the deal-breakers. ' +
          'Make each one something a teaser could show or fail to show, and say how to treat a teaser that is silent on a must-have, and an EBITDA figure that is only adjusted. ' +
          'Then say what puts a deal at the top of a verdict scale, what makes a close call and what rules a deal out, without naming the levels.',
        required: true,
        approval: 'I approve these criteria for judging every deal',
      },
      {
        label: 'Screen the deals',
        short_label: 'Screen',
        kind: 'assess',
        purpose: 'Paste teasers a few at a time. Each one is judged against the criteria, and every batch adds to the table.',
        instruction:
          'Judge each deal strictly against the approved criteria. Name the must-haves it meets and misses, quoting its figures. Where the teaser is silent on one, say so rather than assume, and name the question that would settle it.',
        required: true,
        approval: '',
        scale: 'traffic',
        item_noun: 'deals',
        offered_batch: TEASERS,
      },
      {
        label: 'Shortlist',
        short_label: 'Shortlist',
        kind: 'write',
        purpose: 'Where the deals stand, written to share with the team. Go back to Screen to add more at any time.',
        instruction:
          'Summarise the table for the deal meeting: how many deals were screened and how many sit at each verdict; the deals to take forward, one line each on why; the close calls, each with the one question that would settle it; and what was ruled out and why. Work from the table and never re-judge a deal.',
        required: true,
        approval: 'I approve this shortlist to share',
      },
    ],
  },
  project: {
    title: "This week's inbound deals (example)",
    objective: "Screen this week's inbound deals against Fund III's mandate and produce a shortlist for Monday's deal meeting.",
    audience: 'The deal team at Fernhollow Capital Partners',
    constraints: 'Judge only what each teaser states. Where a teaser is silent on a must-have, say so and do not assume.',
    output_format: '',
    mode: 'analyst',
    context: `SAMPLE MATERIAL. Everything below is invented for this example: the fund, the companies and every number.

Fernhollow Capital Partners, Fund III: $420M, lower middle market, control buyouts.

Must-haves: North America. B2B services or light manufacturing. EBITDA of $5M to $20M. Enterprise value up to $160M. EBITDA margin above 12%. No customer above 25% of revenue. Founder or family owned.

Strong positives: recurring or contracted revenue. A fragmented market with add-on targets. Management willing to stay.

Deal-breakers: turnaround situations. More than 40% of revenue from one regulated payer. Environmental liability that is not ring-fenced. Minority stakes.`,
  },
  prepared: `**What every deal is judged against.** Fernhollow Capital Partners, Fund III: control buyouts in the lower middle market.

**Must-haves.** A deal missing any of these cannot get the best verdict.
- Based in North America.
- B2B services or light manufacturing.
- EBITDA of $5M to $20M. Use the reported figure. A deal that clears the floor only on adjusted EBITDA is a close call, and the add-backs are the question to ask.
- Enterprise value up to $160M.
- EBITDA margin above 12%.
- No customer above 25% of revenue. A teaser that gives no customer breakdown is silent on this must-have: a close call, not a pass.
- Founder or family owned.

**Strong positives.** Recurring or contracted revenue. A fragmented market with add-on targets. Management willing to stay.

**Deal-breakers.** Turnaround situations. More than 40% of revenue from one regulated payer. Environmental liability that is not ring-fenced. Minority stakes.

**How verdicts work.** The best verdict meets every must-have and hits no deal-breaker. A close call misses nothing outright but is silent on a must-have or depends on an adjusted figure. Anything that misses a must-have or hits a deal-breaker is ruled out, however good the rest looks.`,
};
