import { expect, test } from '@playwright/test';

import { createProject } from './helpers';

/**
 * 24 Oct (Sean, iPhone): "I'm having trouble getting this to do anything."
 * For twenty-five minutes no project was opened: three icons on every card
 * left the title a few letters wide, a tap meant for the project opened "Use
 * in another project" over the list, and a tap outside did not close it.
 * Runs in the `mobile` project, at 390px with touch.
 */
test('on a phone, a tap opens the project and the card’s actions are one menu', async ({ page }) => {
  test.setTimeout(150_000);
  const first = await createProject(page, { workflow: 'Single output', name: 'E2E phone list one', objective: 'Write a short note on tea' });
  await createProject(page, { workflow: 'Single output', name: 'E2E phone list two', objective: 'Write a short note on coffee' });

  await page.goto('/projects');
  const card = page.getByRole('listitem').filter({ hasText: 'E2E phone list one' }).first();
  await expect(card).toBeVisible();

  // One button on the card, not three.
  await expect(card.getByRole('button', { name: 'More for E2E phone list one' })).toBeVisible();
  await expect(card.getByRole('button', { name: /^Use E2E phone list one in another project/ })).toBeHidden();
  await expect(card.getByRole('button', { name: /^Delete E2E phone list one/ })).toBeHidden();
  // The title has room to be read.
  const title = (await card.getByText('E2E phone list one', { exact: true }).boundingBox())!;
  expect(title.width).toBeGreaterThan(150);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: test.info().outputPath('01-phone-list.png') });

  // The menu opens as a sheet, and a tap on the dimmed list closes it.
  await card.getByRole('button', { name: 'More for E2E phone list one' }).tap();
  const sheet = page.getByRole('dialog', { name: 'E2E phone list one' });
  await expect(sheet.getByRole('button', { name: 'Use in another project…' })).toBeVisible();
  await sheet.getByRole('button', { name: 'Use in another project…' }).tap();
  await expect(sheet.getByText(/Which project should draw on/)).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('02-phone-use-in-sheet.png') });
  await page.touchscreen.tap(195, 60);
  await expect(sheet).toBeHidden();

  // A tap on the card opens the project.
  await card.getByText('E2E phone list one', { exact: true }).tap();
  await expect(page).toHaveURL(new RegExp(`/projects/${first}$`));
  await page.screenshot({ path: test.info().outputPath('03-phone-project-open.png') });
});
