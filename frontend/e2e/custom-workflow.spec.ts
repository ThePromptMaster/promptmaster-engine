import { expect, test } from '@playwright/test';

import { dismissBetaNotice } from './helpers';

/**
 * H4 — a workflow that "designs itself" (3 Oct call). Describe the work,
 * PromptMaster proposes stages, the user edits them, and it is saved as the
 * user's own workflow; a second project offers it again.
 */
test('design a workflow, edit a stage, start a project on it, and find it again', async ({ page }) => {
  await page.goto('/projects/new');
  await dismissBetaNotice(page);
  await page.getByLabel('What do you want to do or figure out?').fill('Profile a chef for a food magazine');
  await page.getByRole('button', { name: /I know what I want to do/ }).click();
  await expect(page.getByRole('heading', { name: 'Your setup' })).toBeVisible();

  await page.getByRole('button', { name: /Design a workflow for this work/ }).click();
  const designer = page.getByRole('region', { name: 'Design a workflow' });
  await designer.getByLabel('What kind of work is this?').fill('a magazine feature');
  await designer.getByRole('button', { name: 'Design it' }).click();
  const stages = designer.getByRole('list', { name: 'Proposed stages' }).getByRole('listitem');
  await expect(stages).toHaveCount(5, { timeout: 30_000 });
  await designer.getByLabel('Name of stage 2').fill('People to interview');
  await designer.getByRole('button', { name: 'Remove stage 4' }).click();
  await expect(stages).toHaveCount(4);
  await page.screenshot({ path: test.info().outputPath('01-designed.png'), fullPage: true });

  await designer.getByRole('button', { name: 'Use this workflow' }).click();
  await expect(page.getByRole('radio', { name: /^Magazine feature/ })).toHaveAttribute('aria-checked', 'true', { timeout: 15_000 });
  await page.getByLabel('Project name').fill('E2E custom workflow');
  await page.getByRole('button', { name: /^Start / }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'Pitch and angle' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('People to interview').first()).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('02-project-on-it.png'), fullPage: true });

  // Saved as the user's own: offered for the next project.
  await page.goto('/projects/new');
  await page.getByLabel('What do you want to do or figure out?').fill('Another feature');
  await page.getByRole('button', { name: /I know what I want to do/ }).click();
  await expect(page.getByRole('radio', { name: /^Magazine feature.*Yours/ })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('03-offered-again.png'), fullPage: true });
});

/**
 * P1b (6 Oct, email 12): "We should be able to have unlimited amount of
 * characters for workflow and other chat boxes if feasible." A workflow brief
 * of 12,000 characters goes to the designer whole (the cap was 2,000).
 */
test('a long workflow description is sent whole', async ({ page }) => {
  await page.goto('/projects/new');
  await dismissBetaNotice(page);
  await page.getByLabel('What do you want to do or figure out?').fill('Profile a chef for a food magazine');
  await page.getByRole('button', { name: /I know what I want to do/ }).click();
  await page.getByRole('button', { name: /Design a workflow for this work/ }).click();
  const designer = page.getByRole('region', { name: 'Design a workflow' });
  const long = `a magazine feature. ${'Each stage keeps the interview notes and the fact-check separate. '.repeat(200)}`.trim();
  expect(long.length).toBeGreaterThan(12_000);
  await designer.getByLabel('What kind of work is this?').fill(long);
  const sent = page.waitForRequest((r) => r.url().endsWith('/api/generate-workflow'));
  await designer.getByRole('button', { name: 'Design it' }).click();
  expect(((await sent).postDataJSON() as { description: string }).description).toBe(long);
  await expect(designer.getByRole('list', { name: 'Proposed stages' }).getByRole('listitem')).toHaveCount(5, { timeout: 30_000 });
  await page.screenshot({ path: test.info().outputPath('04-long-description.png'), fullPage: true });
});
