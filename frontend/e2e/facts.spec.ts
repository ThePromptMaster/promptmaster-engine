import { expect, test } from '@playwright/test';

import { createProject, pressTransition, serviceSelect } from './helpers';

/**
 * F1–F3 — Sean, 6 Oct, email 4: "I then supplied those figures and explicitly
 * instructed it to update the authoritative candidate facts and all affected
 * stages … the final check classified those same figures as unsupported
 * because they did not appear in the supplied candidate facts." And email 6:
 * "when I supplied the candidate-duration figures through side chat, what
 * project record was actually updated?"
 *
 * Now: the chat offers to record them; the user sees exactly what will be
 * saved; the facts are a project record with their source; every later
 * request carries them; a change keeps the old one in the history and reopens
 * what relied on it. `[[mock:facts]]` makes the scripted chat offer the facts
 * in the question, plus one the user never wrote, which must not appear.
 */
test('facts given in the chat are recorded on confirmation, read by every request, and changed with history kept', async ({ page }) => {
  test.setTimeout(120_000);
  const id = await createProject(page, { workflow: 'Single output', name: 'E2E facts', objective: 'Choose the strongest finalist for COO' });
  await pressTransition(page); // input is finished: the facts can reopen it
  await expect(page.getByRole('heading', { name: 'Review the prompt' })).toBeVisible();

  const chat = page.getByRole('region', { name: 'Side chat' });
  await chat.getByRole('textbox', { name: 'Ask a question' }).fill(
    '[[mock:facts]] Candidate A has managed 100 or more employees for 7 years. Candidate B has managed 100 or more employees for 4 years. Update the candidate facts.'
  );
  await chat.getByRole('button', { name: 'Ask' }).click();
  await chat.getByRole('button', { name: 'Record these 2 facts' }).click({ timeout: 30_000 });

  // Shown before anything is saved; the fact the user never gave is not there.
  const sheet = chat.getByRole('region', { name: 'Record facts' });
  await expect(sheet).toContainText('These become accepted project facts');
  await expect(sheet.getByRole('listitem')).toHaveText([
    'Candidate A has managed 100 or more employees for 7 years',
    'Candidate B has managed 100 or more employees for 4 years',
  ]);
  await expect(sheet).not.toContainText('Candidate C');
  await page.screenshot({ path: test.info().outputPath('01-confirm-before-recording.png') });
  expect(await serviceSelect('project_facts', `project_id=eq.${id}&select=id`)).toEqual([]);
  await sheet.getByRole('button', { name: 'Record these 2 facts' }).click();

  // The record: on the page, with its source, and in the database.
  const panel = page.getByRole('region', { name: 'Facts and requirements' });
  const listed = panel.getByRole('list', { name: 'Accepted facts' });
  await expect(listed.getByRole('listitem')).toHaveCount(2, { timeout: 15_000 });
  await expect(listed).toContainText('from the side chat');
  const rows = await serviceSelect('project_facts', `project_id=eq.${id}&select=statement,source_kind,accepted_by,retired_at&order=created_at`);
  expect(rows).toMatchObject([
    { statement: 'Candidate A has managed 100 or more employees for 7 years', source_kind: 'chat', accepted_by: 'user', retired_at: null },
    { statement: 'Candidate B has managed 100 or more employees for 4 years', source_kind: 'chat', accepted_by: 'user', retired_at: null },
  ]);

  // The change check ran on the facts, and kept the text before and after.
  await expect.poll(async () => (await serviceSelect('workflow_events', `project_id=eq.${id}&type=eq.brief_changed&select=payload`)).length, { timeout: 20_000 }).toBe(1);
  const [changed] = await serviceSelect('workflow_events', `project_id=eq.${id}&type=eq.brief_changed&select=payload`);
  expect(changed.payload).toMatchObject({ field: 'facts', before: '', after: expect.stringContaining('Candidate B has managed 100 or more employees for 4 years') });

  // Every later request carries the current facts.
  const sent = page.waitForRequest((r) => r.url().endsWith('/api/chat-message'));
  await chat.getByRole('textbox', { name: 'Ask a question' }).fill('Which candidate has more experience?');
  await chat.getByRole('button', { name: 'Ask' }).click();
  const body = (await sent).postDataJSON() as { inputs: { facts: { statement: string; source: string }[] } };
  expect(body.inputs.facts.map((f) => f.statement)).toEqual([
    'Candidate A has managed 100 or more employees for 7 years',
    'Candidate B has managed 100 or more employees for 4 years',
  ]);
  expect(body.inputs.facts[0].source).toMatch(/^from the side chat/);

  // A change is a new fact; the old one is in the history, not edited.
  await listed.getByRole('listitem').nth(1).getByRole('button', { name: 'Change' }).click();
  await panel.getByLabel('Change this fact').fill('Candidate B has managed 100 or more employees for 5 years');
  await panel.getByRole('button', { name: 'Save the change' }).click();
  await expect(listed).toContainText('for 5 years');
  await panel.getByRole('button', { name: 'History (1)' }).click();
  await expect(panel.getByRole('list', { name: 'Earlier facts' })).toContainText('for 4 years');
  const after = await serviceSelect('project_facts', `project_id=eq.${id}&select=statement,source_kind,retired_reason,supersedes&order=created_at`);
  expect(after).toHaveLength(3);
  expect(after[1]).toMatchObject({ statement: 'Candidate B has managed 100 or more employees for 4 years', retired_reason: 'superseded' });
  expect(after[2]).toMatchObject({ source_kind: 'user_edit', supersedes: expect.any(String) });
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('02-facts-with-source-and-history.png') });
});
