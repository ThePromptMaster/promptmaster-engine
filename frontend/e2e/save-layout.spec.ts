import { expect, test } from '@playwright/test';

import { createProject, pressTransition, skipStage } from './helpers';

/**
 * A1d — Sean: "see very top and bottom after I press save", and the Research
 * screenshot where entries were cut off mid-sentence.
 */

test('long entries are shown in full, never clipped', async ({ page }) => {
  await createProject(page, { workflow: 'Book', name: 'E2E clip', objective: 'A book about giraffes' });

  // A long entry in a list field is shown in full, not clipped.
  await expect(page.getByText('Mock output').first()).toBeVisible();
  await pressTransition(page);
  await expect(page.getByRole('heading', { name: /Audience/ })).toBeVisible();
  const field = page.getByLabel('What they already know').first();
  await expect(field).toBeVisible();
  const long = 'Curious ten-year-olds who read above their age and ask why. '.repeat(8);
  await field.fill(long);
  const clipped = await field.evaluate((el) => el.scrollHeight > el.clientHeight + 2);
  expect(clipped).toBe(false);
  await field.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('01-long-entry-not-clipped.png') });
});

test('approving an outline does not swap the page for a skeleton', async ({ page }) => {
  await createProject(page, { workflow: 'Book', name: 'E2E save', objective: 'A book about giraffes' });
  await expect(page.getByText('Mock output').first()).toBeVisible();
  await pressTransition(page);
  await expect(page.getByRole('heading', { name: /Audience/ })).toBeVisible();
  await expect(page.getByText(/Mock /).first()).toBeVisible();

  // Walk to the outline, then approve it. Approval reloads the project; that
  // reload used to replace the whole page — header, rail, transition bar —
  // with the loading skeleton and remount everything.
  await pressTransition(page);
  await expect(page.getByRole('heading', { name: /Positioning/ })).toBeVisible();
  await pressTransition(page);
  await skipStage(page, 'Not needed');
  await page.getByRole('button', { name: 'Add a section' }).click();
  await page.getByLabel('Title of section 1').fill('Habitat');
  await page.getByRole('button', { name: /Insert a section after/ }).click();
  await page.getByLabel('Title of section 2').fill('Diet');

  const title = await page.getByLabel('Project title').elementHandle();
  let skeleton = false;
  const watcher = page.locator('[aria-label="Loading project"]');
  const watch = (async () => {
    for (let i = 0; i < 40; i++) {
      if (await watcher.count()) skeleton = true;
      await page.waitForTimeout(50);
    }
  })();
  await page.getByRole('button', { name: 'Save and approve' }).click();
  await watch;

  expect(skeleton).toBe(false);
  // Same element: the header was never unmounted.
  expect(await title!.evaluate((el) => el.isConnected)).toBe(true);
  await expect(page.getByText(/approved/i).first()).toBeVisible();
  await expect(page.getByText('This project was changed in another tab')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('02-after-approve-no-skeleton.png') });
});

test('a stage whose draft failed can be written by hand', async ({ page }) => {
  // Every model call for this project fails, so the first stage cannot draft.
  await createProject(page, {
    workflow: 'Single output',
    name: 'E2E write it yourself',
    objective: 'Explain the plan [[mock:500]]',
  });

  await page.getByRole('button', { name: /Write it yourself/ }).click();
  await page.getByRole('textbox', { name: /Edit/ }).fill('The plan, in my own words.');
  await page.getByRole('button', { name: 'Save as new version' }).click();

  await expect(page.getByText('The plan, in my own words.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'v1' })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('03-written-by-hand.png') });
});
