import { expect, test } from '@playwright/test';

import { dismissBetaNotice, serviceSelect } from './helpers';

/**
 * A sample of what good looks like, pasted on the first screen, was kept only by
 * two of the four ways in: taking the recommended setup, or making a project from
 * the conversation, replaced the draft that held it (found 6 Nov).
 */
test('a sample pasted at the start reaches the project through the recommended setup', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/projects/new');
  await dismissBetaNotice(page);
  await page.getByLabel('What do you want to do or figure out?').fill('A one-page memo on moving our team from Slack to Teams');
  await page.locator('summary', { hasText: '' }).click();
  await page.getByRole('textbox', { name: '' }).fill('Short sentences. Numbers first. No jargon.');

  await page.getByRole('button', { name: /I know what I want to do/ }).click();
  await page.getByRole('radio', { name: /^Single output/ }).click();
  await page.getByRole('button', { name: 'Start Single output' }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/, { timeout: 30_000 });

  const id = page.url().split('/').at(-1)!;
  const [project] = await serviceSelect('projects', `id=eq.${id}&select=sample_output`);
  expect(project.sample_output).toBe('Short sentences. Numbers first. No jargon.');
});
