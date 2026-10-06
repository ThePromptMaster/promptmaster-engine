import { expect, test } from '@playwright/test';

import { createProject, pressTransition, stageArtifact } from './helpers';

/**
 * 3 Oct (Research run), items 3–5: what Carry forward does, and "10 still to
 * resolve" beside "0 required". Open items on the final review are findings;
 * the ones carried forward go out with the finished work.
 */
test('Final review: marking is optional, and what is carried forward is listed with the finished work', async ({ page }) => {
  test.setTimeout(240_000);
  await createProject(page, { workflow: 'Research', name: 'E2E carry forward', objective: 'Why gross margin fell' });
  await expect(stageArtifact(page)).toContainText('Mock', { timeout: 30_000 });
  for (const heading of [
    'Literature context', 'Hypothesis or proposition', 'Method', 'Experiment or investigation', 'Analysis',
    'Alternative explanations', 'Reproduction or validation', 'Mechanism', 'Generality', 'Drafting', 'Revision', 'Final review',
  ]) {
    await pressTransition(page);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible({ timeout: 30_000 });
  }
  const artifact = stageArtifact(page);
  await expect(artifact).toContainText('Mock item 1', { timeout: 30_000 });
  // The scripted model proposes Settled for row 1 and Carry forward for row 2.
  await expect(artifact).toContainText('3 not yet marked — optional, does not block finishing');
  await expect(artifact).toContainText('Marking them is optional and does not block finishing');
  await page.screenshot({ path: test.info().outputPath('01-final-optional.png'), fullPage: true });

  await artifact.getByRole('button', { name: 'Confirm the 2 proposals' }).click();
  await expect(artifact).toContainText('1 not yet marked');

  await pressTransition(page);
  const carried = page.locator('[data-carried-forward]');
  await expect(carried).toContainText('Open issues carried forward', { timeout: 30_000 });
  await expect(carried).toContainText('Mock item 2');
  await expect(carried).toContainText('Mock: row 2 says so.');
  await expect(carried).not.toContainText('Mock item 1');
  await carried.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('02-finished-carried-forward.png'), fullPage: true });
});
