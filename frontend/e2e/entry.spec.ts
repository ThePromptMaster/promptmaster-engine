import { expect, test } from '@playwright/test';

import { dismissBetaNotice } from './helpers';

/**
 * A3 / PM-09 — "What do you want to do or figure out?" with two ways in, and
 * PromptMaster recommending the workflow and mode instead of making the user
 * pick Book / Research / Single output before they have said anything.
 */

test('"I know what I want to do": the setup is recommended, editable, and carried into the project', async ({ page }) => {
  await page.goto('/projects/new');
  await dismissBetaNotice(page);
  await expect(page.getByRole('heading', { name: 'What do you want to do or figure out?' })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('01-what-do-you-want.png') });

  await page.getByLabel('What do you want to do or figure out?').fill('Write a short book about giraffes for curious ten-year-olds');
  await page.getByRole('button', { name: /I know what I want to do/ }).click();

  await expect(page.getByRole('heading', { name: 'Your setup' })).toBeVisible();
  // Recommended workflow, with the reason.
  await expect(page.getByText(/Recommended: Book/)).toBeVisible();
  await expect(page.getByRole('radio', { name: /^Book/ })).toHaveAttribute('aria-checked', 'true');
  // Mode, audience, constraints and format are pre-filled and editable.
  await expect(page.getByLabel('How PromptMaster should think')).toHaveValue('architect');
  await expect(page.getByLabel('Constraints')).toHaveValue(/giraffes/);
  await page.getByLabel('Audience').fill('Curious ten-year-olds');
  await page.getByLabel('How PromptMaster should think').selectOption('clarity');
  await page.screenshot({ path: test.info().outputPath('02-recommended-setup.png'), fullPage: true });

  await page.getByRole('button', { name: 'Start Book' }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);

  // It all reached the project: the brief shows what was set, and the mode is in use.
  await expect(page.getByRole('textbox', { name: 'Audience' })).toHaveValue('Curious ten-year-olds');
  await expect(page.getByRole('textbox', { name: 'Constraints' })).toHaveValue(/giraffes/);
});

test('"Guide me": a few questions, clickable answers, then a recommendation', async ({ page }) => {
  await page.goto('/projects/new');
  await dismissBetaNotice(page);
  await page.getByLabel('What do you want to do or figure out?').fill('Why do giraffes have such long necks?');
  await page.getByRole('button', { name: /Guide me/ }).click();

  await expect(page.getByRole('heading', { name: 'A few questions' })).toBeVisible();
  await expect(page.getByText('1. Who is this for?')).toBeVisible();
  // "Buttonize it": the example answers are clickable.
  await page.getByRole('button', { name: 'Adults' }).click();
  await expect(page.getByRole('button', { name: 'Adults' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('3. What must it include?').fill('The competing hypotheses');
  await page.screenshot({ path: test.info().outputPath('03-guide-me-questions.png'), fullPage: true });

  await page.getByRole('button', { name: 'Recommend a setup' }).click();
  await expect(page.getByText(/Recommended: Research/)).toBeVisible();
  await page.getByRole('button', { name: 'Start Research' }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: /question/i }).first()).toBeVisible();
});

test('choosing the workflow yourself is still one click away', async ({ page }) => {
  await page.goto('/projects/new');
  await dismissBetaNotice(page);
  await page.getByLabel('What do you want to do or figure out?').fill('A board memo on the migration');
  await page.getByRole('button', { name: 'Or choose the workflow yourself' }).click();
  await expect(page.getByRole('heading', { name: 'Your setup' })).toBeVisible();
  await expect(page.getByText(/Recommended:/)).toHaveCount(0);
  await page.getByRole('radio', { name: /^Single output/ }).click();
  await page.getByRole('button', { name: 'Start Single output' }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
});
