import { expect, test } from '@playwright/test';

import { dismissBetaNotice, serviceSelect } from './helpers';

/**
 * Sean, 26 Oct, after a tester found the staged process long for a small job:
 * "the starting experience could be more like Claude. You type what you want
 * and get an answer or draft up front … Then there's a clear button to take
 * that same work into the full PromptMaster process … Everything carries over
 * so you're building on what you already made."
 *
 * Every other spec signs in with the full workflow's ways in open
 * (auth.setup.ts); this one starts as a new user does.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('pm.start.full.v1'));
});

test('an answer first, then the same project taken into the full process', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/projects/new');
  await dismissBetaNotice(page);
  // The full workflow is one press away, not on the first screen.
  await expect(page.getByRole('button', { name: /Start the conversation/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start with the full workflow instead' })).toHaveAttribute('aria-expanded', 'false');

  await page.getByLabel('What do you want to do or figure out?').fill('Write a two-line thank-you note to the volunteers');
  await page.getByRole('button', { name: /Get an answer/ }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  const projectId = page.url().split('/').at(-1)!;

  // The answer is drafted as the project opens.
  await expect(page.getByRole('heading', { name: 'Answer' })).toBeVisible();
  await expect(page.getByText('Mock output').first()).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: test.info().outputPath('quick-answer.png') });

  const take = page.getByRole('region', { name: 'Take this into the full process' });
  await take.getByRole('button', { name: 'Take this into the full PromptMaster process' }).click();
  await expect(take.getByRole('radio', { name: /Designed for this work/ })).toBeVisible({ timeout: 30_000 });
  await take.getByRole('radio', { name: /Standard/ }).click();
  await page.screenshot({ path: test.info().outputPath('take-full-process.png') });
  await take.getByRole('button', { name: /^Continue with / }).click();

  // The same project, now on the full workflow, with the answer carried over.
  await expect(page.getByRole('heading', { name: 'Objective and setup' })).toBeVisible({ timeout: 30_000 });
  expect(page.url()).toContain(projectId);
  const [project] = await serviceSelect('projects', `id=eq.${projectId}&select=workflow,stage`);
  expect(project).toMatchObject({ workflow: 'single_output', stage: 'input' });
  const carried = await serviceSelect('artifact_versions', `project_id=eq.${projectId}&source_operation=eq.carried_from_quick&select=content`);
  expect(carried).toHaveLength(1);
  expect(String((carried[0] as { content: string }).content)).toContain('Mock output');
  const switched = await serviceSelect('workflow_events', `project_id=eq.${projectId}&type=eq.workflow_switched&select=payload`);
  expect(switched).toHaveLength(1);
  await page.screenshot({ path: test.info().outputPath('full-process.png') });
});
