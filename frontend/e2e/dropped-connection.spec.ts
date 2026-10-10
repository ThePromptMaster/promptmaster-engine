import { expect, test, type Page } from '@playwright/test';

import { checkStage, createProject, serviceSelect } from './helpers';

/**
 * L1d (4 Oct, "Load failed"): Apply the findings failed with Safari's "Load
 * failed" while the backend had answered 200 — iOS drops a tab's requests when
 * you switch apps. A dropped connection is now asked again once; a second drop
 * says what happened, and nothing is saved either way until an answer arrives.
 */

async function checked(page: Page, name: string) {
  const id = await createProject(page, { workflow: 'Book', name, objective: 'A book about giraffes [[mock:findings=3]]' });
  await expect(page.getByText('Mock output').first()).toBeVisible();
  await checkStage(page);
  const panel = page.getByRole('region', { name: 'Act on this check' });
  await expect(panel.getByRole('listitem')).toHaveCount(3);
  return { id, panel };
}

test('one dropped connection is asked again, and the revision arrives', async ({ page }) => {
  const { panel } = await checked(page, 'E2E dropped once');
  let calls = 0;
  await page.route('**/api/apply-recommendations', async (route) => {
    calls += 1;
    if (calls === 1) await route.abort('failed');
    else await route.continue();
  });

  await panel.getByRole('button', { name: /^Apply: Mock finding 2/ }).click();
  await expect(page.getByRole('dialog', { name: 'Revised version' })).toBeVisible();
  expect(calls).toBe(2);
  await page.screenshot({ path: test.info().outputPath('01-retried-and-arrived.png') });
});

test('a connection that keeps dropping says so, and saves nothing', async ({ page }) => {
  const { id, panel } = await checked(page, 'E2E dropped twice');
  await page.route('**/api/apply-recommendations', (route) => route.abort('failed'));

  await panel.getByRole('button', { name: /^Apply: Mock finding 2/ }).click();
  const alert = page.getByRole('alert').filter({ hasText: 'connection dropped' });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText('Nothing was changed. Try again when the connection is steady.');
  await expect(page.getByText('Load failed')).toHaveCount(0);
  const versions = await serviceSelect('artifact_versions', `project_id=eq.${id}&select=id`);
  expect(versions).toHaveLength(1);
  await alert.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('02-says-the-connection-dropped.png') });
});
