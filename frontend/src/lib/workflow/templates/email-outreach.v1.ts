import type { WorkflowTemplate } from '../types';

/**
 * Email outreach: from a rough list to sent messages (Sean, 26 Nov: "Find the right person at
 * each of these companies … Check whether I've already contacted them. Fill in the missing
 * information you can verify, personalize each email with one real detail about their work …
 * Bring me the drafts, and show me which contacts you skipped or couldn't verify").
 *
 * Four stages, one renderer for the last three (`outreach`, by part):
 * - Brief: who to reach and why, the offer and the link: written, like any prose stage.
 * - Contacts: the list as imported, what was filled in and from where, duplicates, earlier contact.
 * - Message: the standard message with its variables, and an optional follow-up.
 * - Drafts & send: one email per ready contact, editable, previewed exactly as it goes out.
 *
 * Go may research and draft. It never approves or sends: every email is approved by the user,
 * as the exact version that goes out, and the round's sign-off is reserved.
 */
export const EMAIL_OUTREACH_V1: WorkflowTemplate = {
  key: 'email_outreach',
  version: 1,
  name: 'Email outreach',
  description: 'Bring a list and a goal: find the right person at each company, check who you have already contacted, draft each email with one real detail, and send what you approve from your own mailbox.',
  outline_stage: 'none',
  nouns: { deliverable: 'outreach round', unit: 'email' },
  used_as_is: true,
  stages: [
    {
      id: 'brief',
      label: 'Outreach brief',
      short_label: 'Brief',
      group: 'planning',
      required: true,
      renderer: 'prose',
      entry_guidance: 'Say who you want to reach and why, what you are offering, and the link to use. Every email is written from this.',
      entry_prompt_hint:
        'Write the brief every outreach email will be written from, from the objective and what the user has said: who to reach at each company (the role or team, and why that person), what is being offered and why it matters to them, the exact link the user gave (never one they did not give), what the email must never claim or promise, the tone, and what the user wants back (a reply, a call, a demo). Keep it short: a page at most.',
      exit_criteria: [
        { id: 'brief.objective', label: 'Objective is stated', check: 'auto', rule: { type: 'field_non_empty', field: 'objective' }, blocking: true },
        { id: 'brief.written', label: 'The outreach brief is written', check: 'auto', rule: { type: 'artifact_non_empty' }, blocking: true },
      ],
      expected_artifacts: [{ kind: 'outreach_brief', cardinality: 'one', primary: true }],
      recommended_modes: [{ mode: 'architect', reason: 'Sets who to reach, the offer and the ask' }],
      skip_reasons: [],
      transitions: { default_next: 'contacts', allow_skip: false, allow_return_to: [] },
    },
    {
      id: 'contacts',
      label: 'Contacts',
      short_label: 'Contacts',
      group: 'drafting',
      required: true,
      renderer: 'outreach',
      outreach: { part: 'contacts' },
      entry_guidance: 'Paste a list, upload a CSV from Clay, or list company names and websites. What came from your list and what PromptMaster added are kept apart, with the source of each.',
      entry_prompt_hint:
        'For each company, find the person the brief says to reach, their role and a work email a public source shows, and one real detail about the company\'s work for the email. Never invent a person, an address or a detail; say what could not be found.',
      exit_criteria: [
        { id: 'contacts.some', label: 'There is at least one contact', check: 'auto', rule: { type: 'min_items', n: 1 }, blocking: true },
        { id: 'contacts.ready', label: 'At least one contact is ready to write to', check: 'auto', rule: { type: 'min_items_with_status', n: 1, statuses: ['ready'] }, blocking: true },
        { id: 'contacts.decided', label: 'Every contact is ready, skipped with a reason, or decided by you', check: 'auto', rule: { type: 'every_item_has_status' }, blocking: false },
      ],
      expected_artifacts: [{ kind: 'outreach_contacts', cardinality: 'one', primary: true }],
      recommended_modes: [{ mode: 'analyst', reason: 'Fills gaps only from what a source shows' }],
      skip_reasons: [],
      transitions: { default_next: 'message', allow_skip: false, allow_return_to: ['brief'] },
    },
    {
      id: 'message',
      label: 'Message',
      short_label: 'Message',
      group: 'drafting',
      required: true,
      renderer: 'outreach',
      outreach: { part: 'message' },
      entry_guidance: 'The standard message every email starts from, with the offer and link as values you can change for the whole batch, and an optional follow-up.',
      entry_prompt_hint:
        'Write a short first email from the brief: a subject line and a body of at most 120 words that opens with {{personal_line}}, says what is offered and why it matters to {{company}}, gives {{link}}, and asks for one small next step. Greet {{first_name}}. No sign-off with the sender\'s name: the signature adds it. Never a link the user did not give.',
      exit_criteria: [
        { id: 'message.written', label: 'The standard message is written', check: 'auto', rule: { type: 'artifact_non_empty' }, blocking: true },
      ],
      expected_artifacts: [{ kind: 'outreach_message', cardinality: 'one', primary: true }],
      recommended_modes: [{ mode: 'clarity', reason: 'Short, specific and easy to answer' }],
      skip_reasons: [],
      transitions: { default_next: 'drafts', allow_skip: false, allow_return_to: ['contacts', 'brief'] },
    },
    {
      id: 'drafts',
      label: 'Drafts & send',
      short_label: 'Drafts',
      group: 'final_review',
      required: true,
      renderer: 'outreach',
      outreach: { part: 'drafts' },
      entry_guidance: 'One email per ready contact, each with its own detail. Edit any of them, see each exactly as it goes out, and approve the ones to send.',
      entry_prompt_hint:
        'One email per ready contact, made from the standard message with the contact\'s name, company and personal line filled in. Each is checked before it goes out: the right recipient, nothing left to fill in, no claim the brief does not support, and the sender\'s signature underneath.',
      exit_criteria: [
        { id: 'drafts.some', label: 'There is at least one email', check: 'auto', rule: { type: 'min_items', n: 1 }, blocking: true },
        { id: 'drafts.decided', label: 'You approved or set aside every email', check: 'auto', rule: { type: 'every_item_has_status' }, blocking: true },
        { id: 'drafts.approved', label: 'I approve this round of outreach as sent', check: 'manual', authority: 'reserved', blocking: false },
      ],
      expected_artifacts: [{ kind: 'outreach_drafts', cardinality: 'one', primary: true }],
      recommended_modes: [{ mode: 'critic', reason: 'Checks each email before it goes out' }],
      skip_reasons: [],
      transitions: { default_next: null, allow_skip: false, allow_return_to: ['message', 'contacts'] },
    },
  ],
};
