import { expect, test } from '@playwright/test';

import { createProject, criterion, pressTransition, stageArtifact } from './helpers';

/**
 * 3 Oct (Research run): "PromptMaster proposes a status → user confirms or
 * overrides → status becomes authoritative." The draft of a check table
 * arrives with a proposed status and its reason on each row it can judge;
 * the stage is not done until the user confirms them, in one click.
 */
test('Alternatives arrives with proposed statuses; one click confirms them', async ({ page }) => {
  test.setTimeout(180_000);
  await createProject(page, { workflow: 'Research', name: 'E2E proposed statuses', objective: 'Why gross margin fell' });
  await expect(stageArtifact(page)).toContainText('Mock', { timeout: 30_000 });

  for (const heading of [
    'Literature context', 'Hypothesis or proposition', 'Method', 'Experiment or investigation', 'Analysis', 'Alternative explanations',
  ]) {
    await pressTransition(page);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect(stageArtifact(page)).toContainText('Mock', { timeout: 30_000 });
  }

  // The scripted model proposes "Ruled out" on row 1 and "Addressed" on row 2,
  // each with a reason, and nothing on row 3.
  const artifact = stageArtifact(page);
  const rows = artifact.getByRole('row');
  await expect(rows.nth(1)).toContainText('Ruled out');
  await expect(rows.nth(1)).toContainText('Proposed by PromptMaster');
  await expect(rows.nth(1)).toContainText('Mock: row 1 says so.');
  await expect(rows.nth(2)).toContainText('Addressed');
  await expect(artifact).toContainText('3 still to resolve');
  await expect(artifact).toContainText('2 proposed by PromptMaster — confirm or change');
  await page.getByRole('button', { name: /To finish this stage/ }).click();
  await expect(criterion(page, 'Each addressed or left open')).toContainText('3 still unresolved');
  await page.screenshot({ path: test.info().outputPath('01-alternatives-proposed.png'), fullPage: true });

  await artifact.getByRole('button', { name: 'Confirm the 2 proposals' }).click();
  await expect(artifact).toContainText('1 still to resolve');
  await expect(artifact.getByText('Proposed by PromptMaster')).toHaveCount(0);
  await expect(criterion(page, 'Each addressed or left open')).toContainText('1 still unresolved');
  await page.screenshot({ path: test.info().outputPath('02-alternatives-confirmed.png'), fullPage: true });

  // A reload shows what was saved: the two confirmed rows are the user's now.
  await page.reload();
  await expect(stageArtifact(page)).toContainText('1 still to resolve', { timeout: 30_000 });
  await expect(stageArtifact(page).getByText('Proposed by PromptMaster')).toHaveCount(0);
});

/**
 * R1c: a row the draft left without a status — or a table drafted before
 * proposals existed — gets a proposal on request, from its own text.
 */
test('Propose statuses fills the row the draft left open; confirming settles the stage', async ({ page }) => {
  test.setTimeout(180_000);
  await createProject(page, { workflow: 'Research', name: 'E2E propose on request', objective: 'Why gross margin fell' });
  await expect(stageArtifact(page)).toContainText('Mock', { timeout: 30_000 });
  for (const heading of [
    'Literature context', 'Hypothesis or proposition', 'Method', 'Experiment or investigation', 'Analysis', 'Alternative explanations',
  ]) {
    await pressTransition(page);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect(stageArtifact(page)).toContainText('Mock', { timeout: 30_000 });
  }
  const artifact = stageArtifact(page);
  const rows = artifact.getByRole('row');
  await expect(rows.nth(3)).toContainText('Not looked at');

  await artifact.getByRole('button', { name: 'Propose statuses' }).click();
  await expect(artifact).toContainText('PromptMaster proposed a status for 1 row, each with its reason.');
  await expect(rows.nth(3)).toContainText('Proposed by PromptMaster');
  await expect(rows.nth(3)).toContainText('Mock: the row says so.');
  await expect(artifact.getByRole('button', { name: 'Propose statuses' })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('03-propose-on-request.png'), fullPage: true });

  await artifact.getByRole('button', { name: 'Confirm the 3 proposals' }).click();
  await expect(artifact).toContainText('all resolved');
  await page.getByRole('button', { name: /To finish this stage/ }).click();
  await expect(criterion(page, 'Each addressed or left open')).not.toContainText('unresolved');
  await page.screenshot({ path: test.info().outputPath('04-all-confirmed.png'), fullPage: true });
});
