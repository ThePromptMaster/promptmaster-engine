import type { ExampleKey } from './cards';

/**
 * What a real production run of each example produced, for its preview page: a
 * visitor sees what they would get with no account and no spend (the client's call,
 * 4 Nov). Copied from the run as it finished, in English, with its date, because
 * a sample of output that was tidied afterwards would be a promise, not a record.
 */
export interface FinishedResult {
  /** The day of the run (ISO). */
  date: string;
  /** Rounded, from when the run started to when it finished, decisions included. */
  minutes: number;
  /** From the project page when the run finished. */
  costUsd: number;
  /** The deliverable as the run left it, in Markdown. */
  text: string;
}

export const FINISHED_RESULTS: Partial<Record<ExampleKey, FinishedResult>> = {
  deal_screening: {
    date: '2026-11-06',
    minutes: 7,
    costUsd: 0.78,
    text: `# Shortlist for Monday's Deal Meeting: Fund III Inbound, This Week

## Screen at a glance

Six deals were screened against the Fund III mandate.

| Verdict | Count | Deals |
| --- | --- | --- |
| Green (take forward) | 2 | Tamarack Ridge Fasteners, Bluewater Compliance Group |
| Amber (close call) | 2 | Ironbark Field Services, Larkspur Dental Labs |
| Red (ruled out) | 2 | Kestrel Route Logistics, Silverpine Packaging Holdings |

All verdicts below come from the screening table as recorded. They are based on what each teaser states and have not been re-judged here.

## Take forward

| Deal | Why |
| --- | --- |
| Bluewater Compliance Group (Texas, B2B services) | Meets every must-have. The teaser states 70% recurring revenue and 12 add-on targets. |
| Tamarack Ridge Fasteners (Wisconsin, light manufacturing) | Meets every must-have on reported EBITDA of $9.1M. Its plant manager and CFO will stay. |

The screen carried these diligence questions forward. They do not hold either deal back:

- Bluewater: Is there any liability from its testing work at refinery sites, and is it ring-fenced? The teaser also does not say whether management stays after the founder exits.
- Tamarack: Is there any environmental liability at the plant, and is it ring-fenced? The teaser also does not mention recurring revenue or add-on targets.

## Close calls

| Deal | Why it is a close call | The question that settles it |
| --- | --- | --- |
| Ironbark Field Services (Alberta) | Meets every stated must-have, with EBITDA of $6.2M, a 13.2% margin and an asking price of $68M. The teaser gives no customer breakdown, so it is silent on the 25% customer limit. | What share of revenue does the largest customer represent, and what share do the top five represent? |
| Larkspur Dental Labs (Pennsylvania) | Reported EBITDA of $3.8M is below the $5M floor. It clears the floor only on adjusted EBITDA of $5.2M. | What are the $1.4M of add-backs, and are they non-recurring? |

The screen also raises a diligence question for Larkspur: what share of revenue depends on one regulated payer, such as a government dental program?

## Ruled out

| Deal | Why |
| --- | --- |
| Kestrel Route Logistics (Georgia) | Misses two must-haves. First, the largest customer is 31% of revenue, above the 25% limit, on a contract that renews annually. Second, the 12% margin is not above 12%, and it is calculated on adjusted EBITDA. No reported EBITDA is given. |
| Silverpine Packaging Holdings (Ontario) | The 30% minority stake is a deal-breaker. It also misses two must-haves: the group is sponsor-backed rather than founder or family owned, and its EBITDA of $31M is above the $20M ceiling. |

## Summary and confidence

Two deals go forward with the same Green verdict: Bluewater and Tamarack. The screen does not rank them. Bluewater's teaser states recurring revenue and add-on targets. Tamarack's teaser mentions neither.

Each close call can be settled with one answer from the seller. The two Red deals fail on more than one ground, so no single correction would bring either back.

Confidence is moderate to high, but only in what the teasers state. Each Green verdict depends on diligence finding no deal-breaker that the teaser did not mention, most notably site or environmental liability.

Next step: Send the Ironbark and Larkspur questions to their sellers before Monday so that both close calls can be resolved at the meeting.
`,
  },
  investment_memo: {
    date: '2026-11-06',
    minutes: 17,
    costUsd: 1.92,
    text: `# Investment Committee Memo: Harrowgate Cold Chain Services (Project Harrow)

To: Fernhollow Capital Partners, Investment Committee Re: Letter of intent on Harrowgate Cold Chain Services, Fund III

All figures are USD millions unless stated. Sources are the seller's teaser, the associate's management-call notes and the five-year data file. Each result is labelled Reasoned, Conditional, Assumption or Speculative. The only computed results are the two data-integrity identities (reported EBITDA plus add-backs equals adjusted EBITDA, and revenue less COGS less SG&A equals reported EBITDA), which held in every year. Everything else was worked by hand from the file rows, including the 2.50x, the about 20.1% IRR and the multiples quoted below. Those results are hand-derived and Conditional, not run output.

## 1. Recommendation

Move to a letter of intent at a ceiling of $107.0M (7.28x adjusted EBITDA), not at the $118M ask, and make it conditional on the items below. $107.0M is a ceiling, not a safe discount: it clears the hurdle only if the full adjusted EBITDA of 14.7 is confirmed. If diligence does not support the full 14.7, re-price or pass.

Reasons:

- The ask fails our hurdles. At $118M the base case returns 2.24x MOIC and 17.5% IRR, against our 20% gross IRR and 2.5x MOIC. 2.5x is the binding test (about 20.1% IRR). (Conditional on 8.0% growth and exit at the entry multiple.)
- $107.0M is the highest price that clears the hurdle. It is about $11M (9%) below the ask. (Conditional on adjusted EBITDA of 14.7 and 8.0% growth.)
- The teaser is contradicted on three points that bear on value: customer concentration, add-backs and capex (section 4).
- $107.0M has no margin of safety. If half the add-backs are rejected, even $107.0M returns 2.16x and 16.7% (Assumption: half of the 3.9 rejected). That is why the letter must be conditional and why the pass trigger is stated.
- The debt-service test in the brief is not met. On reported EBITDA the debt does not service itself, and on adjusted EBITDA it is marginal (section 3).

Conditions of the letter of intent:

1. Itemised add-back schedule and quality-of-earnings review (section 6, item 1).
2. The Brightmeadow contract, including its renewal terms and not only sight of the contract, with the customer's identity confirmed (Reasoned inference: the file names no customer).
3. Capex split between maintenance, replacement and growth.
4. Lender confirmation that 5.0x is available on the confirmed EBITDA.

Pass trigger, in words: any confirmed add-back figure below 3.9 means re-price or pass. No computed break-even level is available, so none is given.

What would change this: a Brightmeadow renewal on worse terms moves us to pass or to a further reduced price. Growth above the 8.0% base would support more than $107.0M, but 11% is above the current pace.

## 2. The business

Seller states that Harrowgate provides refrigerated distribution to regional grocers and food-service operators in Ohio, Indiana and Michigan, with 11 cross-dock sites and 240 trucks, founded 2004 and founder-owned. Seller states 92% logo retention. None of the site, truck, retention or 70% pass-through claims can be tested against the file.

Management points from the call:

- The founder retires at close.
- The COO has run operations for six years and wants to stay.
- Two sites opened in 2024 are "still ramping".
- Seller states that diesel and refrigerant swings pass through on "about 70%" of contracts.

## 3. The numbers

|  | 2021 | 2022 | 2023 | 2024 | 2025 |
| --- | --- | --- | --- | --- | --- |
| Revenue | 56.1 | 63.4 | 70.2 | 77.8 | 84.0 |
| Reported EBITDA | 7.0 | 7.8 | 8.5 | 9.5 | 10.8 |
| Add-backs | 0.9 | 1.1 | 1.6 | 2.6 | 3.9 |
| Adjusted EBITDA | 7.9 | 8.9 | 10.1 | 12.1 | 14.7 |
| Reported margin | 12.5% | 12.3% | 12.1% | 12.2% | 12.9% |
| Adjusted margin | 14.1% | 14.0% | 14.4% | 15.5% | 17.5% |
| Add-backs ÷ adjusted EBITDA | 11.4% | 12.4% | 15.8% | 21.5% | 26.5% |
| Capex | 2.4 | 3.1 | 3.9 | 4.6 | 5.8 |
| Capex ÷ revenue | 4.3% | 4.9% | 5.6% | 5.9% | 6.9% |
| Top customer ÷ revenue | 23.5% | 25.9% | 28.6% | 31.6% | 34.0% |

What this shows (Reasoned):

- Reported margin is flat. The whole rise in adjusted margin, from 14.1% to 17.5%, comes from add-backs. Add-backs explain 3.0 of the 6.8 growth in adjusted EBITDA since 2021 (44%).
- Revenue CAGR 2021–2025 is 10.6%, but growth has slowed to 8.0% in 2025 (13.0%, 10.7%, 10.8% before it).
- The asking price is 8.03x adjusted EBITDA (118 ÷ 14.7) but 10.9x reported EBITDA of 10.8.

Debt at the proposed structure (Reasoned). Senior debt is 5.0x adjusted EBITDA, which is 73.5, at 10.5% all-in. That costs 7.72 of interest, leaving equity of 44.5 at $118M. Fees are assumed at zero because none are supplied.

| FY2025 | On adjusted | On reported |
| --- | --- | --- |
| Cash flow after capex and interest | +1.18 | −2.72 |
| EBITDA ÷ interest | 1.90x | 1.40x |
| (EBITDA − capex) ÷ interest | 1.15x | 0.65x |

These are before tax, working capital and principal, which the material does not give (Conditional). The brief requires debt the business can actually service. That test is unmet on reported EBITDA and marginal on adjusted, with 1.18 of headroom. Debt of 73.5 is kept at 5.0x adjusted EBITDA at $107.0M in the price analysis, so lender confirmation on confirmed EBITDA is a condition of the letter.

Returns at the ask (Conditional). Assumptions: adjusted EBITDA grows 8.0% a year with margin held at 17.5%, debt stays at 73.5, and there are no fees or distributions. Holding 17.5% is an Assumption that works against the evidence above: reported margin is flat, so the held margin requires add-backs to keep rising in step, and they are the item this memo questions.

| Growth | MOIC | IRR |
| --- | --- | --- |
| 0% | 1.00x | 0.0% |
| 8.0% (base) | 2.24x | 17.5% |
| 11.0% | 2.82x | 23.0% |

Only the teaser's growth rate clears both hurdles at the ask, and it exceeds the current pace.

## 4. Where the teaser and the data disagree

We use the data in each case.

| Teaser | Data | Result |
| --- | --- | --- |
| "No customer is above roughly 18% of revenue" | 34.0% in 2025 (28.6 of 84.0); 23.5% even in 2021 | Contradicted |
| "Modest owner add-backs" | 3.9, which is 26.5% of adjusted EBITDA, up from 11.4% | Contradicted |
| "Maintenance capex under 3% of revenue" | Total capex 6.9% (5.8), at least 4.3% every year; no maintenance split | Not supported. For the claim to hold, at least 3.28 of the 5.8 would have to be growth capex, which is unproven |
| Revenue growing about 11% a year | 10.6% CAGR; 8.0% in 2025 | True for the period, not the current rate |
| 8.0x adjusted EBITDA | 8.03x | Holds, but 10.9x on reported |

## 5. Risks

In order of effect on the decision:

1. Add-backs may be recurring costs (Conditional). On reported EBITDA the ask is 10.9x and $107.0M is 9.9x. Debt of 73.5 is 6.8x reported EBITDA. If half the add-backs are rejected, the ask returns 2.02x and 15.1%, and $107.0M returns 2.16x and 16.7% (Assumption).
2. Customer concentration and the Brightmeadow renewal (Reasoned). Brightmeadow is the largest customer and renews in June of next year. Management has not shared the contract. Linking the 28.6 in the file to Brightmeadow is a Reasoned inference, since the file names no customer and the notes give no share. 92% logo retention says little about revenue retention. If the account were lost at the average margin (Assumption), remaining adjusted EBITDA is about 9.7, debt is about 7.6x, interest cover about 1.26x, and exit value at 8.0x with no growth about 77.5 against debt of 73.5. Almost none of the equity would remain.
3. Capex above the teaser's description (Reasoned). If most of the 5.8 is maintenance, the cash flow figures above are the true ones.
4. Thin debt service (Reasoned). This is the compounding effect of risks 1 to 3, not an independent risk, so its effect should not be added to theirs.
5. Slowing growth (Reasoned). The returns depend on it.
6. Founder exit, ramping sites, 70% pass-through (Speculative). These rest on call notes only and cannot be sized.

The material says nothing about tax, working capital, leases, environmental or regulatory matters, litigation or competition.

## 6. What diligence must settle

The letter of intent should be conditional on the four items in section 1. The rest follow before signing.

1. Itemised add-back schedule for 2021–2025 with support, and a quality-of-earnings review classifying each item as non-recurring, owner-specific or recurring. This decides price and debt size.
2. The Brightmeadow contract (term, pricing, volume commitments, renewal terms, termination and change-of-control clauses), confirmation of the name of the customer behind the 34.0% (Reasoned inference until confirmed), revenue and margin by customer, and a reference call with its supply-chain lead.
3. Capex split between maintenance, replacement and growth for 2021–2025, with a fleet and site register.
4. Growth split into price, volume and new sites, plus 2026 year-to-date results and budget.
5. Site-level results for all 11 sites, and the contract list with pass-through terms.
6. Tax, working capital and seasonality, and the lender's terms behind the condition in section 1.
7. Organisation chart, ownership of top-ten customer relationships, the COO's terms and a founder transition agreement.

## 7. Price

|  | Ask | Recommended ceiling (Reasoned by hand, Conditional) |
| --- | --- | --- |
| Enterprise value | $118M | $107.0M |
| Multiple of adjusted EBITDA (14.7) | 8.03x | 7.28x |
| Multiple of reported EBITDA (10.8) | 10.9x | 9.9x |
| Base-case MOIC / IRR | 2.24x / 17.5% | 2.50x / about 20.1% |

Method (Reasoned): debt held at 73.5, growth factor 1.4693 (8.0% over five years), and the entry price solved so that MOIC equals 2.5x. Equity is then 33.5 and exit equity 83.7. Margin held at 17.5% is an Assumption that rests on the add-backs this memo questions.

Downside pairing. The $107.0M price assumes the Brightmeadow renewal. If the account were lost (Reasoned inference that the 34.0% customer is Brightmeadow; Assumption of average margin), exit value of about 77.5 sits against debt of 73.5, and almost none of the equity would remain. The renewal terms are therefore a condition of the letter, not only sight of the contract.

The price depends on three conditions: adjusted EBITDA of 14.7 confirmed, 8.0% growth sustained, and the Brightmeadow contract renewing. If diligence confirms add-backs below 3.9, there is no price we can name from this material that clears the hurdle with any margin, and we recommend a re-price on the confirmed figure or a pass. That re-price needs the add-back schedule from item 1.

The memo is ready to support a conditional letter of intent. Its key results are hand-derived and conditional on the assumptions above.
`,
  },
  business_analysis: {
    date: '2026-11-06',
    minutes: 24,
    costUsd: 1.42,
    text: `# Decision memo: a West Coast fulfilment site in Reno

To: CEO and CFO, Brackenfield Home Goods Question: Should Brackenfield open its own West Coast fulfilment site in Reno next year?

## Answer

Not yet. Do not commit to our own Reno site for next year. At today's volume (132,405 West orders) it costs more than it saves, and that holds at an assumed 10% growth. It reverses on running cost only if West growth repeats the observed 30.7%. The trigger for revisiting is about 148,900 West orders a year.

The third-party Reno warehouse is not yet shown to be a cheaper route. Its result depends on how its $1.35 quote is read. Neither reading is established, though the literal wording of the note leans toward the unfavourable one (reading 2). Clarify the quote in writing before any pilot is considered.

How this stands: Conditional. It rests on the $7.60 carrier quote (A1) and on the reading of the third-party quote (A2). Neither is verified.

## Reasons

1. The own site does not pay back at today's volume. It saves $551,376 a year on shipping and costs $620,000 a year to run, so the net is −$68,624. The VP of Operations' claim of payback "inside two years" does not hold on the data. (Reasoned from the quote; the volume is Calculated.)
2. The cash at risk is real. At today's volume, setup plus a first year's net loss is $480,000 + $68,624 = $548,624. (Derived from the stated figures; conditional on A1.)
3. The decision turns on the growth rate. At 10% growth a year (Assumption), the own site nets −$13,486, which is $13,486 short of break-even. At the observed 30.7% growth it nets +$100,643 and breaks even on running cost next year, but still takes 4.8 years to pay back the $480,000 setup. Break-even on running cost is about 148,900 West orders a year, 12.4% above today's 132,405. Paying back the setup within two years needs about 206,500, which is 56% above today. The 10% figure is our working assumption, not a supplied figure, and it is well below the observed trend. The data cannot separate seasonality from trend (the step up in 2025-11 is one sign), so the 30.7% is itself uncertain. (Reasoned.)
4. The notes overstate the West's size. The notes say West is "about 40% of our orders"; the data shows 31.7%, and never above 32.7% in 24 months. We use the data. The savings depend on West order count, which is taken directly from the file.
5. The third-party result depends on how the quote is read. Both readings are shown in the table below and neither is established. The note says "$1.35 per order on top of what we pay now"; read literally, that leans toward reading 2, the unfavourable one, until the quote is clarified.
6. The own site beats the third party only at very high volume, if the favourable reading holds. That point is about 459,300 orders a year, 3.47 times today. (Reasoned, and conditional on reading 1.)

## The numbers

|  | Own Reno site | Third party, reading 1: $1.35 added to $7.60 | Third party, reading 2: $1.35 added to today's $11.76 |
| --- | --- | --- | --- |
| Annual running cost added | $620,000 | 132,405 × $1.35 = $178,747 | $178,747 |
| One-time cost | $480,000 | $60,000 | $60,000 |
| Gross shipping saving, today | $551,376 | $551,376 | None |
| Net annual effect, today | −$68,624 | +$372,629 | −$178,747 |
| Net at +10% volume (145,646 orders; Assumption: 10% a year) | −$13,486 | +$409,892 | −$196,622 |
| Net at +30.7% volume (173,054 orders) | +$100,643 | +$487,026 | −$233,623 |

The reading 2 figures at +10% and +30.7% are Reasoned here: 145,646 × $1.35 = $196,622 and 173,054 × $1.35 = $233,623, with no shipping saving. Reading 1 at +30.7% is carried from the analysis. All rows are Conditional on A1, A2 and, for the growth rows, the stated growth case.

Basis: West shipping costs $11.76 an order today ($1,557,654 / 132,405), against $7.60 quoted from Reno, a saving of $4.16 an order. The third-party figures are a best case. They apply the unverified $7.60 to all West orders and include no contract minimums, service-level penalties or customer-handover risk, because none are supplied. The own-site figures carry its full lease, staff and carrying costs, so the comparison favours the third party.

## Where the data and the notes disagree

- West share: 40% in the notes against 31.7% in the data. Data used.
- Payback: "inside two years" in the notes against no payback at today's volume in the data. Data used.
- Refunds "run high": the West rate is 3.95%, down from 4.13% the year before. The file has no other region or benchmark, so "high" cannot be tested, and the data shows no rise.
- Delivery time: the notes say "six days to deliver". The data supports this: the average is 6.1 days, with monthly averages between 6.0 and 6.3 (Calculated). The notes put Reno deliveries at about 2 to 3 days, which is an estimate and not observed.

## What the numbers do not include

The faster delivery may lift conversion and cut refunds. The notes say "nobody has measured it," and the file has no conversion, margin or order-value data. To justify the own site on benefits beyond shipping, those benefits would need to be worth $68,624 a year just to break even at today's volume, or $308,624 a year to pay back within two years. We cannot yet say whether that bar is met.

## What could change the answer

- The third-party quote reads as reading 1 and its terms are acceptable. The third-party option would then have a positive net effect, subject to the excluded risks above.
- The quote reads as reading 2. There is no shipping saving and the option only adds $178,747 a year. Then neither Reno option pays on shipping alone.
- The $7.60 rate does not hold across all West orders. The file has no state-level split, so this is unknown.
- West volume passes about 148,900 orders a year and keeps growing, which makes the own site viable on running cost.
- Measured conversion or refund gains large enough to cover the gaps above.
- Third-party contract terms (length, service levels) that are poor, or the VP's concern ("I don't think we should give a third party our customers") proving decisive. That concern is in the notes but not quantified.

## Next steps

1. Get the third-party quote in writing and settle what the $1.35 is added to, plus contract length, minimums and service levels. This decides whether the third party is worth considering.
2. Get the Reno carrier rate by origin state, to test whether $7.60 applies to all West orders.
3. Pull conversion, margin and refund-cost data so the delivery-time benefit can be priced.
4. Consider a pilot only if the quote is confirmed. Pilot scope, length and cost are not in the supplied material (only the $60,000 onboarding is) and are to be set after confirmation. The full-volume saving does not apply to a pilot.
5. Revisit the own site if West volume approaches about 148,900 orders a year or the measured benefits exceed the gaps above.
`,
  },
  slide_deck: {
    date: '2026-11-06',
    minutes: 22,
    costUsd: 2.59,
    text: `## Q3: ARR up 29.6% year on year to $18.4M, but three indicators moved against us

- ARR $18.4M at end of Q3, up from $16.9M at end of Q2 and $14.2M a year ago
- Growth: +29.6% year on year ($18.4M ÷ $14.2M); +8.9% quarter on quarter ($18.4M ÷ $16.9M)
- Against us: new business (slide 2), retention (slide 5), runway (slide 7)

Speaker notes: This is the quarter on one page. ARR grew 29.6% year on year. Three things went the wrong way. New business missed plan, retention weakened, and runway is shorter than the CFO's note suggests. Each one has its own slide. We close with the decision we need from you today: whether to approve six more sales reps in Q4.

## New ARR was $1.1M against a $1.6M plan, a $0.5M shortfall that leaves Q3 at 69% of plan

|  | Q3 |
| --- | --- |
| Plan | $1.6M |
| Actual | $1.1M |
| Shortfall | $1.6M − $1.1M = $0.5M |
| Share of plan | $1.1M ÷ $1.6M = 69% |

Speaker notes: The miss is half a million dollars of new ARR. Total ARR rose $1.5M in the quarter ($18.4M − $16.9M). That is $0.4M more than new ARR ($1.5M − $1.1M), which suggests about $0.4M of net expansion from existing customers. That fits with 104% net revenue retention. Our notes do not break out expansion or churned ARR, though, so treat the $0.4M as an inference, not a reported figure.

## Q4 starts with 2.1x pipeline coverage against a 3x target, so the gap is in pipeline as well as in selling capacity

- Q4 pipeline coverage: 2.1x
- Target: 3x
- Coverage is 70% of target (2.1 ÷ 3)

Speaker notes: Q4 is short before it begins: coverage is 2.1x against a 3x target, which is 70% of target. Our notes do not give a historical conversion rate, so we cannot say how much harder plan is to reach from here, only that we start below the coverage we set ourselves. This matters for the ask. More reps can work more pipeline, but adding reps does not create the pipeline right away. Hold onto that point when we get to the hiring request.

## With two of four reps still ramping, current selling capacity is not yet fully productive

- Four reps in total
- Two are still ramping
- Win rate 24%; the notes give no target, prior period or benchmark to judge it against

Speaker notes: Half the current team is still ramping. We expect this quarter's results to understate what the team can do once it has ramped, but that is a judgement, not a figure from the VP of Sales. The 24% win rate is reported without a target or a prior-quarter figure, so it tells us where we are, not whether that is good or bad; do not read it as evidence either way. The notes do not give a ramp period or a quota per ramped rep. We therefore cannot say from these figures how much of the $0.5M shortfall comes from ramp and how much from pipeline. That gap in the data also limits how precisely we can forecast what six new reps would add.

## Net revenue retention fell from 112% to 104% over the year

- Net revenue retention: 104%, down from 112% a year ago
- Logo churn: 3.1% in the quarter

Speaker notes: At 104%, revenue from existing customers is still growing on net, but the trend is down eight points over the year. Logo churn was 3.1% in the quarter; the notes give no prior-quarter churn to compare it with. The specific customer risk behind this is on the next slide.

## The QuickBooks Online sync has slipped from Q3 to January

- Two top-20 customers have given notice: $640,000 of ARR, 3.5% of ARR ($640,000 ÷ $18.4M)
- Both cited the missing QuickBooks Online sync
- The sync was due in Q3; it is now due in January
- Engineering: two left in September, one replacement hired, one seat open (2 − 1 = 1)

Speaker notes: This is the clearest single cause in this quarter's notes: a product gap with a named customer cost attached. These two customers have given notice but have not yet left, so the $640,000 is at risk rather than lost. Our notes do not say whether they are already counted in the 3.1% logo churn figure, so please do not add the two together. The one feature they asked for slipped by a quarter. Whether January is soon enough to keep either customer is not stated in our notes. Nor do the notes say which team the open engineering seat sits on, or whether the January date already allows for the gap. My reading is that the open seat is a risk to that date until we know where it sits or it is filled. That is my judgement, not a figure from the CTO.

## At $9.2M cash and $610,000 a month net burn, runway is about 15 months, not the 18 months in the CFO's note

|  |  |
| --- | --- |
| Cash | $9.2M |
| Net burn | $610,000 a month |
| Runway | $9.2M ÷ $610,000 = 15.1 months |
| CFO's note | "about 18 months" — does not follow from the figures above |

Speaker notes: I want to correct a number. The CFO's note says about 18 months. The CFO's own figures, cash and burn as reported, give 15.1 months, so about 15. If the 18 months assumed lower future burn or incoming revenue, that assumption is not in our notes. Until it is, use 15. Every runway figure in the rest of this deck uses 15 as the starting point.

## Six more reps add about $1.1M a year, roughly $92,000 a month, and would cut runway to about 13 months before they ramp

|  | Today | With six hires |
| --- | --- | --- |
| Monthly net burn | $610,000 | $610,000 + about $92,000 = about $702,000 |
| Runway on $9.2M | 15.1 months | $9.2M ÷ $702,000 = 13.1 months |

Speaker notes: The monthly figure is $1.1M divided by 12, about $92,000. The 13.1 months assumes the full cost lands as extra burn, no offsetting new ARR while the reps ramp, and no further churn. New ARR from the hires would lengthen it over time. The $640,000 under notice works the other way: if those customers leave, revenue falls and net burn rises by an amount our notes do not let us state, so runway would be shorter than both 15.1 and 13.1 months. 13.1 is therefore not a floor. The notes do not give a ramp period or quota, so we cannot say when the hires would pay back.

## Decision: approve six Q4 reps now, or first close the data gaps on ramp, quota and pipeline

- The ask: six more sales reps in Q4, about $1.1M a year fully loaded, to get growth back on plan
- The notes do not show how six reps return growth to plan; no ramp, quota or conversion data
- Hires made in Q4 are unlikely to close Q4 business; the notes give no ramp period
- Q4 pipeline is 2.1x against a 3x target, and two current reps are still ramping
- The QuickBooks Online sync that departing customers cite is not due until January

Speaker notes: This is the decision we need today. The case for hiring is that growth is below plan and selling capacity is limited. The case for caution sits on this slide. The stated benefit, growth back on plan, has no figure behind it in our notes. Q4 hires would join a team where half has not ramped, working a pipeline that is already short, so they are unlikely to close the Q4 gap. Part of the problem is a product gap that more sales reps do not fix. The runway cost is on the previous slide. The board can approve now, or ask for three things first or alongside the vote. First, the ramp time for a new rep (Proposed owner: VP of Sales, who supplied the sales figures). Second, the quota per ramped rep (Proposed owner: VP of Sales, for the same reason). Third, a plan showing pipeline can be built to support ten reps (four today + six new) (Owner: to confirm).
`,
  },
};
