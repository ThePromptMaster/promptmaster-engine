import { expect, test } from '@playwright/test';

import { createProject, criterion, pressTransition, stageArtifact } from './helpers';

/**
 * 1 Oct, items 3, 12 and 18 — what PromptMaster already knows reaches the
 * structured field, and what it only recalls is labelled as recalled.
 */
test('recalled works are candidates; a run the draft knows was not run arrives marked, with its reason', async ({ page }) => {
  test.setTimeout(120_000);
  await createProject(page, { workflow: 'Research', name: 'E2E structured state', objective: 'Why customers churn' });
  await expect(stageArtifact(page)).toContainText('Mock', { timeout: 30_000 });
  await pressTransition(page);

  // Literature: every generated work is a candidate, and the stage says so.
  await expect(page.getByRole('heading', { name: 'Literature context' })).toBeVisible();
  const artifact = stageArtifact(page);
  await expect(artifact).toContainText('Mock work 1', { timeout: 30_000 });
  await expect(artifact.getByRole('note')).toContainText("3 of 3 works were suggested from the model's knowledge");
  await expect(artifact.getByRole('combobox').first()).toContainText('Suggested by PromptMaster — not retrieved');
  await expect(criterion(page, 'At least three candidate works identified')).toBeVisible();
  await expect(criterion(page, 'At least three works retrieved or verified')).toContainText('0 of 3');
  await page.screenshot({ path: test.info().outputPath('01-literature-candidates.png'), fullPage: true });

  // The user verifies one: the count follows once it is saved.
  await artifact.getByRole('combobox').first().click();
  await page.getByRole('option', { name: 'Verified by me' }).click();
  await page.getByRole('button', { name: 'Save as new version' }).click();
  await expect(criterion(page, 'At least three works retrieved or verified')).toContainText('1 of 3');
  await expect(artifact.getByRole('note')).toContainText('2 of 3 works');

  // On to Experiment (Hypothesis and Method on the way).
  for (const heading of ['Hypothesis or proposition', 'Method', 'Experiment or investigation']) {
    await pressTransition(page);
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    await expect(stageArtifact(page)).toContainText('Mock', { timeout: 30_000 });
  }

  // The scripted model marks run 1 "not run" with its reason, claims run 2
  // "completed", and says nothing about run 3. Only the first is kept.
  const rows = stageArtifact(page).getByRole('row');
  await expect(rows.nth(1)).toContainText('Not run');
  await expect(rows.nth(1)).toContainText('Set by PromptMaster');
  await expect(stageArtifact(page).getByLabel(/Why not run/i)).toHaveValue('Mock: the data this needs was never provided.');
  await expect(stageArtifact(page)).toContainText('2 still to resolve');
  await expect(stageArtifact(page)).toContainText('1 set by PromptMaster from what it already knew');
  await expect(stageArtifact(page).getByText('Completed', { exact: true })).toHaveCount(0);
  await expect(criterion(page, 'Every planned run has a result or a reason')).toContainText('2 still unresolved');
  await page.screenshot({ path: test.info().outputPath('02-experiment-not-run-prefilled.png'), fullPage: true });
});
