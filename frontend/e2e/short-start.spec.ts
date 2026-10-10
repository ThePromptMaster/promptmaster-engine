import { expect, test } from '@playwright/test';

import { dismissBetaNotice } from './helpers';

/**
 * Harold, via Sean (9 Oct): "keep the question tree simple and easy." A goal and
 * "I know what I want to do" should be enough to start — the recommended setup
 * is not a form to read first.
 */
test('with a recommendation, Start is at the top and the rest is optional', async ({ page }) => {
  await page.goto('/projects/new');
  await dismissBetaNotice(page);
  await page.getByLabel('What do you want to do or figure out?').fill('Write a short book about giraffes for curious ten-year-olds');
  await page.getByRole('button', { name: /I know what I want to do/ }).click();
  await expect(page.getByRole('heading', { name: 'Your setup' })).toBeVisible();

  const start = page.getByRole('button', { name: /^Start / });
  await expect(start).toHaveCount(1);
  await expect(start).toBeInViewport();
  await expect(page.getByText(/Or adjust anything below first — all of it is optional/)).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('start-at-the-top.png') });

  // Choosing a different workflow yourself: Start goes back to the foot of the form.
  await page.getByRole('radio', { name: /^Single output/ }).click();
  await expect(page.getByText(/Or adjust anything below first/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start Single output' })).toHaveCount(1);
});

test('the Single output card no longer says it has no stages', async ({ page }) => {
  await page.goto('/projects/new');
  await dismissBetaNotice(page);
  await page.getByRole('button', { name: 'Or choose the workflow yourself' }).click();
  const card = page.getByRole('radio', { name: /^Single output/ });
  await expect(card).toContainText('drafted, checked and finished in minutes');
  await expect(card).not.toContainText('No stages');
});
