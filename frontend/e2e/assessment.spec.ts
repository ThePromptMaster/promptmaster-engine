import { expect, test } from '@playwright/test';

import { createProject, pressTransition, serviceSelect, stageArtifact } from './helpers';

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

  // The paste area, not the rail's "Assess" stage.
  const batch = page.getByRole('region', { name: 'New batch' });
  await page.getByRole('radio', { name: '1–5' }).click();
  await page.getByLabel('What to assess').fill('Jane Doe — CFO at Acme, led 40 people\n\nJohn Roe — Controller at Beta');
  await batch.getByRole('button', { name: 'Assess', exact: true }).click();
  await expect(page.getByText('2 assessed and added to the table.')).toBeVisible({ timeout: 30_000 });
  const table = page.getByRole('table');
  await expect(table).toContainText('Jane Doe — CFO at Acme, led 40 people');
  await expect(table).toContainText('Batch 1');
  await page.screenshot({ path: test.info().outputPath('01-first-batch.png'), fullPage: true });

  // The scale is fixed now; a second batch adds to the table.
  await expect(page.getByRole('radiogroup', { name: 'Scale' })).toHaveCount(0);
  await page.getByLabel('What to assess').fill('Ann Poe — Finance Director at Gamma');
  await batch.getByRole('button', { name: 'Assess', exact: true }).click();
  await expect(page.getByText('1 assessed and added to the table.')).toBeVisible({ timeout: 30_000 });
  await expect(table.getByRole('row')).toHaveCount(4); // header + 3
  await expect(table).toContainText('Batch 2');

  // Filter to one level.
  const filters = page.getByRole('group', { name: 'Show' });
  await filters.getByRole('button', { name: /^5/ }).click();
  await expect(table.getByRole('row')).toHaveCount(3); // header + Jane and Ann at "5"
  await page.screenshot({ path: test.info().outputPath('02-filtered.png'), fullPage: true });
});

/**
 * 6 Nov, production: on an Assess stage Go told a tester to "attach a data file".
 * Only the user can paste what it judges, so it says so, by the box's own name.
 */
test('Go asks for the batch by name, and carries on once something is judged', async ({ page }) => {
  test.setTimeout(120_000);
  const id = await createProject(page, {
    workflow: 'Assessment', name: 'E2E Go on an Assess stage',
    objective: 'Screen supplier applications against our criteria [[mock:plan=declare_objective_complete]]',
  });
  await expect(stageArtifact(page)).toContainText('Mock', { timeout: 30_000 });
  await pressTransition(page);
  await expect(page.getByRole('heading', { name: 'Assess', exact: true })).toBeVisible({ timeout: 30_000 });

  const panel = page.getByRole('region', { name: 'Go mode', exact: true });
  await panel.getByRole('button', { name: 'Set up Go' }).click();
  await panel.getByRole('radio', { name: /^Autonomous/ }).click();
  await panel.getByRole('button', { name: /^Go$/ }).click();

  const card = page.getByRole('region', { name: 'Go mode needs you' });
  await expect(card).toContainText('into the box on this stage and press Assess', { timeout: 30_000 });
  await expect(card).not.toContainText('Attach a data file');
  await page.screenshot({ path: test.info().outputPath('01-go-asks-for-the-batch.png'), fullPage: true });
  await card.getByRole('button', { name: 'Go to the box' }).click();
  await expect(page.locator('[data-batch-box] textarea')).toBeFocused();
  const [run] = await serviceSelect('agent_runs', `project_id=eq.${id}&select=needs&order=created_at.desc&limit=1`);
  expect(run.needs).toMatchObject({ kind: 'paste_batch' });
});
