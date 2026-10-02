import { expect, test } from '@playwright/test';

import { createProject, pressTransition, skipStage, stageArtifact, transitionBar } from './helpers';

/**
 * PM-04 — "some chapters it wrote and some said it attempted three times then
 * gave up" (Sean, Sep 10). Drafting runs through the real job queue: the
 * browser's drain hook calls /api/jobs/drain, which calls FastAPI with the
 * worker credential and writes sections through the SQL functions.
 *
 * Section 2's title carries [[mock:402x1]]: its first call fails as out of
 * credits, later calls succeed — a failure a user can recover from once the
 * cause is fixed, which is exactly what they could not do before.
 */
test('a chapter that fails says why, names itself, and can be retried', async ({ page }) => {
  test.setTimeout(180_000);
  await createProject(page, {
    workflow: 'Book',
    name: 'E2E drafting',
    objective: 'A short book about giraffes',
  });

  // Planning stages. (Gates are passed with "Override and continue" where needed; this
  // test is about drafting.)
  await expect(page.getByText('Mock output').first()).toBeVisible();
  await pressTransition(page);
  await expect(page.getByRole('heading', { name: /Audience/ })).toBeVisible();
  await expect(stageArtifact(page).getByText(/Mock /).first()).toBeVisible();
  await pressTransition(page);
  await expect(page.getByRole('heading', { name: /Positioning/ })).toBeVisible();
  await pressTransition(page);
  await skipStage(page, 'Not needed');

  // Outline: three sections, the second of which fails once.
  await expect(page.getByRole('button', { name: 'Add a section' })).toBeVisible();
  const titles = ['Habitat', 'Diet [[mock:402x1]]', 'The long neck'];
  for (const [i, title] of titles.entries()) {
    if (i === 0) await page.getByRole('button', { name: 'Add a section' }).click();
    else await page.getByRole('button', { name: /Insert a section after/ }).nth(i - 1).click();
    await page.getByLabel(`Title of section ${i + 1}`).fill(title);
  }
  // PM-06: approving is the stage's one primary action.
  await transitionBar(page).getByRole('button', { name: 'Save and approve' }).click();
  await expect(page.getByText(/Approved · v\d/).first()).toBeVisible();
  await pressTransition(page);

  await expect(page.getByRole('heading', { name: /Outline approval/ })).toBeVisible();
  await pressTransition(page);

  // Drafting through the real queue.
  await expect(page.getByRole('heading', { name: /Draft/ })).toBeVisible();
  // PM-06: the stage bar's primary is "Start drafting", not "Continue … anyway".
  await transitionBar(page).getByRole('button', { name: 'Start drafting' }).click();

  // The healthy sections are written; section 2 stops, and says which section
  // it is and why — "out of credits" is not retried three times any more.
  await expect(page.getByText('2 of 3 sections written')).toBeVisible({ timeout: 60_000 });
  const failure = page.getByText(/Section 2, “Diet/);
  await expect(failure).toBeVisible();
  await expect(failure).toContainText('Out of model credits');
  await page.screenshot({ path: test.info().outputPath('01-section-failed-with-reason.png'), fullPage: true });

  // "Retry it by hand" used to be advice with no button.
  await page.getByRole('button', { name: 'Retry section' }).click();
  await expect(page.getByText('3 of 3 sections written')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Section 2, “Diet/)).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('02-retried-and-written.png'), fullPage: true });
});
