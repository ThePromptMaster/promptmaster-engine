import { expect, test } from '@playwright/test';

import { createProject, pressTransition, stageArtifact } from './helpers';

/**
 * Client, 25 Oct: "we copy a profile and paste it into ChatGPT and it gives a
 * color-coded verdict on whether we should screen them … I would paste a few
 * profiles at a time". Criteria once, then batches that add to one table, on
 * the scale the user chose.
 */
test('criteria once, then pasted batches judged on a chosen scale, each adding to the table', async ({ page }) => {
  test.setTimeout(120_000);
  await createProject(page, {
    workflow: 'Assessment', name: 'E2E screening',
    objective: 'Screen candidates for a VP Finance search: must have led a finance team of 20+.',
  });
  await expect(page.getByRole('heading', { name: 'Criteria' })).toBeVisible();
  await expect(stageArtifact(page)).toContainText('Mock', { timeout: 30_000 });
  await pressTransition(page); // → Assess
  await expect(page.getByRole('heading', { name: 'Assess' })).toBeVisible();

  await page.getByRole('radio', { name: '1–5' }).click();
  await page.getByLabel('What to assess').fill('Jane Doe — CFO at Acme, led 40 people\n\nJohn Roe — Controller at Beta');
  await page.getByRole('button', { name: 'Assess', exact: true }).click();
  await expect(page.getByText('2 assessed and added to the table.')).toBeVisible({ timeout: 30_000 });
  const table = page.getByRole('table');
  await expect(table).toContainText('Jane Doe — CFO at Acme, led 40 people');
  await expect(table).toContainText('Batch 1');
  await page.screenshot({ path: test.info().outputPath('01-first-batch.png'), fullPage: true });

  // The scale is fixed now; a second batch adds to the table.
  await expect(page.getByRole('radiogroup', { name: 'Scale' })).toHaveCount(0);
  await page.getByLabel('What to assess').fill('Ann Poe — Finance Director at Gamma');
  await page.getByRole('button', { name: 'Assess', exact: true }).click();
  await expect(page.getByText('1 assessed and added to the table.')).toBeVisible({ timeout: 30_000 });
  await expect(table.getByRole('row')).toHaveCount(4); // header + 3
  await expect(table).toContainText('Batch 2');

  // Filter to one level.
  const filters = page.getByRole('group', { name: 'Show' });
  await filters.getByRole('button', { name: /^5/ }).click();
  await expect(table.getByRole('row')).toHaveCount(3); // header + Jane and Ann at "5"
  await page.screenshot({ path: test.info().outputPath('02-filtered.png'), fullPage: true });
});
