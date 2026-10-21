import { expect, test } from '@playwright/test';

import { dismissBetaNotice } from './helpers';

/**
 * Sean, 18 Oct (email 7), from a new beta user: the start was overwhelming —
 * too many questions, too much to read — and it was not clear whether
 * PromptMaster would do the work or hand back a prompt for ChatGPT. His task
 * also rested on Instagram videos, which PromptMaster cannot open.
 *
 * Every other spec signs in with the advanced setup chosen (auth.setup.ts);
 * this one starts as a new user does.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('pm.experience.v1'));
});

test('a new user gets one box, a link warning, one screen and Start', async ({ page }) => {
  await page.goto('/projects/new');
  await dismissBetaNotice(page);
  await expect(page.getByRole('heading', { name: 'What do you want done?' })).toBeVisible();
  await expect(page.getByText(/PromptMaster writes the result itself; you review and approve/)).toBeVisible();
  // 14 Oct call: the conversation is the way in for everyone; the workflow list is the advanced setup's.
  await expect(page.getByRole('button', { name: /Start the conversation/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /choose the workflow yourself/ })).toHaveCount(0);

  await page.getByLabel('What do you want done?').fill('Turn the recipes at https://www.instagram.com/somecook/ into a cookbook, one page per recipe');
  await expect(page.getByRole('note', { name: 'Links' })).toContainText("can't open links or watch videos");

  await page.getByRole('button', { name: /Set it up for me/ }).click();
  await expect(page.getByRole('heading', { name: 'Your setup' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'What you will get' })).toBeVisible();
  // Mode, audience and the rest wait under More options.
  await expect(page.getByLabel('How PromptMaster should think')).toBeHidden();
  // The disclosure itself: the suggested-constraints note names "More options" too.
  await page.locator('summary', { hasText: 'More options' }).click();
  await expect(page.getByLabel('How PromptMaster should think')).toBeVisible();

  await page.getByRole('button', { name: /^Start / }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
});

test('the advanced setup is one click away and remembered', async ({ page }) => {
  await page.goto('/projects/new');
  await dismissBetaNotice(page);
  await page.getByRole('button', { name: /^Advanced setup/ }).click();
  await expect(page.getByRole('heading', { name: 'What do you want to do or figure out?' })).toBeVisible();
  await expect(page.getByRole('button', { name: /choose the workflow yourself/ })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('pm.experience.v1'))).toBe('advanced');

  await page.getByRole('button', { name: 'Simple setup' }).click();
  await expect(page.getByRole('heading', { name: 'What do you want done?' })).toBeVisible();
});
