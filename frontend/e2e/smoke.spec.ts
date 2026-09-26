import { expect, test } from '@playwright/test';

import { dismissBetaNotice } from './helpers';

/**
 * The harness's own proof of life, and two regressions from PR #9:
 * each workflow is offered once, a new project pins the latest version, and a
 * stage drafts and evaluates end to end through FastAPI.
 */
test('new project offers each workflow once, then drafts and evaluates a stage', async ({ page }) => {
  await page.goto('/projects/new');
  await dismissBetaNotice(page);
  await page.getByLabel('What do you want to do or figure out?').fill('A short guide to structured prompting for analysts');
  await page.getByRole('button', { name: /I know what I want to do/ }).click();
  await expect(page.getByRole('heading', { name: 'Your setup' })).toBeVisible();

  const workflows = page.getByRole('radiogroup', { name: 'Workflow' }).getByRole('radio');
  await expect(workflows).toHaveCount(3);
  for (const name of ['Book', 'Research', 'Single output']) {
    await expect(page.getByRole('radio', { name: new RegExp(`^${name}`) })).toHaveCount(1);
  }

  await page.getByRole('radio', { name: /^Book/ }).click();
  await page.getByLabel('Project name').fill('E2E smoke');
  await page.getByRole('button', { name: 'Start Book' }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);

  // The objective stage drafts itself on entry; the scripted model's text proves
  // the request went browser -> FastAPI (JWT checked) -> mock -> back.
  await expect(page.getByText('Mock output').first()).toBeVisible();

  // PM-06: checking the stage is the suggested next step once it has a draft.
  await page.getByRole('group', { name: 'Stage actions' }).getByRole('button', { name: 'Check this stage' }).click();
  await expect(page.getByText(/Alignment\s*High/).first()).toBeVisible();
  await expect(page.getByText('Needs realignment')).toHaveCount(0);
});
