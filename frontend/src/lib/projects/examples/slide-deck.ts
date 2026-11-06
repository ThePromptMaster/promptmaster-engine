import type { Example } from './index';

/**
 * A board update for an invented company, from notes that do not quite agree. The
 * CFO's "18 months of runway" is 15 on the CFO's own cash and burn, and the ask
 * (six more sales reps) sits badly with the reason customers gave for leaving and
 * with thin pipeline coverage. So the deck has something to get right that a
 * tidy-up of the notes would not.
 */
export const SLIDE_DECK: Example = {
  key: 'slide_deck',
  slug: 'slide-deck',
  icon: 'co_present',
  design: {
    name: 'Slide deck',
    description: 'From rough notes to a finished deck: the message, the storyline, every slide, then a hard read.',
    deliverable: 'slide deck',
    inquiry: false,
    execution: {
      kind: 'finite',
      success_criterion:
        'Every slide has one message stated in its title, every number traces to the notes or to a sum shown from them, anything in the notes that does not add up is said on the slide, and the deck ends on the decision asked for.',
      stop_conditions: [],
    },
    stages: [
      {
        label: 'Audience and message',
        short_label: 'Message',
        kind: 'write',
        purpose: 'Who is in the room, what they must leave believing, and the decision you need. Read it and change anything that is wrong.',
        instruction:
          'State who is in the room and for how long, what they must leave believing, the decision needed, what the deck must cover, the material on hand and what is out of scope. This is the framing, not the deck: write no slides.',
        required: true,
        approval: 'I approve this message',
        approval_kind: 'routine',
      },
      {
        label: 'Storyline',
        short_label: 'Storyline',
        kind: 'write',
        purpose: 'One line per slide, so the argument can be read before any slide is written.',
        instruction:
          'First check the notes against each other: work out anything they let you check, and where they do not add up, say so and use the number that does. ' +
          'Then write the argument as one line per slide: each line is the slide\'s title, a full sentence stating its point. The titles read alone should make the whole case and end on the decision asked for, including what the numbers say about it.',
        required: true,
        approval: '',
      },
      {
        label: 'Slides',
        short_label: 'Slides',
        kind: 'write',
        purpose: 'Every slide: a title that says the point, a few bullets and speaker notes. When it is done, download it as a PowerPoint file from the export menu.',
        instruction:
          'Write every slide from the storyline, in the requested format and nothing else: no introduction, no commentary between slides. Each title states the slide\'s point. Quote numbers from the notes exactly, and show any sum you worked out. Where the notes were wrong, say so on the slide. The speaker notes say what to say aloud, including anything the slide leaves out.',
        required: true,
        approval: '',
      },
      {
        label: 'Final review',
        short_label: 'Review',
        kind: 'check',
        purpose: 'A hard read of the deck as the board would give it. Decide each finding, then sign off.',
        instruction:
          'Read the deck as a sceptical board member. Raise a finding for each number that does not trace to the notes, each slide with more than one message, each thing in the notes that does not add up and is not said, and any ask the numbers do not support.',
        required: true,
        approval: 'I approve this deck for the board',
      },
    ],
  },
  project: {
    title: 'Quillon Field Software: Q3 board update (example)',
    objective: 'Build the Q3 board update deck for Quillon Field Software: where we stand, what changed, and the decision we need from the board.',
    audience: "Quillon's board of directors, in a 30-minute slot",
    constraints:
      'Use only the source notes. Where the notes do not add up, say so on the slide and show the number that does. At most ten slides, one message per slide.',
    output_format:
      'Slides in Markdown. Each slide starts with "## " and a title that states its point, then at most five short bullets or one small table, then a line starting "Speaker notes:" with what to say.',
    mode: 'analyst',
    context: `SAMPLE MATERIAL. Everything below is invented for this example: the company, the people and every number.

Quillon Field Software sells scheduling and dispatch software to regional HVAC and plumbing contractors. Notes gathered for the Q3 board meeting:

From the CFO:
- ARR $18.4M at the end of Q3, up from $16.9M at the end of Q2 and $14.2M a year ago.
- Gross margin 74%.
- Cash $9.2M. Net burn $610,000 a month. "We have about 18 months of runway."

From the head of customer success:
- Net revenue retention 104%, down from 112% a year ago.
- Logo churn 3.1% in the quarter. Two of the top 20 customers gave notice, both citing the missing QuickBooks Online sync. Together they are $640,000 of ARR.
- NPS 41.

From the VP of Sales:
- New ARR $1.1M in Q3 against a plan of $1.6M.
- Pipeline coverage 2.1x for Q4, against a target of 3x.
- Four reps, two still ramping. Win rate 24%.

From the CTO:
- Mobile app v3 shipped in August.
- The QuickBooks Online sync slipped from Q3 to January.
- Two engineers left in September; one replacement is hired.

From the CEO:
- The ask: approve hiring six more sales reps in Q4, about $1.1M a year fully loaded, to get growth back on plan.`,
  },
  prepared: `**Who is in the room.** Quillon's board of directors, in a 30-minute slot. They saw the Q2 numbers last time and will have read nothing in advance.

**What they must leave believing.** That management sees the quarter clearly: where we are against plan, why, and what we would do about it.

**The decision we need.** Whether to approve hiring six more sales reps in Q4, about $1.1M a year fully loaded.

**What the deck has to cover.** Where we stand, what changed since Q2, customers, sales, product, cash, then the ask.

**What we have.** Notes from the CFO, the head of customer success, the VP of Sales, the CTO and the CEO.

**Out of scope.** The wider product roadmap, and fundraising.`,
};
