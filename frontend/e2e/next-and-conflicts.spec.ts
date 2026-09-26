import { expect, test, type Page } from '@playwright/test';

import { createProject, servicePatch, serviceSelect, transitionBar } from './helpers';

/**
 * C3 — PM-23 (next logical action, why, one click) and PM-24 (conflicts:
 * instruction vs objective, vs a constraint, vs a prior decision; the user is
 * asked which should control, and the answer is recorded).
 */

async function instruct(page: Page, text: string) {
  const chat = page.getByRole('region', { name: 'Side chat' });
  await chat.getByRole('tab', { name: /Instruct/ }).click();
  await chat.getByRole('button', { name: /whole document/i }).click();
  await chat.getByRole('textbox', { name: 'Give a revision instruction' }).fill(text);
  await chat.getByRole('button', { name: 'Draft revision' }).click();
  return chat;
}

test('PM-23: the next step says why, and PromptMaster can suggest a move you take in one click', async ({ page }) => {
  const id = await createProject(page, { workflow: 'Book', name: 'E2E next move', objective: 'A book about giraffes' });
  await expect(page.getByText('Mock output').first()).toBeVisible();

  const bar = transitionBar(page);
  await bar.getByRole('button', { name: 'Why this?' }).click();
  const why = bar.getByRole('list', { name: 'Why this is the next step' });
  await expect(why).toContainText('The current version has not been checked.');
  await expect(why).toContainText('Every required item on this stage is met.');
  await page.screenshot({ path: test.info().outputPath('01-why-this.png') });

  await bar.getByRole('button', { name: /^More/ }).click();
  await page.getByRole('menuitem', { name: 'Suggest a move' }).click();
  const card = page.getByRole('region', { name: 'Suggested next move' });
  await expect(card).toContainText('Check this stage');
  await expect(card).toContainText('Why: Mock: evaluate_stage is the next scripted move.');
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('02-suggested-move.png') });
  // Nothing has happened yet.
  expect(await serviceSelect('evaluations', `project_id=eq.${id}&select=id`)).toHaveLength(0);

  await card.getByRole('button', { name: 'Do it' }).click();
  await expect(page.getByRole('region', { name: 'Stage evaluation' })).toBeVisible();
  await expect.poll(async () => (await serviceSelect('evaluations', `project_id=eq.${id}&select=id`)).length).toBe(1);
});

test('PM-24: an instruction against the constraints asks which controls, without a model call', async ({ page }) => {
  const id = await createProject(page, { workflow: 'Book', name: 'E2E conflict rule', objective: 'A book about giraffes' });
  await expect(page.getByText('Mock output').first()).toBeVisible();
  await servicePatch('projects', `id=eq.${id}`, { constraints: 'Under 300 words' });
  await page.reload();
  await expect(page.getByText('Mock output').first()).toBeVisible();

  const chat = await instruct(page, 'Expand it with much more detail');
  const ask = chat.getByRole('region', { name: 'Which should control?' });
  await expect(ask).toContainText('It pulls against your constraints: Under 300 words');
  await expect(ask).toContainText('opposite way on length');
  await page.screenshot({ path: test.info().outputPath('01-which-controls.png') });
  await ask.getByRole('radio', { name: 'Keep the constraints' }).click();
  await ask.getByRole('button', { name: 'Continue' }).click();
  await expect(chat.getByLabel('Proposed revision')).toBeVisible();

  // On the decision trail, as a dismissed proposal with its decision.
  const [row] = await serviceSelect('recommendations', `project_id=eq.${id}&category=like.conflict:*&select=id,status,title`);
  expect(row).toMatchObject({ status: 'dismissed' });
  expect(row.title).toContain('the constraints takes precedence over "Expand it with much more detail"');
  const decisions = await serviceSelect('decisions', `recommendation_id=eq.${row.id}&select=decision_type`);
  expect(decisions).toEqual([{ decision_type: 'dismiss_recommendation' }]);
});

test('PM-24: a meaning-level conflict with the objective, then a prior decision is remembered', async ({ page }) => {
  const id = await createProject(page, { workflow: 'Book', name: 'E2E conflict model', objective: 'A book about giraffes' });
  await expect(page.getByText('Mock output').first()).toBeVisible();

  const chat = await instruct(page, 'Make it about elephants instead [[mock:conflict]]');
  const ask = chat.getByRole('region', { name: 'Which should control?' });
  await expect(ask).toContainText('It pulls against your objective');
  await expect(ask).toContainText('Mock: this instruction pulls the work away from the objective.');
  await ask.getByRole('radio', { name: 'My new instruction controls' }).click();
  await ask.getByRole('button', { name: 'Continue' }).click();
  await expect(chat.getByLabel('Proposed revision')).toBeVisible();
  await chat.getByRole('button', { name: 'Discard' }).click();

  const [row] = await serviceSelect('recommendations', `project_id=eq.${id}&category=like.conflict:*&select=status,title`);
  expect(row).toMatchObject({ status: 'accepted' });
  expect(row.title).toContain('takes precedence over the objective');

  // An instruction that fits is sent straight through — no question.
  await chat.getByRole('textbox', { name: 'Give a revision instruction' }).fill('Fix the typo in the first line');
  await chat.getByRole('button', { name: 'Draft revision' }).click();
  await expect(chat.getByLabel('Proposed revision')).toBeVisible();
  await expect(chat.getByRole('region', { name: 'Which should control?' })).toHaveCount(0);
});
