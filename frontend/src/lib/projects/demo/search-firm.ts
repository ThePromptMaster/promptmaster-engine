/**
 * A sample search-firm workspace (Sean, 23 Nov: "I'd start with one workspace,
 * one client, and two searches. Give the client a reference-handling default,
 * make an exception in one search, and confirm the other search still follows
 * the default. Then run a transcript review, change one requirement, and check
 * that PromptMaster can show what the first review used and what needs to be
 * revisited.").
 *
 * Everything in it is invented: the firm, the client, the people and the
 * transcript. It is made in the user's own account, as their folders, rules,
 * documents, workflows and one project, so every part of it behaves exactly as
 * their own would. Nothing is drafted until they open the project.
 */
import type { DesignedWorkflow } from '@/lib/workflow/custom';

export const SAMPLE_NAMES = {
  workspace: 'Larchmere Search Partners (sample)',
  client: 'Quillfield Dairy Co-op (sample client)',
  searchWithException: 'Finance Director search',
  searchDefault: 'Head of Supply Chain search',
  project: 'Finance Director: first interview review (sample)',
} as const;

export const SAMPLE_RULES = {
  workspace: "Candidate reports use the firm's standard report template: summary, experience, evidence with quotes, open questions.",
  clientRequired: "The client's own HR team runs all reference checks.",
  clientDefault: 'Candidate reports go to the client as PDF.',
  searchNote: 'We run the reference checks ourselves on this search.',
} as const;

export const SAMPLE_EXCEPTION = {
  authorised_by: 'Ines Carvalho, Head of People at Quillfield (invented)',
  how_confirmed: 'email of 18 November to the lead consultant',
  reason: "Quillfield's HR team is short-staffed this quarter and asked the firm to run the references for this search only.",
} as const;

export const ENGAGEMENT_TERMS = `Engagement terms: Quillfield Dairy Co-op and Larchmere Search Partners (invented sample)

Fee: one third of first-year base salary, in three instalments: on signing, on the shortlist, on appointment.
Reports: every candidate report goes to Ines Carvalho, Head of People, as a PDF.
References: Quillfield's own HR team runs reference checks for every search, unless both parties agree otherwise in writing for a particular search.
Off-limits: no candidate is approached from Quillfield's two largest suppliers.
Guarantee: twelve months from the appointee's start date.`;

export const POSITION_SPEC = `Position specification: Finance Director, Quillfield Dairy Co-op (invented sample)

Reports to the Chief Executive. Based in Cork, Ireland; relocation support offered.
Must have: led a finance function of at least 15 people; led or co-led an ERP migration; experience in food or agricultural manufacturing.
Topics every interview must cover: team size and structure; the ERP work and what went wrong; notice period; willingness to relocate to Cork; salary expectations.`;

export const SAMPLE_TRANSCRIPT = `Interview transcript: Priya Raman, candidate for Finance Director (invented sample)
Interviewer: Tom Hale, Larchmere Search Partners. Video call, 20 November 2026.

Tom: Thanks for making the time. Can you start with your current role?
Priya: I'm Head of Finance at a regional cheese maker, about 400 people. I report to the CFO and I run a team of 18: financial control, FP&A and a small treasury desk.

Tom: The role here leads an ERP migration next year. What have you done in that line?
Priya: I co-led our move from an old on-premise system to a cloud ERP in 2024. I owned the finance workstream: chart of accounts, data migration, testing and the cut-over. We went live two months late, because the inventory data was in worse shape than anyone admitted, and I'd insist on a data audit up front next time.

Tom: How did the business take the delay?
Priya: Not well at first. I set up a weekly one-page update for the board and that settled things. We hit the first clean month-end three months after go-live.

Tom: What would you want from the CEO in the first ninety days?
Priya: Clarity on what the board expects from finance in year one, and time with the plant managers. Most of the margin story sits in the plants, not in head office.

Tom: What's your notice period?
Priya: Three months, and I'd like to finish our half-year close before I leave, so realistically mid-March.

Tom: And salary expectations?
Priya: Around 145,000 base, with a bonus in line with the senior team.

Tom: Why are you looking now?
Priya: I want the top finance job, and I'd rather do it in food manufacturing, where I know the economics.

Tom: Anything you'd like to ask us?
Priya: How long has the role been open, and why did the last Finance Director leave?`;

/** A review of one interview against the search's topics, and notes for the candidate report. */
export const TRANSCRIPT_REVIEW: DesignedWorkflow = {
  name: 'Transcript review',
  description: 'One interview read against the topics the search must cover: what was covered, what needs a follow-up, and evidence for the candidate report.',
  deliverable: 'interview review',
  inquiry: false,
  fixed_stages: true,
  stages: [
    {
      label: 'Topics to cover',
      short_label: 'Topics',
      kind: 'write',
      purpose: 'The topics this interview had to cover, each with where it comes from. Read it and change anything that is wrong.',
      instruction:
        'List every topic this interview had to cover, one line each, from the requirements and documents on record (the position specification, the search, the client and the firm), saying for each where it comes from. Add nothing they do not ask for.',
      required: true,
      approval: 'I approve these as the topics to cover',
      approval_kind: 'routine',
    },
    {
      label: 'Transcript review',
      short_label: 'Review',
      kind: 'write',
      purpose: 'Each topic: covered or not, what the candidate said, and whether it needs a follow-up question.',
      instruction:
        'Read the interview transcript against the topics. For each topic say whether it was covered, quote what the candidate said word for word in quotation marks, and say whether it needs a follow-up question and which one. Then list the evidence for the candidate report, each item with its quote. Use only the transcript: where it does not say something, say so.',
      required: true,
      approval: '',
    },
    {
      label: 'Report notes',
      short_label: 'Report',
      kind: 'write',
      purpose: 'Notes for the candidate report, following the firm template and what the client asked for.',
      instruction:
        "Write notes for the candidate report in the firm's template, using only the review. Say who receives the report and in what format, and who runs the reference checks, as the rules in force for this search say.",
      required: true,
      approval: 'I approve these notes for the candidate report',
    },
  ],
};

/** What the workspace's master changes in its second version, so the client's copy has an update to take. */
export const MASTER_V2_REVIEW_INSTRUCTION =
  TRANSCRIPT_REVIEW.stages[1].instruction + ' Mark any answer that differs from what the CV or the position specification says.';
