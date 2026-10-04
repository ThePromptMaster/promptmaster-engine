import { expect, test, type Page } from '@playwright/test';

import { createProject, dismissBetaNotice, serviceSelect } from './helpers';

/**
 * 4 Oct beta blockers — opening and starting a project must not strand a new
 * user. Each test makes one request fail once, the way a flaky network does.
 */

async function failOnce(page: Page, pattern: string, method: string) {
  let failed = false;
  await page.route(pattern, async (route) => {
    if (!failed && route.request().method() === method) {
      failed = true;
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"unavailable"}' });
      return;
    }
    await route.fallback();
  });
}

test('a workflow that fails to load offers Retry, and the project opens', async ({ page }) => {
  const id = await createProject(page, { workflow: 'Book', name: 'E2E template retry', objective: 'A book about lemurs' });
  await expect(page.getByText('Mock output').first()).toBeVisible();

  await failOnce(page, '**/rest/v1/workflow_templates?*', 'GET');
  await page.goto(`/projects/${id}`);
  const alert = page.getByRole('alert').filter({ hasText: /Couldn.t load this project.s workflow/ });
  await expect(alert).toBeVisible();
  // Not the "nothing generated in this project yet" pane.
  await expect(page.getByText('Nothing generated in this project yet.')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('01-workflow-failed-retry.png') });

  await alert.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('navigation', { name: 'Workflow stages' })).toBeVisible();
  await expect(page.getByText('Mock output').first()).toBeVisible();
});

test('a project that fails part-way through creation leaves nothing behind, and Start works again', async ({ page }) => {
  const title = `E2E half made ${Date.now()}`;
  await page.goto('/projects/new');
  await dismissBetaNotice(page);
  await page.getByLabel('What do you want to do or figure out?').fill('A book about narwhals');
  await page.getByRole('button', { name: /I know what I want to do/ }).click();
  await expect(page.getByRole('heading', { name: 'Your setup' })).toBeVisible();
  await page.getByRole('radio', { name: /^Book/ }).click();
  await page.getByLabel('Project name').fill(title);

  // The last of the four writes fails once.
  await failOnce(page, '**/rest/v1/workflow_events*', 'POST');
  await page.getByRole('button', { name: /^Start / }).click();
  await expect(page.getByRole('alert').filter({ hasText: /Nothing was created/ })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('01-creation-failed-nothing-created.png') });
  expect(await serviceSelect('projects', `title=eq.${encodeURIComponent(title)}&select=id`)).toHaveLength(0);

  await page.getByRole('button', { name: /^Start / }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  expect(await serviceSelect('projects', `title=eq.${encodeURIComponent(title)}&select=id`)).toHaveLength(1);
});

test('a workflow list that fails to load says why Start is unavailable, and Retry fixes it', async ({ page }) => {
  await failOnce(page, '**/rest/v1/workflow_templates?*', 'GET');
  await page.goto('/projects/new');
  await dismissBetaNotice(page);
  const alert = page.getByRole('alert').filter({ hasText: /workflows could not be loaded/ });
  await expect(alert).toBeVisible();

  // Moving on does not clear the reason, as it used to.
  await page.getByLabel('What do you want to do or figure out?').fill('A book about quokkas');
  await page.getByRole('button', { name: /I know what I want to do/ }).click();
  await expect(page.getByRole('heading', { name: 'Your setup' })).toBeVisible();
  await expect(alert).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('01-workflows-failed-reason-stays.png') });

  await alert.getByRole('button', { name: 'Retry' }).click();
  await expect(alert).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Start / })).toBeEnabled();
  await page.screenshot({ path: test.info().outputPath('02-retry-start-enabled.png') });
});
