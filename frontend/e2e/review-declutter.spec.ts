import { expect, test } from '@playwright/test';

import { createProject, pressTransition, skipStage, stageArtifact, transitionBar } from './helpers';

/**
 * H1c — a check stage is not "all right there in front of you" (3 Oct call).
 * The table leads, with a line on how a check stage works; the checklist is
 * one line until opened; the stage check and the feedback dials fold into one.
 */
test('a check stage leads with its table and folds the rest', async ({ page }) => {
  test.setTimeout(180_000);
  await createProject(page, { workflow: 'Book', name: 'E2E check stage', objective: 'A short book about lions' });
  await expect(page.getByText('Mock output').first()).toBeVisible();
  await pressTransition(page);
  await expect(stageArtifact(page).getByText(/Mock /).first()).toBeVisible();
  await pressTransition(page);
  await expect(page.getByRole('heading', { name: /Positioning/ })).toBeVisible();
  await pressTransition(page);
  await skipStage(page, 'Not needed');
  await page.getByRole('button', { name: 'Add a section' }).click();
  await page.getByLabel('Title of section 1').fill('The pride');
  await page.waitForTimeout(1_500);
  await transitionBar(page).getByRole('button', { name: 'Save and approve' }).click();
  await expect(page.getByText(/Approved · v\d/).first()).toBeVisible();
  await pressTransition(page);
  await expect(page.getByRole('heading', { name: /Outline approval/ })).toBeVisible();
  await pressTransition(page);
  await expect(page.getByRole('heading', { name: /Draft/ })).toBeVisible();
  await transitionBar(page).getByRole('button', { name: 'Start drafting' }).click();
  await expect(page.getByText('1 of 1 sections written')).toBeVisible({ timeout: 60_000 });
  await pressTransition(page);
  await expect(page.getByRole('heading', { name: /Continuity/ })).toBeVisible({ timeout: 30_000 });
  await expect(stageArtifact(page)).toContainText('Mock finding 1', { timeout: 30_000 });

  await expect(stageArtifact(page)).toContainText('This is a check stage');
  const toggle = page.getByRole('button', { name: /To finish this stage/ });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await page.screenshot({ path: test.info().outputPath('01-check-stage-folded.png'), fullPage: true });

  await toggle.click();
  await expect(page.getByRole('region', { name: 'Checked by PromptMaster' })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('02-checklist-opened.png'), fullPage: true });
});
