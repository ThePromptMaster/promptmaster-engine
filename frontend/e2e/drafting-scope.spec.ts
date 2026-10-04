import { expect, test } from '@playwright/test';

import { createProject, pressTransition } from './helpers';

/**
 * 4 Oct — one generation flag for the whole workspace showed "Drafting…" on
 * whichever stage was being browsed, and its Stop aborted the real draft.
 */

test('browsing an earlier stage while the current one drafts shows no draft there, and the draft lands', async ({ page }) => {
  await createProject(page, { workflow: 'Book', name: 'E2E draft scoped', objective: 'A book about axolotls' });
  await expect(page.getByText('Mock output').first()).toBeVisible();

  // Hold Audience's draft open long enough to browse away and back.
  let release: () => void = () => undefined;
  const held = new Promise<void>((r) => (release = r));
  await page.route('**/api/generate-stage-artifact', async (route) => {
    if (/Audience/.test(route.request().postData() ?? '')) await held;
    await route.fallback();
  });

  await pressTransition(page);
  await expect(page.getByRole('heading', { name: /Audience/ })).toBeVisible();
  await expect(page.getByText(/^Drafting the /)).toBeVisible();

  // Browse back to Objective: it is done, and nothing is drafting there.
  const rail = page.getByRole('navigation', { name: 'Workflow stages' });
  await rail.getByRole('button', { name: /Objective/ }).click();
  await expect(page.locator('header').getByRole('heading', { name: /Objective/ })).toBeVisible();
  await expect(page.getByText(/^Drafting the /)).toHaveCount(0);
  await expect(page.getByText('Mock output').first()).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('01-earlier-stage-not-drafting.png') });

  // Back on Audience the draft is still running, then lands.
  await rail.getByRole('button', { name: /Audience/ }).click();
  await expect(page.getByText(/^Drafting the /)).toBeVisible();
  release();
  await expect(page.getByRole('region', { name: / work$/ }).getByText(/Mock /).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/^Drafting the /)).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('02-draft-landed-on-its-stage.png') });
});
