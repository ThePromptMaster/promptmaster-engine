import { expect, test } from '@playwright/test';

import { createProject, pressTransition } from './helpers';

/**
 * 20 Oct (Sean, HARBOR, iPhone screenshots): "The mobile pause explanation
 * also collapses into a very narrow text column." The resume button sat
 * beside the text in a wrapping row whose text had no starting width, so the
 * row never wrapped and the text got what the button left: a word a line.
 * Runs in the `mobile` project, at 390px.
 */
test('on a phone, the objective pause reads across the card and its button sits below', async ({ page }) => {
  test.setTimeout(150_000);
  await createProject(page, {
    workflow: 'Single output',
    name: 'E2E mobile pause',
    objective: 'Find whether the Hessian is positive definite [[mock:plan=declare_objective_complete]] [[mock:objective=unmet]]',
  });
  await pressTransition(page); // input
  await pressTransition(page); // review
  await expect(page.getByText('Mock output').first()).toBeVisible({ timeout: 30_000 });

  const panel = page.getByRole('region', { name: 'Go mode', exact: true });
  await panel.getByRole('button', { name: 'Set up Go' }).click();
  await panel.getByRole('radio', { name: /^Autonomous/ }).click();
  await panel.getByRole('button', { name: /^Go$/ }).click();

  const paused = page.getByRole('status', { name: 'Objective not met' });
  await expect(paused).toContainText('Paused — the objective is not met', { timeout: 30_000 });
  await paused.scrollIntoViewIfNeeded();

  const card = (await paused.boundingBox())!;
  const reason = (await paused.getByText('Waiting for').boundingBox())!;
  const text = (await paused.locator('ul').first().boundingBox())!;
  const button = (await paused.getByRole('button', { name: 'I have added it — resume Go' }).boundingBox())!;
  // The text takes the card's width less the icon, not a sliver of it.
  expect(text.width).toBeGreaterThan(card.width * 0.65);
  // The button is below the text, not beside it.
  expect(button.y).toBeGreaterThan(reason.y + reason.height);
  // Nothing runs off the screen sideways.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: test.info().outputPath('01-mobile-pause-card.png') });
});
