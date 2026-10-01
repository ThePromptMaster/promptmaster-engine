import { expect, test } from '@playwright/test';

import { createProject, pressTransition, serviceSelect, stageArtifact } from './helpers';

/**
 * 1 Oct, item 32 — "a later reproduction/validation section introduced a
 * number that conflicted with an earlier correct calculation … downstream
 * stages should reference canonical calculations/results from project state
 * rather than regenerate numbers independently from prose."
 */
test('a completed stage\'s figures are recorded and handed to the next stage to quote', async ({ page }) => {
  const id = await createProject(page, { workflow: 'Book', name: 'E2E established figures', objective: 'A short brief on churn' });
  const artifact = stageArtifact(page);
  await expect(artifact).toContainText('Mock', { timeout: 30_000 });

  // The stage's work states two rates.
  await artifact.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel(/^Edit Objective/).fill('Mid-Market churn rose from 4.1% to 9.4% over two quarters.');
  await page.getByRole('button', { name: 'Save as new version' }).click();
  await expect(artifact.getByRole('button', { name: 'Edit' })).toBeVisible();

  // Completing it records them; the next stage's draft is sent them.
  const drafted = page.waitForRequest((r) => r.url().includes('/api/generate-stage-artifact') && r.method() === 'POST');
  await pressTransition(page);
  const { digest } = (await drafted).postDataJSON();
  expect(digest.figures).toEqual([
    { stage: 'Objective and purpose', name: 'Mock rate 1', value: '4.1%', context: 'scripted' },
    { stage: 'Objective and purpose', name: 'Mock rate 2', value: '9.4%', context: 'scripted' },
  ]);

  // The scripted model also offered "99.9%", which the text does not contain: it is not on the record.
  const [stored] = await serviceSelect('artifacts', `project_id=eq.${id}&stage_id=eq.objective&select=key_figures`);
  expect(stored.key_figures.figures.map((f: { value: string }) => f.value)).toEqual(['4.1%', '9.4%']);

  await expect(page.getByRole('heading', { name: /Audience/ })).toBeVisible();
  const record = page.getByRole('group', { name: 'Figures on record' });
  await expect(record).toContainText('Figures on record · 2');
  await record.locator('summary').click();
  await expect(record).toContainText('9.4% — Mock rate 2');
  await expect(record).toContainText('Objective and purpose');
  await page.screenshot({ path: test.info().outputPath('01-figures-on-record.png'), fullPage: true });
});
