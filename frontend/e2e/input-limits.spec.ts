import { expect, test } from '@playwright/test';

import { dismissBetaNotice, serviceSelect } from './helpers';

/**
 * S1a (5 Oct, email 8): "There is a limit (4,000) on objective and constraints
 * and output — can we make it unlimited or a very high amount?"
 *
 * A 10,000-character constraint list saves and the first stage is drafted with
 * it (before, every stage call failed with a 422). Near the new cap the field
 * says how close it is.
 */
const CONSTRAINT = 'Every figure must cite the board pack page it came from. ';
const LONG = CONSTRAINT.repeat(Math.ceil(10_000 / CONSTRAINT.length)).trim();

test('a 10,000-character constraint list is kept and the stage is drafted with it', async ({ page }) => {
  expect(LONG.length).toBeGreaterThan(10_000);
  await page.goto('/projects/new');
  await dismissBetaNotice(page);
  await page.getByLabel('What do you want to do or figure out?').fill('Write a board memo on the margin decline.');
  await page.getByRole('button', { name: /I know what I want to do/ }).click();
  await expect(page.getByRole('heading', { name: 'Your setup' })).toBeVisible();

  await page.getByLabel('Constraints').fill(LONG);
  await expect(page.getByLabel('Constraints')).toHaveValue(LONG);
  await page.getByRole('radio', { name: /^Single output/ }).click();
  await page.getByLabel('Project name').fill('E2E long constraints');
  await page.getByRole('button', { name: /^Start / }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  const id = page.url().split('/').at(-1)!;

  await expect(page.getByText('Mock output').first()).toBeVisible();
  const [project] = await serviceSelect('projects', `id=eq.${id}&select=constraints`);
  expect(project.constraints).toBe(LONG);
  await page.screenshot({ path: test.info().outputPath('01-long-constraints-drafted.png'), fullPage: true });

  // Near the cap, the field counts; at it, it says the rest was not kept.
  const near = 'x'.repeat(50_000);
  const setup = page.locator('#setup-constraints');
  await setup.fill(near);
  await expect(page.getByText('50,000 / 60,000')).toBeVisible();
  await setup.fill('x'.repeat(61_000));
  await expect(page.getByText(/60,000 \/ 60,000 — limit reached/)).toBeVisible();
  await page.getByText(/limit reached/).scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('02-counter-at-the-limit.png') });
});
