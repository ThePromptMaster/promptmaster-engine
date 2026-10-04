import { expect, test } from '@playwright/test';

import { createProject, pressTransition, serviceSelect } from './helpers';

/**
 * 4 Oct beta blockers — a save or a stage move that fails must say what really
 * happened, and recover without the user having to guess.
 */

test('a save that fails retries by itself and lands, with Retry now on offer meanwhile', async ({ page }) => {
  const id = await createProject(page, { workflow: 'Book', name: 'E2E save retry', objective: 'A book about kiwis' });
  await expect(page.getByText('Mock output').first()).toBeVisible();

  let failed = false;
  await page.route('**/rest/v1/projects?*', async (route) => {
    if (!failed && route.request().method() === 'PATCH') {
      failed = true;
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"unavailable"}' });
      return;
    }
    await route.fallback();
  });

  await page.getByLabel('Project title').fill('E2E save retry, renamed');
  await expect(page.getByText('Not saved')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry now' })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('01-not-saved-retry-now.png') });

  // No further typing: it retries on its own.
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 10_000 });
  const [row] = await serviceSelect('projects', `id=eq.${id}&select=title`);
  expect(row.title).toBe('E2E save retry, renamed');
  await page.screenshot({ path: test.info().outputPath('02-saved-by-itself.png') });
});

test('a move that was recorded but could not be re-read says so, and is not recorded twice', async ({ page }) => {
  const id = await createProject(page, { workflow: 'Book', name: 'E2E recorded move', objective: 'A book about tuataras' });
  await expect(page.getByText('Mock output').first()).toBeVisible();

  // The event write succeeds; the re-read right after it fails once.
  let wrote = false;
  let failedRead = false;
  await page.route('**/rest/v1/workflow_events*', async (route) => {
    const method = route.request().method();
    if (method === 'POST') wrote = true;
    if (wrote && !failedRead && method === 'GET') {
      failedRead = true;
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"unavailable"}' });
      return;
    }
    await route.fallback();
  });

  await pressTransition(page);
  await expect(page.getByText(/That was recorded, but the page couldn.t catch up/)).toBeVisible();
  await expect(page.getByText(/Nothing was changed/)).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('01-recorded-not-refreshed.png') });

  // The page reloads itself onto where the project stands.
  await expect(page.getByRole('heading', { name: /Audience/ })).toBeVisible({ timeout: 15_000 });
  const moves = await serviceSelect('workflow_events', `project_id=eq.${id}&stage_id=eq.objective&type=neq.project_created&select=type`);
  expect(moves).toHaveLength(1);
});
