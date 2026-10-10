import { expect, test } from '@playwright/test';

import { createProject, serviceSelect } from './helpers';

/**
 * Harold, via Sean (9 Oct): a new user should give it a goal and see work
 * happen, not configure a run. "Let Go run this" is Autonomous with routine
 * decisions handled, straight to the authorization — two clicks, where Set up
 * Go → Autonomous → Handle them for me → Go → Authorize was five.
 */
test('"Let Go run this" delegates in two clicks and keeps the authorization', async ({ page }) => {
  test.setTimeout(120_000);
  const id = await createProject(page, {
    workflow: 'Single output', name: 'E2E let Go run this',
    objective: 'A one-page memo on moving from Slack to Teams [[mock:plan=declare_objective_complete]]',
  });
  await expect(page.getByText('Mock output').first()).toBeVisible({ timeout: 30_000 });

  const panel = page.getByRole('region', { name: 'Go mode' });
  await expect(panel.getByRole('button', { name: 'Set up Go' })).toBeVisible();
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('01-let-go-run-this.png') });
  await panel.getByRole('button', { name: 'Let Go run this' }).click();

  // The authorization is still asked for: it is the record of what was delegated.
  const dialog = page.getByRole('dialog', { name: 'Authorize Go mode' });
  await expect(dialog).toBeVisible();
  await expect(panel.getByRole('radio', { name: /^Autonomous/ })).toHaveAttribute('aria-checked', 'true');
  await expect(panel.getByRole('radio', { name: /^Handle them for me/ })).toHaveAttribute('aria-checked', 'true');
  await expect.poll(async () => (await serviceSelect('projects', `id=eq.${id}&select=routine_decisions`))[0].routine_decisions).toBe('handle');
  await page.screenshot({ path: test.info().outputPath('02-authorize.png') });
  await page.getByRole('button', { name: 'Authorize and go' }).click();

  await expect.poll(async () => (await serviceSelect('agent_runs', `project_id=eq.${id}&select=policy,authorization_id`))[0] ?? null, { timeout: 30_000 })
    .toMatchObject({ policy: 'autonomous' });
  const [run] = await serviceSelect('agent_runs', `project_id=eq.${id}&select=policy,authorization_id`);
  expect(run.authorization_id).toBeTruthy();
  await page.screenshot({ path: test.info().outputPath('03-running.png') });
});
