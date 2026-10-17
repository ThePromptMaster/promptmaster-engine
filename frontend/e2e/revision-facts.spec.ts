import { expect, test, type Page } from '@playwright/test';

import { createProject, serviceInsert, serviceSelect } from './helpers';

/**
 * Sean, 10 Oct, emails 4–5: "In 'Change it,' I requested Wednesday at
 * 1:00 p.m., under 70 words … The accepted 'Facts and requirements' still list
 * Thursday at 12:30 in two places, along with the original under-120-word
 * limit." Go then followed the facts and changed the draft back.
 *
 * Now the revision offers to update the facts it changes, in the same step,
 * and a restored version is checked against the facts. `[[mock:say=…]]` in the
 * instruction scripts what the revision returns.
 */

async function changeIt(page: Page, text: string) {
  const chat = page.getByRole('region', { name: 'Side chat' });
  await chat.getByRole('tab', { name: /Change it/ }).click();
  await chat.getByRole('button', { name: /whole document/i }).click();
  await chat.getByRole('textbox', { name: 'Give a revision instruction' }).fill(text);
  await chat.getByRole('button', { name: 'Draft revision' }).click();
  return chat;
}

test('a revision that changes accepted facts updates them with it; a restore offers the same', async ({ page }) => {
  test.setTimeout(120_000);
  const id = await createProject(page, { workflow: 'Single output', name: 'E2E revision facts', objective: 'A warm lunch invitation for the team' });
  await expect(page.getByText('Mock output').first()).toBeVisible();
  const [project] = await serviceSelect('projects', `id=eq.${id}&select=user_id`);
  for (const [statement, kind] of [['The lunch is on Thursday at 12:30.', 'fact'], ['The invitation is under 120 words.', 'requirement']] as const) {
    await serviceInsert('project_facts', { project_id: id, user_id: project.user_id, statement, kind, source_kind: 'brief' });
  }
  await page.reload();

  // The first draft says Thursday at 12:30, as the facts do: nothing to update.
  let chat = await changeIt(page, '[[mock:say=Join me for lunch on Thursday at 12:30. Bring your own lunch; coming is optional.]] Write the invitation.');
  await expect(chat.getByLabel('Proposed revision')).toBeVisible();
  await expect(chat.getByLabel('Proposed revision')).not.toContainText('accepted fact');
  await chat.getByRole('button', { name: 'Apply as new version' }).click();
  await expect(chat.getByLabel('Proposed revision')).toHaveCount(0);

  // The correction changes two facts; both are offered, ticked, with what they were.
  chat = await changeIt(
    page,
    '[[mock:say=Join me for lunch on Wednesday at 1:00 p.m. Bring your own lunch; coming is optional.]] Make it Wednesday at 1:00 p.m., under 70 words, keep it warm.'
  );
  const card = chat.getByLabel('Proposed revision');
  await expect(card).toContainText('This changes 2 accepted facts');
  await expect(card).toContainText('The lunch is on Wednesday at 1:00 p.m.');
  await expect(card).toContainText('Thursday → Wednesday');
  await expect(card).toContainText('The invitation is under 70 words.');
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('01-revision-offers-fact-updates.png') });
  await card.getByRole('button', { name: 'Apply and record 2 changes' }).click();

  // The record now says what the document says; the old facts are history.
  await expect
    .poll(async () => (await serviceSelect('project_facts', `project_id=eq.${id}&retired_at=is.null&select=statement&order=created_at`)).map((r: { statement: string }) => r.statement), { timeout: 15_000 })
    .toEqual(['The lunch is on Wednesday at 1:00 p.m.', 'The invitation is under 70 words.']);
  const updated = await serviceSelect('project_facts', `project_id=eq.${id}&retired_at=is.null&select=source_kind,source_ref,supersedes`);
  expect(updated[0]).toMatchObject({ source_kind: 'user_edit', source_ref: { via: 'revision' }, supersedes: expect.any(String) });
  const facts = page.getByRole('region', { name: 'Facts and requirements' });
  await expect(facts).toContainText('Wednesday at 1:00 p.m.');
  await expect(facts).toContainText('updated with your revision');
  await facts.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('02-facts-match-the-revision.png') });
});

/** L-72 (11 Oct): a change of meaning — in-office to fully remote — is offered too, quoted from the revision. */
test('a revision that changes a fact in meaning offers it, with the words that changed it', async ({ page }) => {
  test.setTimeout(120_000);
  const id = await createProject(page, { workflow: 'Single output', name: 'E2E revision meaning', objective: 'A one-page onboarding plan for a new employee' });
  await expect(page.getByText('Mock output').first()).toBeVisible();
  const [project] = await serviceSelect('projects', `id=eq.${id}&select=user_id`);
  await serviceInsert('project_facts', { project_id: id, user_id: project.user_id, statement: 'The team works in-office.', kind: 'fact', source_kind: 'brief' });
  await page.reload();

  const chat = await changeIt(page, '[[mock:say=Day one happens on video. The team works fully remote.]] [[mock:remote]] Make the employee fully remote.');
  const card = chat.getByLabel('Proposed revision');
  await expect(card).toContainText('This changes an accepted fact', { timeout: 30_000 });
  await expect(card).toContainText('The team works fully remote.');
  await expect(card).toContainText('was “The team works in-office.”');
  await page.screenshot({ path: test.info().outputPath('03-meaning-change-offered.png') });
  await card.getByRole('button', { name: 'Apply and record 1 change' }).click();
  await expect
    .poll(async () => (await serviceSelect('project_facts', `project_id=eq.${id}&retired_at=is.null&select=statement`)).map((r: { statement: string }) => r.statement), { timeout: 15_000 })
    .toEqual(['The team works fully remote.']);
});
