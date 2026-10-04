import { expect, test } from '@playwright/test';

import { createProject, pressTransition } from './helpers';

/**
 * 4 Oct beta blockers — "the project state breaks" and "an artifact
 * disappears between stages" (Sean, 3 Oct). Each test here is one way the
 * project used to look broken or lose work, and what it does now.
 */

test('a project whose history fails to load says so and offers Retry, instead of looking reset', async ({ page }) => {
  const projectId = await createProject(page, { workflow: 'Book', name: 'E2E history load', objective: 'A book about pangolins' });
  await expect(page.getByText('Mock output').first()).toBeVisible();
  await pressTransition(page);
  await expect(page.getByRole('heading', { name: /Audience/ })).toBeVisible();

  // The next read of the event log fails once.
  let failed = false;
  await page.route('**/rest/v1/workflow_events?*', async (route) => {
    if (!failed && route.request().method() === 'GET') {
      failed = true;
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"unavailable"}' });
      return;
    }
    await route.fallback();
  });
  await page.goto(`/projects/${projectId}`);

  // Not "every stage not started": the stages are not shown at all.
  const alert = page.getByRole('alert').filter({ hasText: /Couldn.t load where this project stands/ });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText('Nothing has been lost');
  await expect(page.getByRole('navigation', { name: 'Workflow stages' })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('01-history-failed-retry.png') });

  await alert.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('heading', { name: /Audience/ })).toBeVisible();
  const rail = page.getByRole('navigation', { name: 'Workflow stages' });
  await expect(rail.getByRole("button", { name: /Objective/ })).toContainText("task_alt");
  await page.screenshot({ path: test.info().outputPath('02-after-retry-where-it-was.png') });
});
